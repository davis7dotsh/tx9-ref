// this code runs on the daytona sandbox after it's built. no imports except for external deps, not other files
// requires the openai api key

import { createOpenAI } from '@ai-sdk/openai';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { stepCountIs, streamText } from 'ai';
import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';
import * as Http from 'node:http';

const runFullStream = () => {
	const openai = createOpenAI({
		apiKey: process.env.OPENAI_API_KEY
	});

	const model = openai('gpt-5.3-codex-api-preview');

	const { fullStream } = streamText({
		model,
		prompt: 'How do I use generator functions in javascript?',
		stopWhen: stepCountIs(5)
	});

	return fullStream;
};

export type CodeRunStreamChunkType = ReturnType<typeof runFullStream>;

const MyRoutes = HttpRouter.use((router) =>
	Effect.gen(function* () {
		yield* router.add(
			'POST',
			'/stream',
			Effect.gen(function* () {
				const fullStream = runFullStream();

				const sendStream = Stream.fromAsyncIterable(fullStream, (err) => console.error(err));

				const processedStream = sendStream.pipe(
					Stream.mapEffect((part) =>
						Effect.gen(function* () {
							return JSON.stringify({ event: 'data', chunk: part }) + '\n';
						})
					),
					Stream.encodeText
				);

				return HttpServerResponse.stream(processedStream);
			})
		);

		yield* router.add('GET', '/health', HttpServerResponse.json({ status: 'ok' }));
	})
);

const serverLayer = HttpRouter.serve(MyRoutes).pipe(
	Layer.provideMerge(NodeHttpServer.layer(() => Http.createServer(), { port: 3000 }))
);

const program = Effect.gen(function* () {
	console.log('Server running on http://localhost:3000');
	yield* Effect.never;
}).pipe(Effect.provide(serverLayer));

NodeRuntime.runMain(program);
