using System.Security.Claims;

namespace Foxfire.Api.Common;

/// <summary>
/// Who is asking.
///
/// Endpoints used to take a ClaimsPrincipal as a parameter and minimal APIs
/// filled it in. A MediatR handler is not an endpoint and gets no such favour,
/// so the principal has to be reachable from the container instead — which is
/// what the reference project's IIdentityContext is for.
///
/// Scoped, like the request it describes. Null covers every way there is no
/// answer at once: no token, a token with no id on it, or code running outside
/// a request altogether — a background sync, or a test. Every caller already
/// had to handle "not signed in", so none of them gain a case.
/// </summary>
public interface IIdentityContext
{
    /// <summary>The Foxfire account making this request, or null.</summary>
    Guid? UserId { get; }

    /// <summary>Whether they hold a role. False when nobody is signed in.</summary>
    bool IsInRole(string role);
}

/// <summary>The real one, reading the claims off the request in flight.</summary>
public sealed class HttpIdentityContext(IHttpContextAccessor accessor) : IIdentityContext
{
    public Guid? UserId =>
        Guid.TryParse(accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
            ? id
            : null;

    public bool IsInRole(string role) => accessor.HttpContext?.User.IsInRole(role) ?? false;
}
