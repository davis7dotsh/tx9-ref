// this code runs on the daytona sandbox after it's built. no imports except for external deps, not other files
// requires the openai api key

import { createOpenAI } from '@ai-sdk/openai';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { streamText } from 'ai';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';
import * as Http from 'node:http';

const MyRoutes = HttpRouter.use((router) =>
	Effect.gen(function* () {
		const openai = createOpenAI({
			apiKey: process.env.OPENAI_API_KEY
		});

		const model = openai('gpt-5.3-codex-api-preview');

		yield* router.add(
			'POST',
			'/stream',
			Effect.gen(function* () {
				const res = streamText({
					model,
					prompt: 'How do I use generator functions in javascript?'
				});

				const textStream = res.toTextStreamResponse();

				return HttpServerResponse.fromWeb(textStream);
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
