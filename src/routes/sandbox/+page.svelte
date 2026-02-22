<script lang="ts">
	import { commandSandboxTest } from '$lib/remote/daytona.remote';
	import type { CodeRunStreamChunkType } from '$lib/services/daytona/coderunStream';
	import { isHttpError } from '@sveltejs/kit';
	import { marked } from 'marked';

	const renderMd = (text: string) => marked.parse(text) as string;

	type StreamChunk = CodeRunStreamChunkType extends AsyncIterable<infer T> ? T : never;
	type StreamEvent = { event: string; chunk: StreamChunk };
	type SearchResult = { title: string; url: string; snippet: string | null };
	type ToolStartBlock = { id: number; kind: 'tool_start'; name: string; input?: unknown };
	type ToolResultBlock = { id: number; kind: 'tool_result'; name: string; result?: unknown };
	type TextBlock = { id: number; kind: 'text'; text: string };
	type FlowBlock = ToolStartBlock | ToolResultBlock | TextBlock;

	const resultMeta = (name: string, result: unknown): { badge?: string; detail?: string } => {
		if (!result || typeof result !== 'object') return {};
		const r = result as Record<string, unknown>;
		if (name === 'exaSearch')
			return {
				badge: Array.isArray(r.results) ? `${r.results.length} results` : undefined
			};
		if (name === 'searchRepo')
			return {
				badge: Array.isArray(r.matches) ? `${(r.matches as unknown[]).length} matches` : undefined
			};
		if (name === 'cloneGitRepo')
			return { badge: r.status === 'already_cloned' ? 'cached' : r.error ? 'error' : 'cloned' };
		if (name === 'readFile') return { detail: r.filePath as string };
		if (name === 'listFiles')
			return {
				badge: Array.isArray(r.files) ? `${(r.files as unknown[]).length} files` : undefined
			};
		return {};
	};

	let testRunning = $state(false);
	let streamRunning = $state(false);
	let streamError = $state('');
	let prompt = $state('What does this repo do? Give me an overview of the main components.');
	let repoUrl = $state('');
	let flowBlocks = $state<FlowBlock[]>([]);
	let streamOutput = $state('');

	const handleError = (e: unknown) => {
		if (isHttpError(e)) console.error(e.body.message);
		else console.error(e);
	};

	const parseStreamEvent = (line: string): StreamEvent | null => {
		try {
			return JSON.parse(line) as StreamEvent;
		} catch {
			return null;
		}
	};

	let blockId = 0;

	const appendTextDelta = (delta: string) => {
		streamOutput += delta;
		const last = flowBlocks.at(-1);
		if (last?.kind === 'text') {
			last.text += delta;
			flowBlocks = [...flowBlocks.slice(0, -1), last];
			return;
		}
		flowBlocks = [...flowBlocks, { id: ++blockId, kind: 'text', text: delta }];
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
		streamError = '';
		flowBlocks = [];
		try {
			const res = await fetch('/api/sandbox/stream', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt, repoUrl: repoUrl.trim() || undefined })
			});
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					if (!line.trim()) continue;
					const event = parseStreamEvent(line);
					if (!event?.chunk) continue;
					const chunk = event.chunk;

					if (chunk.type === 'tool-call') {
						flowBlocks = [
							...flowBlocks,
							{
								id: ++blockId,
								kind: 'tool_start',
								name: chunk.toolName,
								input: ('input' in chunk ? chunk.input : undefined) as unknown
							}
						];
						continue;
					}

					if (chunk.type === 'tool-result') {
						flowBlocks = [
							...flowBlocks,
							{
								id: ++blockId,
								kind: 'tool_result',
								name: chunk.toolName,
								result: ('output' in chunk ? chunk.output : undefined) as ToolResultBlock['result']
							}
						];
						continue;
					}

					if (chunk.type === 'text-delta') {
						appendTextDelta(chunk.text);
						continue;
					}

					if (chunk.type === 'error') {
						streamError = String(chunk.error) ?? 'Unknown stream error';
					}
				}
			}
		} catch (e) {
			handleError(e);
			streamError = e instanceof Error ? e.message : 'Unknown stream error';
		} finally {
			streamRunning = false;
		}
	};
</script>

<div class="mx-auto max-w-4xl px-6 py-12">
	<h1 class="mb-1 text-lg font-semibold text-neutral-100">Sandbox</h1>
	<p class="mb-8 text-sm text-neutral-500">Daytona sandbox experiments.</p>

	<div class="grid gap-4 md:grid-cols-[300px_1fr]">
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

		<div class="min-h-[500px] rounded-lg border border-neutral-800 bg-neutral-900 p-5">
			<div class="mb-4 flex items-center justify-between">
				<p class="text-sm font-medium text-neutral-200">Repo research agent</p>
				<span
					class="rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase"
					class:border-primary={streamRunning}
					class:text-primary={streamRunning}
					class:border-neutral-700={!streamRunning}
					class:text-neutral-400={!streamRunning}
				>
					{streamRunning ? 'streaming' : 'idle'}
				</span>
			</div>
			<p class="mb-4 text-xs text-neutral-500">
				Clone a GitHub repo and ask questions about it. The agent searches code and reads files in a
				Daytona sandbox.
			</p>

			<form
				class="mb-4 space-y-3"
				onsubmit={(event) => {
					event.preventDefault();
					void handleSandboxStream();
				}}
			>
				<input
					bind:value={repoUrl}
					placeholder="GitHub repo URL (e.g. https://github.com/owner/repo)"
					class="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 ring-primary/50 outline-none placeholder:text-neutral-500 focus:ring-1"
				/>
				<textarea
					bind:value={prompt}
					placeholder="Ask something about the repo, or ask a general research question..."
					class="h-20 w-full resize-none rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 ring-primary/50 outline-none placeholder:text-neutral-500 focus:ring-1"
				></textarea>
				<button
					type="submit"
					disabled={streamRunning || !prompt.trim()}
					class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
				>
					{streamRunning ? 'Streaming…' : 'Run prompt'}
				</button>
			</form>

			<div class="max-h-[480px] space-y-3 overflow-y-auto pr-1">
				{#if !flowBlocks.length && !streamRunning}
					<p class="text-sm text-neutral-500">
						Enter a GitHub repo URL and a question to start the research agent.
					</p>
				{/if}

				{#each flowBlocks as block (block.id)}
					{#if block.kind === 'tool_start'}
						<details class="group rounded-md border border-neutral-700 bg-neutral-950">
							<summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs">
								<span class="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-neutral-400"
									>call</span
								>
								<span class="font-medium text-neutral-200">{block.name}</span>
								<svg
									class="ml-auto size-3.5 shrink-0 text-neutral-500 transition-transform group-open:rotate-180"
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"><path d="M6 9l6 6 6-6" /></svg
								>
							</summary>
							{#if block.input}
								<div class="border-t border-neutral-800 px-3 py-2.5">
									<pre
										class="overflow-x-auto text-[11px] leading-relaxed text-neutral-400">{JSON.stringify(
											block.input,
											null,
											2
										)}</pre>
								</div>
							{/if}
						</details>
					{:else if block.kind === 'tool_result'}
						{@const meta = resultMeta(block.name, block.result)}
						{@const r = (block.result ?? {}) as Record<string, unknown>}
						<details class="group rounded-md border border-neutral-700 bg-neutral-950">
							<summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs">
								<span class="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-neutral-400"
									>result</span
								>
								<span class="font-medium text-neutral-200">{block.name}</span>
								{#if meta.badge}
									<span class="text-neutral-500">{meta.badge}</span>
								{/if}
								{#if meta.detail}
									<span class="max-w-[200px] truncate font-mono text-neutral-500"
										>{meta.detail}</span
									>
								{/if}
								<svg
									class="ml-auto size-3.5 shrink-0 text-neutral-500 transition-transform group-open:rotate-180"
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"><path d="M6 9l6 6 6-6" /></svg
								>
							</summary>
							<div class="border-t border-neutral-800 px-3 py-2.5">
								{#if r.error}
									<p class="text-xs text-red-400">{r.error}</p>
								{:else if block.name === 'exaSearch'}
									{#if r.query}
										<p class="mb-2 text-xs text-neutral-500">
											Query: <span class="font-medium text-neutral-300">{r.query}</span>
										</p>
									{/if}
									{#if Array.isArray(r.results) && r.results.length}
										<ul class="space-y-3">
											{#each r.results as result (result.url)}
												<li class="text-xs">
													<a
														class="font-medium text-primary hover:underline"
														href={result.url}
														target="_blank"
														rel="noreferrer">{result.title}</a
													>
													<p class="truncate text-neutral-500">{result.url}</p>
													{#if result.snippet}
														<p class="mt-0.5 text-neutral-400">{result.snippet}</p>
													{/if}
												</li>
											{/each}
										</ul>
									{/if}
								{:else if block.name === 'cloneGitRepo'}
									<p class="font-mono text-xs text-neutral-400">{r.repoPath}</p>
								{:else if block.name === 'searchRepo'}
									{#if Array.isArray(r.matches) && r.matches.length}
										<ul class="space-y-1">
											{#each r.matches as m}
												<li class="font-mono text-[11px] text-neutral-400">
													<span class="text-neutral-500">{m.file}:{m.line}</span>
													<span class="ml-2 text-neutral-300">{m.content}</span>
												</li>
											{/each}
										</ul>
									{:else}
										<p class="text-xs text-neutral-500">No matches found.</p>
									{/if}
								{:else if block.name === 'readFile'}
									{#if r.content}
										<pre
											class="max-h-48 overflow-y-auto text-[11px] leading-relaxed text-neutral-300">{r.content}</pre>
									{/if}
								{:else if block.name === 'listFiles'}
									{#if Array.isArray(r.files) && r.files.length}
										<ul class="space-y-0.5">
											{#each r.files as f}
												<li class="font-mono text-[11px] text-neutral-400">{f}</li>
											{/each}
										</ul>
									{/if}
								{:else}
									<pre
										class="overflow-x-auto text-[11px] leading-relaxed text-neutral-400">{JSON.stringify(
											block.result,
											null,
											2
										)}</pre>
								{/if}
							</div>
						</details>
					{:else}
						<div class="rounded-md border border-neutral-700 bg-neutral-950 px-4 py-3">
							<div
								class="prose prose-sm max-w-none prose-neutral prose-invert prose-a:text-primary prose-code:rounded prose-code:bg-neutral-800 prose-code:px-1 prose-code:py-0.5 prose-code:text-neutral-300 prose-pre:bg-neutral-900 prose-pre:text-neutral-300"
							>
								{@html renderMd(block.text)}
							</div>
							{#if streamRunning && block === flowBlocks.at(-1)}
								<span class="animate-pulse text-primary">▌</span>
							{/if}
						</div>
					{/if}
				{/each}

				{#if streamError}
					<p class="text-sm text-red-500">{streamError}</p>
				{/if}
			</div>
		</div>
	</div>
</div>
