import { effectRunner } from '$lib/runtime';
import { DaytonaService } from '$lib/services/daytona.service';
import type { RequestHandler } from './$types';
import { Effect } from 'effect';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		messages?: unknown[];
		sandboxId?: string;
		prompt?: string;
		repoUrl?: string;
	};

	const messages: unknown[] = body.messages?.length
		? body.messages
		: [
				{
					role: 'user',
					content: body.repoUrl?.trim()
						? `Repository: ${body.repoUrl.trim()}\n\n${body.prompt?.trim() || 'Give me an overview of this repository.'}`
						: (body.prompt?.trim() ?? 'How do I use generator functions in JavaScript?')
				}
			];

	const { stream, sandboxId } = await effectRunner(
		Effect.gen(function* () {
			const { codeRunStream } = yield* DaytonaService;
			return yield* codeRunStream({ messages, sandboxId: body.sandboxId });
		})
	);

	return new Response(stream as ReadableStream, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'no-cache',
			'X-Content-Type-Options': 'nosniff',
			'X-Sandbox-Id': sandboxId
		}
	});
};
