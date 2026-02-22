import { Effect } from 'effect';
import { runtime } from '$lib/runtime';

export const init = async () => {
	await runtime.runPromise(Effect.void);

	process.on('sveltekit:shutdown', async () => {
		console.log('sveltekit:shutdown');
		await runtime.dispose();
	});
};
