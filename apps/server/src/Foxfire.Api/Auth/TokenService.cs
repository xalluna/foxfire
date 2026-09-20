using System.Security.Claims;
using System.Security.Cryptography;
using Foxfire.Api.Configuration;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Foxfire.Api.Auth;

/// <summary>A signed-in session, as the desktop receives it.</summary>
/// <param name="AccessToken">Minutes long. Sent as a bearer token on every call.</param>
/// <param name="AccessTokenExpiresAt">When to stop using it. The desktop refreshes before this.</param>
/// <param name="RefreshToken">The only time this value is ever readable. Only its hash is stored.</param>
/// <param name="RefreshTokenExpiresAt">When the desktop has to ask for a password again.</param>
public sealed record TokenPair(
    string AccessToken,
    DateTimeOffset AccessTokenExpiresAt,
    string RefreshToken,
    DateTimeOffset RefreshTokenExpiresAt);

/// <summary>
/// Mints and redeems the two tokens a signed-in desktop carries.
///
/// The split is the usual one, for the usual reason. An access token is signed
/// and self-describing, so checking it costs no database round trip — and cannot
/// be revoked, which is why it lasts minutes. A refresh token is a row, so it
/// can be revoked the instant somebody signs out everywhere, and lasts a month
/// because the thing holding it is a background watcher that polls the League
/// client for days and must not stop to ask for a password.
///
/// Refresh tokens rotate: redeeming one mints its replacement and marks it
/// spent. That makes a stolen token detectable rather than merely possible —
/// presenting an already-spent token means the chain it was copied from is still
/// running somewhere, and the whole chain is cut.
/// </summary>
public sealed class TokenService(
    FoxfireDbContext db,
    IOptions<AuthOptions> authOptions,
    TimeProvider time,
    ILogger<TokenService> logger)
{
    private readonly AuthOptions _auth = authOptions.Value;

    /// <summary>The issuer and audience both. One server, talking to its own clients.</summary>
    public const string Issuer = "foxfire";

    /// <summary>
    /// Signs somebody in and hands back both tokens.
    ///
    /// The refresh token is generated here and returned in plaintext exactly
    /// once; what goes in the database is its SHA-256. A server that stores
    /// these readably hands over every live session the moment its database is
    /// read by the wrong person.
    ///
    /// Unsalted SHA-256 is right here and would be wrong for a password: the
    /// input is 256 bits this server generated at random, so there is no
    /// dictionary to run and nothing to precompute.
    /// </summary>
    public async Task<TokenPair> IssueAsync(
        FoxfireUser user,
        IEnumerable<string> roles,
        string? deviceLabel,
        CancellationToken cancellationToken = default)
    {
        var now = time.GetUtcNow();
        var (row, raw) = NewRefreshToken(user.Id, deviceLabel, now);

        db.RefreshTokens.Add(row);
        await db.SaveChangesAsync(cancellationToken);

        var (access, accessExpiry) = IssueAccessToken(user, roles, now);
        return new TokenPair(access, accessExpiry, raw, row.ExpiresAt);
    }

    /// <summary>
    /// Builds a refresh token and its row together.
    ///
    /// Together, because the caller needs both halves at once: the plaintext to
    /// hand back, which is never readable again, and the row's id, so a rotation
    /// can record which token replaced which without having to go and find it.
    /// </summary>
    private (RefreshToken Row, string Raw) NewRefreshToken(Guid userId, string? deviceLabel, DateTimeOffset now)
    {
        var raw = Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));

        var row = new RefreshToken
        {
            Id = Guid.CreateVersion7(now),
            UserId = userId,
            TokenHash = Hash(raw),
            CreatedAt = now,
            ExpiresAt = now + _auth.RefreshTokenLifetime,
            DeviceLabel = Trim(deviceLabel)
        };

        return (row, raw);
    }

    /// <summary>
    /// Trades a refresh token for a fresh pair, or returns null if it is no good.
    ///
    /// Null covers every reason — unknown, expired, already spent, belonging to a
    /// deleted account — on purpose. A caller holding a bad token learns only
    /// that it is bad, which is all they are entitled to and all the desktop
    /// needs to decide to ask for a password.
    /// </summary>
    public async Task<TokenPair?> RefreshAsync(
        string? refreshToken,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(refreshToken)) return null;

        var hash = Hash(refreshToken);
        var stored = await db.RefreshTokens
            .Include(t => t.User)
            .FirstOrDefaultAsync(t => t.TokenHash == hash, cancellationToken);

        if (stored is null) return null;

        var now = time.GetUtcNow();

        // Already spent, and being presented again. The legitimate holder has
        // the replacement, so this is a copy — and the safe reading of a copy in
        // use is that the chain is compromised. Cut all of it and make everybody
        // on this account sign in again.
        if (stored.RevokedAt is not null)
        {
            logger.LogWarning(
                "A spent refresh token was replayed for user {UserId}; revoking every session on that account",
                stored.UserId);

            await RevokeAllAsync(stored.UserId, cancellationToken);
            return null;
        }

        if (!stored.IsLive(now)) return null;
        if (stored.User is null) return null;

        var (replacement, raw) = NewRefreshToken(stored.UserId, stored.DeviceLabel, now);
        db.RefreshTokens.Add(replacement);

        // Spent, and pointing at what replaced it. Both writes land in the same
        // SaveChanges as the new row, so there is no instant at which the old
        // token is dead and the new one does not yet exist.
        stored.RevokedAt = now;
        stored.ReplacedById = replacement.Id;

        await db.SaveChangesAsync(cancellationToken);

        var roles = await RolesOfAsync(stored.UserId, cancellationToken);
        var (access, accessExpiry) = IssueAccessToken(stored.User, roles, now);
        return new TokenPair(access, accessExpiry, raw, replacement.ExpiresAt);
    }

    /// <summary>Signs one session out. Silent when the token means nothing.</summary>
    public async Task RevokeAsync(string? refreshToken, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(refreshToken)) return;

        var hash = Hash(refreshToken);
        var stored = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash, cancellationToken);
        if (stored is null || stored.RevokedAt is not null) return;

        stored.RevokedAt = time.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>Signs every session on an account out. Used on password change and by an admin.</summary>
    public async Task RevokeAllAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var now = time.GetUtcNow();

        await db.RefreshTokens
            .Where(t => t.UserId == userId && t.RevokedAt == null)
            .ExecuteUpdateAsync(t => t.SetProperty(x => x.RevokedAt, now), cancellationToken);
    }

    private (string Token, DateTimeOffset ExpiresAt) IssueAccessToken(
        FoxfireUser user,
        IEnumerable<string> roles,
        DateTimeOffset now)
    {
        var expiresAt = now + _auth.AccessTokenLifetime;

        List<Claim> claims =
        [
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.CreateVersion7(now).ToString()),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.UserName ?? ""),
            new(ClaimTypes.Email, user.Email ?? "")
        ];

        claims.AddRange(roles.Select(role => new Claim(ClaimTypes.Role, role)));

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Issuer,
            Subject = new ClaimsIdentity(claims),
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = expiresAt.UtcDateTime,
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(_auth.JwtSigningKeyBytes),
                SecurityAlgorithms.HmacSha256)
        };

        return (new JsonWebTokenHandler().CreateToken(descriptor), expiresAt);
    }

    private async Task<List<string>> RolesOfAsync(Guid userId, CancellationToken cancellationToken) =>
        await (from userRole in db.UserRoles
               join role in db.Roles on userRole.RoleId equals role.Id
               where userRole.UserId == userId && role.Name != null
               select role.Name!).ToListAsync(cancellationToken);

    private static byte[] Hash(string token) => SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token));

    private static string? Trim(string? label) =>
        string.IsNullOrWhiteSpace(label) ? null : label.Trim()[..Math.Min(label.Trim().Length, 128)];
}
