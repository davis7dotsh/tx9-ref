import { env } from '$env/dynamic/private';
import { Daytona } from '@daytonaio/sdk';
import { Effect, Layer, Schema, Scope, ServiceMap } from 'effect';
import coderunBundle from 'virtual:coderun-bundle';

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

	// an llm stream that's running on the sandbox
	const codeRunStream = Effect.gen(function* () {
		const sandbox = yield* Effect.tryPromise({
			try: () =>
				daytona.create({
					envVars: {
						OPENAI_API_KEY: env.OPENAI_API_KEY
					}
				}),
			catch: (error) =>
				new DaytonaError({
					message: 'Failed to create sandbox',
					code: 500,
					cause: error
				})
		});

		yield* Effect.addFinalizer(() =>
			Effect.promise(async () => {
				console.log('stopping sandbox');
				await sandbox.stop();
				console.log('sandbox stopped');
			})
		);
	});

	// a basic snippet of code that can be run in the sandbox
	const basicCodeRun = Effect.gen(function* () {
		yield* Effect.logInfo('Creating sandbox');
		const sandbox = yield* Effect.tryPromise({
			try: () => daytona.create(),
			catch: (error) =>
				new DaytonaError({
					message: 'Failed to create sandbox',
					code: 500,
					cause: error
				})
		});

		yield* Effect.addFinalizer(() =>
			Effect.promise(async () => {
				console.log('stopping sandbox');
				await sandbox.stop();
				console.log('sandbox stopped');
			})
		);

		yield* Effect.tryPromise({
			try: () => sandbox.fs.uploadFile(Buffer.from(coderunBundle), '/tmp/coderun.mjs'),
			catch: (error) =>
				new DaytonaError({
					message: 'Failed to upload coderun bundle',
					code: 500,
					cause: error
				})
		});

		const response = yield* Effect.tryPromise({
			try: () => sandbox.process.executeCommand('node /tmp/coderun.mjs'),
			catch: (error) =>
				new DaytonaError({
					message: 'Failed to execute coderun',
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
		}

		yield* Effect.logInfo(`Sandbox output: ${response.result}`);
		return response;
	});

	return {
		basicCodeRun
	};
});

export class DaytonaService extends ServiceMap.Service<
	DaytonaService,
	Effect.Success<typeof daytonaServiceEffect>
>()('DaytonaService') {}

export const daytonaServiceLayer = Layer.effect(DaytonaService)(daytonaServiceEffect);
