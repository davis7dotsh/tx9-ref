import { command } from '$app/server';
import { effectRunner } from '$lib/runtime';
import { DaytonaService } from '$lib/services/daytona.service';
import { Effect } from 'effect';

export const commandSandboxTest = command(async () => {
	const sandboxTestEffect = Effect.gen(function* () {
		const daytonaService = yield* DaytonaService;

		return yield* daytonaService.sandboxTest;
	});

	const result = await effectRunner(sandboxTestEffect);

	return result;
});
