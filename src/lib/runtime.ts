import { Cause, Effect, Exit, Layer, Schema } from 'effect';
import { DbError, DbService, dbServiceLayer } from '$lib/services/db.service';
import { NodeServices } from '@effect/platform-node';
import { error } from '@sveltejs/kit';

// this file contains the effect runner which should be used in endpoints, load functions, actions, and remote functions to execute effectful code and handle errors.

// when a new service is created, add it to the app layer. and add it's error type to the effect runner.
const appLayer = Layer.mergeAll(dbServiceLayer, NodeServices.layer);

export class GenericError extends Schema.ErrorClass<GenericError>('GenericError')({
	message: Schema.String,
	code: Schema.Number,
	cause: Schema.optional(Schema.Defect)
}) {}

export const effectRunner = async <T>(
	effect: Effect.Effect<T, DbError | GenericError, DbService | NodeServices.NodeServices>
) => {
	const exit = await effect.pipe(Effect.provide(appLayer), Effect.runPromiseExit);

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
