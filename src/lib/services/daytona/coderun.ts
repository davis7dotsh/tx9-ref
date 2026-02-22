// this is code that runs on the daytona sandbox in typescript. this code cannot have imports outside of just a set of packages that are pre-installed in the sandbox.

import { NodeRuntime } from '@effect/platform-node';
import { Console, Effect, Stream } from 'effect';

const program = Effect.gen(function* () {
	yield* Stream.make(1, 2, 3).pipe(
		Stream.map((x) => x * 2),
		Stream.runForEach((n) => Console.log(`number is ${n}`))
	);
});

NodeRuntime.runMain(program);
