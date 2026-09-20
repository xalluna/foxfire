using System.Net;

namespace Foxfire.Api.Common;

/// <summary>
/// What a handler answers with when there is nothing to hand back.
/// </summary>
public sealed record Response : IResponse<Response>
{
    private Response(HttpStatusCode statusCode, IReadOnlyList<Error>? errors = null)
    {
        StatusCode = (int)statusCode;
        Errors = errors ?? [];
    }

    public IReadOnlyList<Error> Errors { get; }

    public int StatusCode { get; }

    public object? Payload => null;

    /// <summary>204, which is what every write on this server already answers with.</summary>
    public static Response Success(HttpStatusCode statusCode = HttpStatusCode.NoContent) => new(statusCode);

    public static Response Failure(Error error, HttpStatusCode statusCode = HttpStatusCode.BadRequest) =>
        new(statusCode, [error]);

    public static Response Failure(IReadOnlyList<Error> errors, HttpStatusCode statusCode = HttpStatusCode.BadRequest) =>
        new(statusCode, errors);

    /// <summary>A bare 404, with no body — the shape the endpoints already return.</summary>
    public static Response NotFound() => new(HttpStatusCode.NotFound);

    public static implicit operator Response(Error error) => Failure(error);

    static Response IResponse<Response>.FromErrors(IReadOnlyList<Error> errors) => Failure(errors);
}

/// <summary>
/// What a handler answers with, and what became of it.
///
/// The implicit conversions are the whole ergonomic point, and they come
/// straight from the reference project: a handler returns the DTO for success
/// and an <see cref="Error"/> for failure, with no wrapper to spell out at
/// either exit.
///
/// Where this parts company with the reference is that the envelope never
/// reaches the wire. There, Response itself is what a controller serialises, so
/// every payload arrives wrapped in { data, errors }. Foxfire's responses are
/// unwrapped — the desktop reads { snapshots, milestones } at the top level,
/// and nine tests assert those key names because no compiler spans the two
/// languages — so this is transport between a handler and an endpoint, and
/// <see cref="ResponseResults.ToResult"/> takes it apart again.
/// </summary>
public sealed record Response<TData> : IResponse<Response<TData>>
{
    private Response(TData? data, HttpStatusCode statusCode, IReadOnlyList<Error>? errors = null)
    {
        Data = data;
        StatusCode = (int)statusCode;
        Errors = errors ?? [];
    }

    public TData? Data { get; }

    public IReadOnlyList<Error> Errors { get; }

    public int StatusCode { get; }

    public object? Payload => Data;

    public static Response<TData> Success(TData data, HttpStatusCode statusCode = HttpStatusCode.OK) =>
        new(data, statusCode);

    public static Response<TData> Failure(Error error, HttpStatusCode statusCode = HttpStatusCode.BadRequest) =>
        new(default, statusCode, [error]);

    public static Response<TData> Failure(
        IReadOnlyList<Error> errors,
        HttpStatusCode statusCode = HttpStatusCode.BadRequest) =>
        new(default, statusCode, errors);

    /// <summary>A bare 404, with no body.</summary>
    public static Response<TData> NotFound() => new(default, HttpStatusCode.NotFound);

    public static implicit operator Response<TData>(TData data) => Success(data);

    public static implicit operator Response<TData>(Error error) => Failure(error);

    static Response<TData> IResponse<Response<TData>>.FromErrors(IReadOnlyList<Error> errors) => Failure(errors);
}

/// <summary>
/// The part of a response that does not depend on what is in it.
///
/// It exists so <see cref="ResponseResults.ToResult"/> can be written once
/// rather than once per arity.
/// </summary>
public interface IResponse
{
    IReadOnlyList<Error> Errors { get; }

    int StatusCode { get; }

    /// <summary>What to serialise on success, or null to send no body at all.</summary>
    object? Payload { get; }
}

/// <summary>
/// A response that can build its own failure.
///
/// This is what lets <see cref="ValidationBehavior{TRequest, TResponse}"/> turn
/// a validator's complaints into whichever response its request answers with,
/// without knowing or reflecting over which one that is.
/// </summary>
public interface IResponse<TSelf> : IResponse
    where TSelf : IResponse<TSelf>
{
    static abstract TSelf FromErrors(IReadOnlyList<Error> errors);
}
