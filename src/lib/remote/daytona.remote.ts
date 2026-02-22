import { command } from '$app/server';
import { effectRunner } from '$lib/runtime';
import { DaytonaService } from '$lib/services/daytona.service';
import { Effect, Scope } from 'effect';

export const commandSandboxTest = command(async () => {
	const sandboxTestEffect = Effect.gen(function* () {
		const daytonaService = yield* DaytonaService;

		const scope = yield* Scope.make('parallel');

		const result = yield* Scope.use(scope)(daytonaService.basicCodeRun);

		return result;
	});

	const result = await effectRunner(sandboxTestEffect);

	return result;
});
