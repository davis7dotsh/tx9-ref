import { env } from '$env/dynamic/private';
import { Daytona } from '@daytonaio/sdk';
import { Effect, Layer, Schedule, Schema, ServiceMap } from 'effect';
import coderunBundle from 'virtual:coderun-bundle';
import coderunStreamBundle from 'virtual:coderun-stream-bundle';

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

	const codeRunStream = ({ messages, sandboxId }: { messages: unknown[]; sandboxId?: string }) =>
		Effect.gen(function* () {
			const sandbox = yield* sandboxId
				? Effect.gen(function* () {
						yield* Effect.logInfo(`[stream] getting sandbox ${sandboxId}`);
						const existing = yield* Effect.tryPromise({
							try: () => daytona.get(sandboxId),
							catch: (error) =>
								new DaytonaError({ message: 'Failed to get sandbox', code: 500, cause: error })
						});
						if (existing.state !== 'started') {
							yield* Effect.logInfo(`[stream] starting sandbox ${sandboxId}`);
							yield* Effect.tryPromise({
								try: () => daytona.start(existing, 60),
								catch: (error) =>
									new DaytonaError({
										message: 'Failed to start sandbox',
										code: 500,
										cause: error
									})
							});
						}
						return existing;
					})
				: Effect.gen(function* () {
						yield* Effect.logInfo('[stream] creating sandbox');
						return yield* Effect.tryPromise({
							try: () =>
								daytona.create({
									envVars: {
										OPENAI_API_KEY: env.OPENAI_API_KEY,
										EXA_API_KEY: env.EXA_API_KEY
									}
								}),
							catch: (error) =>
								new DaytonaError({ message: 'Failed to create sandbox', code: 500, cause: error })
						});
					});

			const currentSandboxId = sandbox.id;

			const preview = yield* Effect.tryPromise({
				try: () => sandbox.getPreviewLink(3213),
				catch: (error) =>
					new DaytonaError({ message: 'Failed to get preview link', code: 500, cause: error })
			});

			const previewUrl = (path: string) =>
				`${preview.url}${path}?DAYTONA_SANDBOX_AUTH_KEY=${preview.token}`;

			const isHealthy = yield* Effect.tryPromise({
				try: () =>
					fetch(previewUrl('/health'))
						.then((r) => r.ok)
						.catch(() => false),
				catch: () => false
			}).pipe(Effect.orElseSucceed(() => false));

			if (!isHealthy) {
				yield* Effect.logInfo('[stream] server not running, starting...');

				yield* Effect.tryPromise({
					try: () =>
						sandbox.fs.uploadFile(Buffer.from(coderunStreamBundle), '/tmp/coderunStream.mjs'),
					catch: (error) =>
						new DaytonaError({ message: 'Failed to upload stream bundle', code: 500, cause: error })
				});

				yield* Effect.tryPromise({
					try: () => sandbox.process.executeCommand('pkill -f coderunStream.mjs || true'),
					catch: () => ({ exitCode: 0, result: '' })
				}).pipe(Effect.ignore);

				yield* Effect.tryPromise({
					try: () => sandbox.process.createSession('stream-server'),
					catch: () => undefined
				}).pipe(Effect.ignore);

				const { cmdId } = yield* Effect.tryPromise({
					try: () =>
						sandbox.process.executeSessionCommand('stream-server', {
							command: 'node /tmp/coderunStream.mjs',
							runAsync: true
						}),
					catch: (error) =>
						new DaytonaError({ message: 'Failed to start stream server', code: 500, cause: error })
				});
				yield* Effect.logInfo(`[stream] server started cmdId=${cmdId}`);

				yield* Effect.retry(
					Effect.gen(function* () {
						const r = yield* Effect.tryPromise({
							try: () => fetch(previewUrl('/health')),
							catch: (error) =>
								new DaytonaError({ message: `Health fetch error: ${error}`, code: 503 })
						});
						if (!r.ok)
							return yield* Effect.fail(
								new DaytonaError({ message: `Health check ${r.status}`, code: 503 })
							);
					}),
					Schedule.exponential('500 millis').pipe(Schedule.compose(Schedule.recurs(20)))
				);
			}

			yield* Effect.logInfo('[stream] server ready');

			const sandboxRes = yield* Effect.tryPromise({
				try: () =>
					fetch(previewUrl('/stream'), {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ messages })
					}),
				catch: (error) =>
					new DaytonaError({ message: 'Failed to connect to stream', code: 500, cause: error })
			});

			return {
				sandboxId: currentSandboxId,
				stream: new ReadableStream<Uint8Array>({
					async start(controller) {
						try {
							const reader = sandboxRes.body!.getReader();
							while (true) {
								const { done, value } = await reader.read();
								if (done) break;
								controller.enqueue(value);
							}
							controller.close();
						} catch (e) {
							controller.error(e);
						}
					}
				})
			};
		});

	const basicCodeRun = Effect.gen(function* () {
		const sandbox = yield* Effect.tryPromise({
			try: () => daytona.create(),
			catch: (error) =>
				new DaytonaError({ message: 'Failed to create sandbox', code: 500, cause: error })
		});

		yield* Effect.addFinalizer(() => Effect.promise(() => sandbox.stop()));

		yield* Effect.tryPromise({
			try: () => sandbox.fs.uploadFile(Buffer.from(coderunBundle), '/tmp/coderun.mjs'),
			catch: (error) =>
				new DaytonaError({ message: 'Failed to upload bundle', code: 500, cause: error })
		});

		const response = yield* Effect.tryPromise({
			try: () => sandbox.process.executeCommand('node /tmp/coderun.mjs'),
			catch: (error) => new DaytonaError({ message: 'Failed to run code', code: 500, cause: error })
		});

		if (response.exitCode !== 0) {
			return yield* Effect.fail(
				new DaytonaError({
					message: `Exited ${response.exitCode}: ${response.result}`,
					code: 500,
					cause: new Error(response.result)
				})
			);
		}

		yield* Effect.logInfo(`Sandbox output: ${response.result}`);
		return response;
	});

	return {
		basicCodeRun,
		codeRunStream
	};
});

export class DaytonaService extends ServiceMap.Service<
	DaytonaService,
	Effect.Success<typeof daytonaServiceEffect>
>()('DaytonaService') {}

export const daytonaServiceLayer = Layer.effect(DaytonaService)(daytonaServiceEffect);
