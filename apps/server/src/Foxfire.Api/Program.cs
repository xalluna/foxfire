using System.Text;
using Foxfire.Api.Auth;
using Foxfire.Api.Configuration;
using Foxfire.Api.Endpoints;
using Foxfire.Api.Services;
using Foxfire.Api.Startup;
using Foxfire.Api.Sync;
using Foxfire.Api.Versioning;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
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

var serverOptions = builder.Configuration.GetSection(ServerOptions.Section).Get<ServerOptions>() ?? new();
var riotOptions = builder.Configuration.GetSection(RiotOptions.Section).Get<RiotOptions>() ?? new();
var authOptions = builder.Configuration.GetSection(AuthOptions.Section).Get<AuthOptions>() ?? new();
var adminOptions = builder.Configuration.GetSection(AdminOptions.Section).Get<AdminOptions>() ?? new();
var smtpOptions = builder.Configuration.GetSection(SmtpOptions.Section).Get<SmtpOptions>() ?? new();
var connectionString = builder.Configuration.GetConnectionString("Default");

// Everything wrong with the configuration, in one message, before anything
// starts. A host should not have to restart a container five times to find five
// missing settings, and a server that started degraded would be worse than one
// that refused — half of these produce failures that look like something else.
var problems = ConfigurationCheck.Validate(connectionString, serverOptions, riotOptions, authOptions, adminOptions);
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
        // Email is the login, so it has to be unique. Usernames are display
        // names and are deliberately not.
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

builder.Services.AddScoped<TokenService>();
builder.Services.AddScoped<ServerSettingsService>();

// The ingestion half. Scoped, because each of these is a DbContext and a
// little logic on top of it; the engine that drives them is not, because a
// sync outlives the request that asked for it.
builder.Services.AddScoped<MatchIngestion>();
builder.Services.AddScoped<RankRecorder>();
builder.Services.AddScoped<AttributionRunner>();
builder.Services.AddScoped<IdentityRepair>();

builder.Services.AddSingleton<ISyncProgressSink, SignalRSyncProgressSink>();
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

builder.Services.AddProblemDetails();

var app = builder.Build();

await app.Services.PrepareDatabaseAsync(app.Lifetime.ApplicationStopping);

app.UseExceptionHandler();
app.UseRouting();

// Before authentication: a desktop this server does not speak to should be told
// so, not handed an authentication failure it cannot act on.
app.UseDesktopVersionGate();

app.UseAuthentication();
app.UseAuthorization();

app.MapVersionEndpoints();
app.MapAuthEndpoints();
app.MapInviteEndpoints();
app.MapAdminSettingsEndpoints();
app.MapAdminUserEndpoints();
app.MapRiotLinkEndpoints();
app.MapSyncEndpoints();
app.MapHub<FoxfireHub>(FoxfireHub.Path);

var startup = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Foxfire");

startup.LogInformation(
    "Foxfire Server for '{Name}' at {PublicUrl} — API v{ApiVersion}, serving desktop {Minimum} to {Recommended}",
    serverOptions.Name,
    serverOptions.PublicUrl,
    DesktopCompatibility.ApiVersion,
    DesktopCompatibility.AllowList.Minimum,
    DesktopCompatibility.AllowList.Recommended);

if (!smtpOptions.IsConfigured)
{
    startup.LogWarning(
        "No SMTP configured, so nothing will be emailed. Invite links are still readable from the admin "
        + "section of the desktop app — copy them to your community wherever it actually talks.");
}

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
