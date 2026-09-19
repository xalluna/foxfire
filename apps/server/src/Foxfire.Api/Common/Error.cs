using FluentValidation.Results;

namespace Foxfire.Api.Common;

/// <summary>
/// One reason a request could not be answered.
///
/// A code and a message, in that order, and the code is the part that matters.
/// Every error this server returns is read by a desktop that switches on it —
/// invite_required opens a different screen, riot_key_rejected shows a banner,
/// not_your_account is not worth retrying — so the message is for a person and
/// the code is for the program.
///
/// That is the one place this diverges from the reference project, whose Error
/// is a message and a property name. Foxfire's wire contract already has a code
/// on it and cannot lose one.
/// </summary>
public sealed record Error(string Code, string Message)
{
    /// <summary>
    /// The code a validation failure with nothing better to say falls back to.
    ///
    /// FluentValidation fills ErrorCode with the name of whichever rule failed
    /// — "NotEmptyValidator" — when nobody sets one. That is a C# class name
    /// leaking onto a wire the desktop switches on, so it is caught here rather
    /// than shipped.
    /// </summary>
    public const string InvalidRequest = "invalid_request";

    public static implicit operator Error(ValidationFailure failure)
    {
        ArgumentNullException.ThrowIfNull(failure);

        var code = failure.ErrorCode;
        var named = !string.IsNullOrEmpty(code) && !code.EndsWith("Validator", StringComparison.Ordinal);

        return new Error(named ? code : InvalidRequest, failure.ErrorMessage);
    }
}
