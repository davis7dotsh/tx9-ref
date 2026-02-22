import { env } from '$env/dynamic/private';
import { Daytona } from '@daytonaio/sdk';
import { Effect, Layer, Schema, ServiceMap } from 'effect';

// stuff to do with daytona:
// pass env vars into a sandbox
// run some actual code in the sandbox

export class DaytonaError extends Schema.ErrorClass<DaytonaError>('DaytonaError')({
	message: Schema.String,
	code: Schema.Number,
	cause: Schema.optional(Schema.Defect)
}) {}

const daytonaServiceEffect = Effect.gen(function* () {
	const daytona = new Daytona({
		apiKey: env.DAYTONA_API_KEY,
		apiUrl: env.DAYTONA_BASE_URL
	});

	const sandboxTest = Effect.gen(function* () {
		const sandbox = yield* Effect.tryPromise({
			try: () =>
				daytona.create({
					language: 'typescript'
				}),
			catch: (error) =>
				new DaytonaError({
					message: 'Failed to test sandbox',
					code: 500,
					cause: error
				})
		});

		const response = yield* Effect.tryPromise({
			try: () => sandbox.process.codeRun(`console.log("Hello, world!")`),
			catch: (error) =>
				new DaytonaError({
					message: 'Failed to execute sandbox',
					code: 500,
					cause: error
				})
		});

		if (response.exitCode !== 0) {
			return yield* Effect.fail(
				new DaytonaError({
					message: `Error: ${response.exitCode} ${response.result}`,
					code: 500,
					cause: new Error(response.result)
				})
			);
		} else {
			yield* Effect.logInfo(`Sandbox output: ${response.result}`);
		}

		return response;
	});

	return {
		sandboxTest
	};
});

export class DaytonaService extends ServiceMap.Service<
	DaytonaService,
	Effect.Success<typeof daytonaServiceEffect>
>()('DaytonaService') {}

export const daytonaServiceLayer = Layer.effect(DaytonaService)(daytonaServiceEffect);
