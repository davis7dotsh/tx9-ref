import { Cause, Effect, Exit, Layer, ManagedRuntime, Schema } from 'effect';
import { DbError, DbService, dbServiceLayer } from '$lib/services/db.service';
import { DaytonaError, DaytonaService, daytonaServiceLayer } from '$lib/services/daytona.service';
import { NodeServices } from '@effect/platform-node';
import { error } from '@sveltejs/kit';

const appLayer = Layer.mergeAll(dbServiceLayer, NodeServices.layer, daytonaServiceLayer);

export const runtime = ManagedRuntime.make(appLayer);

export class GenericError extends Schema.ErrorClass<GenericError>('GenericError')({
	message: Schema.String,
	code: Schema.Number,
	cause: Schema.optional(Schema.Defect)
}) {}

export const effectRunner = async <T>(
	effect: Effect.Effect<
		T,
		DbError | GenericError | DaytonaError,
		DbService | NodeServices.NodeServices | DaytonaService
	>
) => {
	const exit = await runtime.runPromiseExit(effect);

	if (Exit.isFailure(exit)) {
		const cause = exit.cause;

		// logging step
		for (const reason of cause.reasons) {
			if (Cause.isFailReason(reason)) {
				console.error('Error:', reason.error);
			} else if (Cause.isDieReason(reason)) {
				console.error('Defect:', reason.defect);
			} else if (Cause.isInterruptReason(reason)) {
				console.error('Interrupted, fiber ID:', reason.fiberId);
			}
		}

		// send down the first error to the client
		const firstError = Cause.findErrorOption(cause);
		if (firstError._tag === 'Some') {
			const { code, message, cause: firstErrorCause } = firstError.value;
			return error(code, {
				message,
				cause: firstErrorCause
			});
		}

		return error(500, {
			message: 'An unknown error occurred',
			cause: cause
		});
	}

	return exit.value;
};
