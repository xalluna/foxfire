using MediatR;

namespace Foxfire.Api.Common;

/// <summary>
/// The mark that says "run my validator first".
///
/// Non-generic, so that <see cref="ValidationBehavior{TRequest, TResponse}"/>
/// can test for it with a type pattern instead of reflecting over the request.
/// Nothing implements this directly.
/// </summary>
public interface IValidated;

/// <summary>
/// A request that wants its validator run before its handler, answering with a
/// status and nothing else.
///
/// Opt-in rather than automatic, which is how the reference project does it and
/// is worth keeping. Most of this server's rules are not validation and will not
/// come through here: "RANKED_SOLO_5x5 is a ranked queue" is, and "this Riot
/// account exists and is yours" is a question for the database, which belongs
/// in the handler returning an <see cref="Error"/>.
/// </summary>
public interface IValidatedRequest : IEmptyDomainRequest, IValidated;

/// <inheritdoc cref="IValidatedRequest"/>
public interface IValidatedRequest<TData> : IDomainRequest<TData>, IValidated;

public interface IValidatedRequestHandler<in TRequest> : IRequestHandler<TRequest, Response>
    where TRequest : IValidatedRequest;

public interface IValidatedRequestHandler<in TRequest, TData> : IRequestHandler<TRequest, Response<TData>>
    where TRequest : IValidatedRequest<TData>;
