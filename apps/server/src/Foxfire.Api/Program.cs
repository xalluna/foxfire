using System.Text;
using FluentValidation;
using Foxfire.Api.Auth;
using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Endpoints;
using Foxfire.Api.Reads;
using Foxfire.Api.Services;
using Foxfire.Api.Startup;
using Foxfire.Api.Sync;
using Foxfire.Api.Versioning;
using Foxfire.Api.Web;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Foxfire.Storage;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// Environment variables with __ as the separator, which is how a Docker Compose
// .env file spells nesting: Auth__JwtSigningKey, Riot__ApiKey.
builder.Configuration.AddEnvironmentVariables();

builder.Services.Configure<ServerOptions>(builder.Configuration.GetSection(ServerOptions.Section));
builder.Services.Configure<RiotOptions>(builder.Configuration.GetSection(RiotOptions.Section));
builder.Services.Configure<AuthOptions>(builder.Configuration.GetSection(AuthOptions.Section));
builder.Services.Configure<AdminOptions>(builder.Configuration.GetSection(AdminOptions.Section));
builder.Services.Configure<SmtpOptions>(builder.Configuration.GetSection(SmtpOptions.Section));
builder.Services.Configure<RateLimitOptions>(builder.Configuration.GetSection(RateLimitOptions.Section));

var serverOptions = builder.Configuration.GetSection(ServerOptions.Section).Get<ServerOptions>() ?? new();
var riotOptions = builder.Configuration.GetSection(RiotOptions.Section).Get<RiotOptions>() ?? new();
var authOptions = builder.Configuration.GetSection(AuthOptions.Section).Get<AuthOptions>() ?? new();
var adminOptions = builder.Configuration.GetSection(AdminOptions.Section).Get<AdminOptions>() ?? new();
var smtpOptions = builder.Configuration.GetSection(SmtpOptions.Section).Get<SmtpOptions>() ?? new();
var rateLimitOptions = builder.Configuration.GetSection(RateLimitOptions.Section).Get<RateLimitOptions>() ?? new();
var connectionString = builder.Configuration.GetConnectionString("Default");

// Everything wrong with the configuration, in one message, before anything
// starts. A host should not have to restart a container five times to find five
// missing settings, and a server that started degraded would be worse than one
// that refused — half of these produce failures that look like something else.
var problems = ConfigurationCheck.Validate(
    connectionString, serverOptions, riotOptions, authOptions, adminOptions, rateLimitOptions);
if (problems.Count > 0)
{
    var message = new StringBuilder()
        .AppendLine()
        .AppendLine("Foxfire Server cannot start. Fix the following and try again:")
        .AppendLine();

    foreach (var problem in problems) message.Append("  - ").AppendLine(problem);

    message.AppendLine().AppendLine("See apps/server/docker/.env.example for every setting and what it is for.");
    throw new InvalidOperationException(message.ToString());
}

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(DesktopCompatibility.AllowList);

builder.Services.AddDbContext<FoxfireDbContext>(options =>
    options.UseSqlServer(connectionString, sql =>
    {
        sql.MigrationsAssembly(typeof(FoxfireDbContext).Assembly.FullName);

        // A homelab's SQL Server is a container that may still be starting when
        // this one is, and a transient connection failure at boot should be
        // waited out rather than crash-looped through.
        sql.EnableRetryOnFailure(maxRetryCount: 5, maxRetryDelay: TimeSpan.FromSeconds(10), errorNumbersToAdd: null);
    }));

builder.Services
    .AddIdentityCore<FoxfireUser>(options =>
    {
        // Email is the login, so it has to be unique, and this is the switch
        // for it. Usernames are unique too and have no switch here, because
        // Identity indexes NormalizedUserName uniquely whether you ask or not.
        //
        // Both are wanted. Your email is what a password reset has to reach.
        // Your username is what sits beside your games, and every member of a
        // server can see every other member's — so a name is how people tell
        // each other apart, and two people answering to one is a worse outcome
        // than the second of them picking again.
        options.User.RequireUniqueEmail = true;

        // Length over character classes. Mandatory symbols push people towards
        // Password1! and towards writing it down; length is what actually costs
        // an attacker anything.
        options.Password.RequiredLength = 12;
        options.Password.RequireDigit = false;
        options.Password.RequireLowercase = false;
        options.Password.RequireUppercase = false;
        options.Password.RequireNonAlphanumeric = false;

        // Ten tries then a five-minute wait. Enough to stop guessing, little
        // enough that a friend who fat-fingers their password is not locked out
        // of their own community for the evening.
        options.Lockout.MaxFailedAccessAttempts = 10;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(5);
        options.Lockout.AllowedForNewUsers = true;
    })
    .AddRoles<IdentityRole<Guid>>()
    .AddEntityFrameworkStores<FoxfireDbContext>()
    .AddDefaultTokenProviders();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = TokenService.Issuer,
            ValidateAudience = true,
            ValidAudience = TokenService.Issuer,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(authOptions.JwtSigningKeyBytes),
            ValidateLifetime = true,

            // The default five minutes of slack is generous for tokens that only
            // live fifteen. Thirty seconds covers ordinary clock drift between a
            // homelab and somebody's PC without extending a token by a third.
            ClockSkew = TimeSpan.FromSeconds(30)
        };

        // A WebSocket handshake carries no Authorization header, so the hub
        // is the one place a token arrives in the query string. Scoped to the
        // hub path deliberately: a token in a URL reaches logs and history,
        // and that is a trade worth making for exactly one endpoint.
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var token = context.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(token)
                    && context.HttpContext.Request.Path.StartsWithSegments(FoxfireHub.Path))
                {
                    context.Token = token;
                }

                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

// One hub for everything the server pushes. The desktop holds a single
// connection to a single active server, and every event on it is addressed
// the same way, so splitting by concern would multiply connections without
// separating anything.
builder.Services.AddSignalR();

// Requests are handled through MediatR, one request and one handler per file,
// following the pattern in the reference project. Validation is opt-in: the
// behaviour runs for a request that implements IValidatedRequest and steps out
// of the way for one that does not.
//
// MediatR is pinned to 12.x deliberately: 13 moved to a commercial licence and
// 12.4.1 is the last Apache-2.0 release.
builder.Services.AddMediatR(mediator =>
{
    mediator.RegisterServicesFromAssemblyContaining<Program>();
    mediator.AddOpenBehavior(typeof(ValidationBehavior<,>));
});

// includeInternalTypes, because a validator is internal — nothing outside
// this assembly constructs one — and the scanner skips non-public types
// unless told. Getting this wrong is silent: the validator is simply never
// registered, the behaviour finds nothing to run, and the request is handled.
builder.Services.AddValidatorsFromAssemblyContaining<Program>(includeInternalTypes: true);

// A handler is not an endpoint, so nothing hands it a ClaimsPrincipal. This is
// where it reads one from instead.
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IIdentityContext, HttpIdentityContext>();
builder.Services.AddScoped<AccountOwnership>();

builder.Services.AddScoped<TokenService>();
builder.Services.AddScoped<ServerSettingsService>();

// The ingestion half. Scoped, because each of these is a DbContext and a
// little logic on top of it; the engine that drives them is not, because a
// sync outlives the request that asked for it.
builder.Services.AddScoped<MatchIngestion>();
builder.Services.AddScoped<RankRecorder>();
builder.Services.AddScoped<AccountProfile>();
builder.Services.AddScoped<AttributionRunner>();
builder.Services.AddScoped<IdentityRepair>();

// The read half. Every screen the desktop draws in server mode comes
// through one of these.
builder.Services.AddScoped<MatchReads>();
builder.Services.AddScoped<RankReads>();
builder.Services.AddScoped<ManualRankEditor>();

builder.Services.AddSingleton<IServerEvents, SignalRServerEvents>();
builder.Services.AddSingleton<SyncService>();
builder.Services.AddSingleton<PostGameSyncScheduler>();

builder.Services.AddHttpClient(RiotClient.HttpClientName, http =>
{
    http.Timeout = TimeSpan.FromSeconds(15);
    http.DefaultRequestHeaders.UserAgent.ParseAdd("Foxfire-Server");
});

builder.Services.AddSingleton(sp => new RiotRateLimiter(
    riotOptions.KeyType == "application" ? RiotRateLimits.ApplicationKey : RiotRateLimits.PersonalKey,
    sp.GetRequiredService<TimeProvider>(),
    sp.GetRequiredService<ILogger<RiotRateLimiter>>()));

builder.Services.AddSingleton(sp => new RiotClient(
    sp.GetRequiredService<IHttpClientFactory>(),
    sp.GetRequiredService<RiotRateLimiter>(),
    riotOptions.ApiKey,
    sp.GetRequiredService<ILogger<RiotClient>>()));

// Optional, and the server says so rather than refusing to start: a
// community that never uploads a replay needs no blob store, and everything
// else on the server works without one.
builder.Services.AddSingleton<IReplayStorage>(sp => new AzureBlobReplayStorage(
    builder.Configuration.GetConnectionString("Blob"),
    builder.Configuration["Storage:PublicUrl"],
    sp.GetRequiredService<ILogger<AzureBlobReplayStorage>>()));

builder.Services.AddProblemDetails();
builder.Services.AddFoxfireProxies();
builder.Services.AddFoxfireRateLimits();

var app = builder.Build();

await app.Services.PrepareDatabaseAsync(app.Lifetime.ApplicationStopping);

var spa = SpaHosting.Locate(app.Configuration, app.Environment);

app.UseExceptionHandler();

// First, so that everything after it — the rate limits above all — sees the
// address a request came from rather than the reverse proxy's.
app.UseForwardedHeaders();

// Before routing, which it rewrites the path for: desktop 0.12.0 calls the API
// at the root, where the web client's pages now are.
app.UseLegacyRootShim();

// The web client's files, before routing: a request for one never needs an
// endpoint, a version check or a user.
spa.UseFiles(app);

app.UseRouting();
app.UseRateLimiter();

// Before authentication: a client this server does not speak to should be told
// so, not handed an authentication failure it cannot act on.
app.UseDesktopVersionGate();

app.UseAuthentication();
app.UseAuthorization();

// The handshake and the health check answer at the root as well as under the
// API, permanently: they are how a client finds the API in the first place.
app.MapVersionEndpoints();

var api = app.MapGroup(ApiPaths.Base);
api.MapVersionEndpoints();
api.MapAuthEndpoints();
api.MapInviteEndpoints();
api.MapPasswordResetEndpoints();
api.MapAdminSettingsEndpoints();
api.MapAdminUserEndpoints();
api.MapAdminStorageEndpoints();
api.MapRiotLinkEndpoints();
api.MapSyncEndpoints();
api.MapDashboardEndpoints();
api.MapRankEndpoints();
api.MapSearchEndpoints();
api.MapReplayEndpoints();
api.MapImportEndpoints();
app.MapHub<FoxfireHub>(FoxfireHub.Path);

// An API route that does not exist is a JSON 404, from any client. Without
// this it would fall through to the web client's fallback and come back as a
// web page, which is no answer to a program.
api.MapFallback("{**path}", () => Results.Json(
        new { error = "not_found", message = "There is no such route on this server." },
        statusCode: StatusCodes.Status404NotFound))
    .AllowAnyDesktopVersion();

spa.MapFallback(app);

var startup = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Foxfire");

if (spa.IsAvailable)
{
    startup.LogInformation("Serving the web client from {Root}", spa.Root);
}
else
{
    startup.LogInformation(
        "No web client build found, so this server answers the API only. Desktops are unaffected.");
}

startup.LogInformation(
    "Foxfire Server for '{Name}' at {PublicUrl} — API v{ApiVersion}, serving desktop {Minimum} to {Recommended}",
    serverOptions.Name,
    serverOptions.PublicUrl,
    DesktopCompatibility.ApiVersion,
    DesktopCompatibility.AllowList.Minimum,
    DesktopCompatibility.AllowList.Recommended);

// The container, once, at boot. Not awaited into the startup path — a blob
// store that is slow to answer is no reason to refuse to serve match history —
// and a failure turns the feature off rather than the server.
_ = Task.Run(async () =>
{
    var storage = app.Services.GetRequiredService<IReplayStorage>();

    if (!storage.IsConfigured)
    {
        startup.LogInformation(
            "No blob store configured, so replays are not shared. Everything else works; set "
            + "ConnectionStrings__Blob to turn it on.");
        return;
    }

    try
    {
        await storage.PrepareAsync(app.Lifetime.ApplicationStopping);
        startup.LogInformation("Blob store ready for replays.");
    }
    catch (ReplayStorageException ex)
    {
        startup.LogError(ex, "The blob store could not be reached; replay sharing will fail until it can");
    }
});

if (!smtpOptions.IsConfigured)
{
    startup.LogWarning(
        "No SMTP configured, so nothing will be emailed. Invite links are still readable from the admin "
        + "pages, in the desktop app or the web client — copy them to your community wherever it actually talks.");
}

// The one place a key rejection becomes news. The limiter latches the moment
// Riot refuses, which for a personal key is usually the middle of the night;
// pushing it means the banner is waiting for whoever opens Foxfire next rather
// than being discovered by somebody wondering why nothing synced.
//
// Resolved lazily inside the handler: the hub context is a singleton, but
// resolving it here would build it before the app has finished starting.
app.Services.GetRequiredService<RiotRateLimiter>().KeyRejectedOnce += () =>
{
    startup.LogWarning("Telling connected desktops that Riot has refused this server's key");
    _ = app.Services.GetRequiredService<IServerEvents>().RiotKeyRejectedAsync();
};

// Probe the Riot key now rather than finding out from a friend that nothing
// syncs. Not awaited: a slow or unreachable Riot is no reason to refuse to
// serve data this server already has.
_ = Task.Run(async () =>
{
    var riot = app.Services.GetRequiredService<RiotClient>();
    if (await riot.ValidateKeyAsync(app.Lifetime.ApplicationStopping))
    {
        startup.LogInformation("Riot API key accepted.");
    }
    else
    {
        startup.LogError(
            "Riot rejected this server's API key. Stored data still reads, but nothing new will be "
            + "fetched. Personal keys expire every 24 hours — replace Riot__ApiKey and restart.");
    }
});

await app.RunAsync();

/// <summary>Named so the test host can reference it.</summary>
public partial class Program;
