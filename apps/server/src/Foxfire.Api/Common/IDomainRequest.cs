using MediatR;

namespace Foxfire.Api.Common;

/// <summary>
/// Something the API can be asked to do.
///
/// The marker interfaces are the reference project's, and they earn their place
/// twice over: they save every request spelling out IRequest&lt;Response&lt;T&gt;&gt;, and
/// — because MediatR can register an open behaviour against an interface — they
/// are how a request opts into the validation pipeline. See IValidatedRequest.
/// </summary>
public interface IDomainRequest;

/// <summary>A request whose answer is a status and nothing else.</summary>
public interface IEmptyDomainRequest : IDomainRequest, IRequest<Response>;

/// <summary>A request that answers with something.</summary>
public interface IDomainRequest<TData> : IDomainRequest, IRequest<Response<TData>>;

public interface IDomainRequestHandler<in TRequest, TData> : IRequestHandler<TRequest, Response<TData>>
    where TRequest : IDomainRequest<TData>;

public interface IDomainRequestHandler<in TRequest> : IRequestHandler<TRequest, Response>
    where TRequest : IEmptyDomainRequest;
