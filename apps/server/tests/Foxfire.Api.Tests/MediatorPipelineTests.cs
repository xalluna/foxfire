using FluentValidation;
using Foxfire.Api.Common;
using MediatR;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// That the validation behaviour actually runs.
///
/// Worth its own suite because of how it would fail otherwise. Validation is
/// opt-in, so the behaviour has to decide per request whether to do anything at
/// all — and the failure mode of getting that wrong is silence. Nothing throws
/// and nothing logs; every validator is simply never called, and the first
/// symptom is a bad request being handled as though it were a good one.
///
/// The reference project's arrangement fails exactly this way, which is how the
/// shape here came to differ from it.
///
/// Fifty routes are going to sit on this, so it is asserted directly rather
/// than inferred from an endpoint test passing.
/// </summary>
public class MediatorPipelineTests
{
    private static ServiceProvider Container()
    {
        var services = new ServiceCollection();

        services.AddMediatR(mediator =>
        {
            mediator.RegisterServicesFromAssemblyContaining<MediatorPipelineTests>();
            mediator.AddOpenBehavior(typeof(ValidationBehavior<,>));
        });

        services.AddValidatorsFromAssemblyContaining<MediatorPipelineTests>(includeInternalTypes: true);

        return services.BuildServiceProvider();
    }

    [Fact]
    public async Task A_validator_runs_before_the_handler_it_belongs_to()
    {
        await using var container = Container();
        var sender = container.GetRequiredService<ISender>();

        var refused = await sender.Send(new Doubling(-1));

        Assert.NotEmpty(refused.Errors);
        Assert.Equal("negative_number", refused.Errors[0].Code);
        Assert.Equal("A number to double is zero or more.", refused.Errors[0].Message);

        // And the handler did not run: a handled -1 would have come back as -2
        // rather than as no data at all.
        Assert.Equal(0, refused.Data);
    }

    [Fact]
    public async Task A_request_that_passes_its_validator_reaches_its_handler()
    {
        await using var container = Container();
        var sender = container.GetRequiredService<ISender>();

        var answer = await sender.Send(new Doubling(21));

        Assert.Empty(answer.Errors);
        Assert.Equal(42, answer.Data);
    }

    [Fact]
    public async Task A_validator_with_nothing_to_say_defaults_to_a_code_rather_than_a_class_name()
    {
        // FluentValidation fills ErrorCode with "NotEmptyValidator" and friends
        // when a rule does not name one. That is a C# type leaking onto a wire
        // the desktop switches on.
        await using var container = Container();
        var sender = container.GetRequiredService<ISender>();

        var refused = await sender.Send(new Naming(""));

        Assert.Equal(Error.InvalidRequest, Assert.Single(refused.Errors).Code);
    }

    [Fact]
    public async Task A_request_that_did_not_opt_in_is_not_validated()
    {
        // Unvalidated implements IDomainRequest rather than IValidatedRequest,
        // so its validator — which refuses everything — must never run.
        await using var container = Container();
        var sender = container.GetRequiredService<ISender>();

        var answer = await sender.Send(new Unvalidated(-1));

        Assert.Empty(answer.Errors);
        Assert.Equal(-1, answer.Data);
    }

    /* ---------------------------------------------------------------- */

    internal sealed record Doubling(int Number) : IValidatedRequest<int>;

    internal sealed class DoublingHandler : IValidatedRequestHandler<Doubling, int>
    {
        public Task<Response<int>> Handle(Doubling request, CancellationToken cancellationToken) =>
            Task.FromResult<Response<int>>(request.Number * 2);
    }

    internal sealed class DoublingValidator : AbstractValidator<Doubling>
    {
        public DoublingValidator() =>
            RuleFor(x => x.Number)
                .GreaterThanOrEqualTo(0)
                .WithErrorCode("negative_number")
                .WithMessage("A number to double is zero or more.");
    }

    internal sealed record Naming(string Name) : IValidatedRequest<string>;

    internal sealed class NamingHandler : IValidatedRequestHandler<Naming, string>
    {
        public Task<Response<string>> Handle(Naming request, CancellationToken cancellationToken) =>
            Task.FromResult<Response<string>>(request.Name);
    }

    internal sealed class NamingValidator : AbstractValidator<Naming>
    {
        public NamingValidator() => RuleFor(x => x.Name).NotEmpty();
    }

    internal sealed record Unvalidated(int Number) : IDomainRequest<int>;

    internal sealed class UnvalidatedHandler : IDomainRequestHandler<Unvalidated, int>
    {
        public Task<Response<int>> Handle(Unvalidated request, CancellationToken cancellationToken) =>
            Task.FromResult<Response<int>>(request.Number);
    }

    internal sealed class UnvalidatedValidator : AbstractValidator<Unvalidated>
    {
        public UnvalidatedValidator() =>
            RuleFor(x => x.Number).GreaterThan(int.MaxValue - 1).WithErrorCode("never_runs");
    }
}
