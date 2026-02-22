import { effectRunner } from '$lib/runtime';
import { DaytonaService } from '$lib/services/daytona.service';
import type { RequestHandler } from './$types';
import { Effect } from 'effect';

export const POST: RequestHandler = async () => {
	const stream = await effectRunner(
		Effect.gen(function* () {
			const { codeRunStream } = yield* DaytonaService;
			return yield* codeRunStream;
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
