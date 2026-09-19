using MediatR;

namespace Foxfire.Api.Common;

/// <summary>
/// Turning a handler's answer back into an HTTP one.
///
/// This is the reference project's BaseApplicationController.Process, minus the
/// controller and minus the envelope. There, Process serialises the Response
/// itself, so every payload reaches the client inside { data, errors }. Here it
/// is unwrapped, because Foxfire's wire contract predates MediatR and cannot
/// move: the desktop reads the payload's own fields at the top level and reads
/// a failure as { error, message }.
///
/// So the pattern is internal and the contract is untouched. Which is the point
/// of doing it this way rather than the reference's way — a refactor that
/// changed every response shape would be a rewrite of the desktop too, and the
/// only thing that would notice first is a screen rendering a blank.
/// </summary>
public static class ResponseResults
{
    /// <summary>
    /// Send it, then turn the answer into an HTTP one.
    ///
    /// A route could await and call ToResult itself. Fifty of them doing it is
    /// fifty chances to write the endpoint's real work into a lambda again,
    /// which is the thing this whole change is getting away from — so the
    /// one-liner is the only shape a route needs.
    /// </summary>
    public static async Task<IResult> SendAsync<TResponse>(
        this ISender sender,
        IRequest<TResponse> request,
        CancellationToken cancellationToken)
        where TResponse : IResponse
    {
        ArgumentNullException.ThrowIfNull(sender);
        return (await sender.Send(request, cancellationToken)).ToResult();
    }

    public static IResult ToResult(this IResponse response)
    {
        ArgumentNullException.ThrowIfNull(response);

        if (response.Errors.Count > 0) return Failure(response);

        // No payload means no body: a 204 on a write, or a bare 404. Both are
        // shapes the endpoints already return, and a null serialised as "null"
        // would be a change to all of them.
        return response.Payload is null
            ? Results.StatusCode(response.StatusCode)
            : Results.Json(response.Payload, statusCode: response.StatusCode);
    }

    /// <summary>
    /// One code and one message, which is the shape every route on this server
    /// has always answered a failure with.
    ///
    /// Several errors collapse into one answer because that is what the desktop
    /// reads. The first error's code wins — a handler returning more than one
    /// is a validator reporting several failed rules, and they share a code —
    /// and the messages are joined, the way a failed registration already joins
    /// whatever Identity had to say.
    /// </summary>
    private static IResult Failure(IResponse response)
    {
        var code = response.Errors[0].Code;
        var message = string.Join(" ", response.Errors.Select(e => e.Message));

        return Results.Json(new { error = code, message }, statusCode: response.StatusCode);
    }
}
