using FluentValidation;
using MediatR;

namespace Foxfire.Api.Common;

/// <summary>
/// Runs a request's validator, if it wanted one, before its handler.
///
/// The shape here is deliberately not the reference project's, because that one
/// does not work. It declares a behaviour against the marker interface —
/// IPipelineBehavior&lt;IValidatedRequest, Response&gt; — and hands it to
/// AddOpenBehavior, which refuses a type that is not generic; the one-parameter
/// generic beside it cannot close a two-parameter interface either. Even
/// registered by hand, both would depend on the container resolving
/// IPipelineBehavior contravariantly when it builds the set for a concrete
/// request, which it does not do.
///
/// So this is an ordinary open behaviour over both parameters, and the opt-in
/// survives as a type test on <see cref="IValidated"/>. Two things fall out of
/// that. TRequest is the concrete request, so the validator is injected rather
/// than looked up reflectively — no MakeGenericType, and a missing validator is
/// an empty sequence rather than a null. And TResponse builds its own failure
/// through <see cref="IResponse{TSelf}"/>, so the behaviour never has to know
/// whether it is holding a Response or a Response&lt;T&gt;.
///
/// A request with no registered validator passes straight through, which is
/// what lets a request opt in before its rules exist and keeps a request whose
/// rules are all about the database from needing an empty validator to say so.
/// </summary>
public sealed class ValidationBehavior<TRequest, TResponse>(IEnumerable<IValidator<TRequest>> validators)
    : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
    where TResponse : IResponse<TResponse>
{
    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(next);

        if (request is not IValidated) return await next();

        foreach (var validator in validators)
        {
            var result = await validator.ValidateAsync(request, cancellationToken);
            if (result.IsValid) continue;

            return TResponse.FromErrors([.. result.Errors.Select(failure => (Error)failure)]);
        }

        return await next();
    }
}
