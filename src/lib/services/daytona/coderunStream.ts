// this code runs on the daytona sandbox after it's built. no imports except for external deps, not other files
// requires the openai api key

import { createOpenAI } from '@ai-sdk/openai';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { stepCountIs, streamText, tool, type ModelMessage } from 'ai';
import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';
import Exa from 'exa-js';
import * as Http from 'node:http';
import { z } from 'zod';

const systemPrompt =
	"You are a research assistant. Use exa search to get up to date information from the web about the user's prompt. Always call the web search tool to make sure you're answer is correct.";
const defaultPrompt = 'How do I use generator functions in javascript? Include example code.';

const trimSnippet = (text?: string | null) =>
	text?.replace(/\s+/g, ' ').trim().slice(0, 320) ?? null;

const createStream = (messages?: ModelMessage[]) => {
	const exaApiKey = process.env.EXA_API_KEY;
	if (!exaApiKey) throw new Error('EXA_API_KEY is missing');

	const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
	const exa = new Exa(exaApiKey);
	const prompt = process.env.BTCA_PROMPT?.trim() || defaultPrompt;

	return streamText({
		model: openai('gpt-5.3-codex-api-preview'),
		messages: messages ?? [{ role: 'user', content: prompt }],
		system: systemPrompt,
		stopWhen: stepCountIs(6),
		tools: {
			exaSearch: tool({
				description:
					'Search the web with Exa for current docs, package updates, repos, and technical context.',
				inputSchema: z.object({
					query: z.string().min(2),
					numResults: z.number().int().min(1).max(10).optional()
				}),
				execute: async ({ query, numResults }) => {
					console.log(`[tool] exaSearch query="${query}" numResults=${numResults ?? 5}`);
					const response = await exa.search(query, {
						type: 'auto',
						numResults: numResults ?? 5,
						contents: { text: { maxCharacters: 10_000 } }
					});
					const results = response.results.map((r) => ({
						title: r.title ?? r.url,
						url: r.url,
						snippet: trimSnippet(r.text)
					}));
					console.log(`[tool] exaSearch returned ${results.length} results`);
					return { query, results };
				}
			})
		}
	});
};

export type CodeRunStreamChunkType = ReturnType<typeof createStream>['fullStream'];

const MyRoutes = HttpRouter.use((router) =>
	Effect.gen(function* () {
		yield* router.add(
			'POST',
			'/stream',
			Effect.gen(function* () {
				const { fullStream } = createStream();
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
