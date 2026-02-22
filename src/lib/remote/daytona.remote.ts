import { command } from '$app/server';
import { effectRunner } from '$lib/runtime';
import { DaytonaService } from '$lib/services/daytona.service';
import { Effect, Scope } from 'effect';

export const commandSandboxTest = command(async () => {
	const result = await effectRunner(
		Effect.gen(function* () {
			const { basicCodeRun } = yield* DaytonaService;
			const scope = yield* Scope.make('parallel');
			return yield* Scope.use(scope)(basicCodeRun);
		})
	);
	return result;
});
