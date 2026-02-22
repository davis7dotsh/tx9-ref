<script lang="ts">
	import { commandSandboxTest } from '$lib/remote/daytona.remote';
	import { isHttpError } from '@sveltejs/kit';

	let testRunning = $state(false);
	let streamRunning = $state(false);
	let streamOutput = $state('');

	const handleError = (e: unknown) => {
		if (isHttpError(e)) console.error(e.body.message);
		else console.error(e);
	};

	const handleSandboxTest = async () => {
		testRunning = true;
		try {
			const result = await commandSandboxTest();
			console.log(result);
		} catch (e) {
			handleError(e);
		} finally {
			testRunning = false;
		}
	};

	const handleSandboxStream = async () => {
		streamRunning = true;
		streamOutput = '';
		try {
			const res = await fetch('/api/sandbox/stream', { method: 'POST' });
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				streamOutput += decoder.decode(value, { stream: true });
			}
		} catch (e) {
			handleError(e);
		} finally {
			streamRunning = false;
		}
	};
</script>

<div class="mx-auto max-w-xl px-6 py-12">
	<h1 class="mb-1 text-lg font-semibold text-neutral-100">Sandbox</h1>
	<p class="mb-8 text-sm text-neutral-500">Daytona sandbox experiments.</p>

	<div class="flex flex-col gap-3">
		<div class="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
			<p class="mb-1 text-sm font-medium text-neutral-200">Basic code run</p>
			<p class="mb-4 text-xs text-neutral-500">
				Uploads a bundled Effect script and runs it via node.
			</p>
			<button
				onclick={handleSandboxTest}
				disabled={testRunning}
				class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
			>
				{testRunning ? 'Running…' : 'Run'}
			</button>
		</div>

		<div class="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
			<p class="mb-1 text-sm font-medium text-neutral-200">LLM stream</p>
			<p class="mb-4 text-xs text-neutral-500">
				Starts an Effect HTTP server on the sandbox and streams an OpenAI response.
			</p>
			<button
				onclick={handleSandboxStream}
				disabled={streamRunning}
				class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
			>
				{streamRunning ? 'Streaming…' : 'Run'}
			</button>

			{#if streamOutput || streamRunning}
				<div class="mt-4 rounded-md bg-neutral-950 p-4">
					<p class="font-mono text-xs leading-relaxed whitespace-pre-wrap text-neutral-300">
						{streamOutput}{#if streamRunning}<span class="animate-pulse text-primary">▌</span>{/if}
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>
