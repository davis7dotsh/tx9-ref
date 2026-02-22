import { Effect } from 'effect';
import { runtime } from '$lib/runtime';

const SHUTDOWN_KEY = Symbol.for('app.shutdown.handler');

export const init = async () => {
	await runtime.runPromise(Effect.void);

	const prev = (globalThis as Record<symbol, unknown>)[SHUTDOWN_KEY] as
		| (() => Promise<void>)
		| undefined;
	if (prev) process.off('sveltekit:shutdown', prev);

	const handler = async () => {
		await runtime.dispose();
	};

	(globalThis as Record<symbol, unknown>)[SHUTDOWN_KEY] = handler;
	process.on('sveltekit:shutdown', handler);
};
