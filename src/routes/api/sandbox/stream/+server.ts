import { effectRunner } from '$lib/runtime';
import { DaytonaService } from '$lib/services/daytona.service';
import type { RequestHandler } from './$types';
import { Effect, Scope } from 'effect';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { prompt?: string };
	const prompt =
		body.prompt?.trim() || 'How do I use generator functions in javascript? Include example code.';

	const stream = await effectRunner(
		Effect.gen(function* () {
			const { codeRunStream } = yield* DaytonaService;

			return yield* codeRunStream(prompt);
		})
	);

	return new Response(stream as ReadableStream, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'no-cache',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
