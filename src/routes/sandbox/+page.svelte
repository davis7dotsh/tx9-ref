<script lang="ts">
	import { commandSandboxTest } from '$lib/remote/daytona.remote';
	import type { CodeRunStreamChunkType } from '$lib/services/daytona/coderunStream';
	import { isHttpError } from '@sveltejs/kit';
	import { marked } from 'marked';
	import { tick } from 'svelte';

	const renderMd = (text: string) => marked.parse(text) as string;

	type StreamChunk = CodeRunStreamChunkType extends AsyncIterable<infer T> ? T : never;
	type StreamEvent = { event: string; chunk: StreamChunk };
	type ToolStartBlock = { id: number; kind: 'tool_start'; name: string; input?: unknown };
	type ToolResultBlock = { id: number; kind: 'tool_result'; name: string; result?: unknown };
	type TextBlock = { id: number; kind: 'text'; text: string };
	type FlowBlock = ToolStartBlock | ToolResultBlock | TextBlock;
	type Turn =
		| { role: 'user'; text: string; repoUrl?: string }
		| { role: 'assistant'; blocks: FlowBlock[] };

	const resultMeta = (name: string, result: unknown): { badge?: string; detail?: string } => {
		if (!result || typeof result !== 'object') return {};
		const r = result as Record<string, unknown>;
		if (name === 'exaSearch')
			return { badge: Array.isArray(r.results) ? `${r.results.length} results` : undefined };
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

	let streamRunning = $state(false);
	let streamError = $state('');
	let prompt = $state('');
	let repoUrl = $state('');
	let turns = $state<Turn[]>([]);
	let messagesEl = $state<HTMLDivElement | null>(null);

	let blockId = 0;

	const scrollToBottom = async () => {
		await tick();
		if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
	};

	const currentBlocks = (): FlowBlock[] => {
		const last = turns.at(-1);
		return last?.role === 'assistant' ? last.blocks : [];
	};

	const appendTextDelta = (delta: string) => {
		const blocks = currentBlocks();
		const last = blocks.at(-1);
		if (last?.kind === 'text') {
			last.text += delta;
			turns = [
				...turns.slice(0, -1),
				{ role: 'assistant', blocks: [...blocks.slice(0, -1), last] }
			];
		} else {
			turns = [
				...turns.slice(0, -1),
				{ role: 'assistant', blocks: [...blocks, { id: ++blockId, kind: 'text', text: delta }] }
			];
		}
		scrollToBottom();
	};

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

	const handleSandboxStream = async () => {
		if (!prompt.trim() || streamRunning) return;
		streamRunning = true;
		streamError = '';

		const userTurn: Turn = {
			role: 'user',
			text: prompt.trim(),
			repoUrl: repoUrl.trim() || undefined
		};
		turns = [...turns, userTurn, { role: 'assistant', blocks: [] }];
		const sentPrompt = prompt.trim();
		const sentRepoUrl = repoUrl.trim();
		prompt = '';
		await scrollToBottom();

		try {
			const res = await fetch('/api/sandbox/stream', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt: sentPrompt, repoUrl: sentRepoUrl || undefined })
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
						const blocks = currentBlocks();
						turns = [
							...turns.slice(0, -1),
							{
								role: 'assistant',
								blocks: [
									...blocks,
									{
										id: ++blockId,
										kind: 'tool_start',
										name: chunk.toolName,
										input: ('input' in chunk ? chunk.input : undefined) as unknown
									}
								]
							}
						];
						await scrollToBottom();
						continue;
					}

					if (chunk.type === 'tool-result') {
						const blocks = currentBlocks();
						turns = [
							...turns.slice(0, -1),
							{
								role: 'assistant',
								blocks: [
									...blocks,
									{
										id: ++blockId,
										kind: 'tool_result',
										name: chunk.toolName,
										result: ('output' in chunk
											? chunk.output
											: undefined) as ToolResultBlock['result']
									}
								]
							}
						];
						await scrollToBottom();
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
			await scrollToBottom();
		}
	};

	const handleKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void handleSandboxStream();
		}
	};
</script>

<div class="flex h-screen flex-col">
	<header class="flex shrink-0 items-center gap-3 border-b border-neutral-800 px-5 py-3.5">
		<span class="text-sm font-medium text-neutral-100">Research Agent</span>
		<span class="text-neutral-700">·</span>
		<span class="text-xs text-neutral-500">Daytona sandbox</span>
		<div class="ml-auto flex items-center gap-1.5">
			{#if streamRunning}
				<span class="size-1.5 animate-pulse rounded-full bg-primary"></span>
				<span class="text-xs text-primary">streaming</span>
			{:else}
				<span class="text-xs text-neutral-600">idle</span>
			{/if}
		</div>
	</header>

	<div bind:this={messagesEl} class="min-h-0 flex-1 overflow-y-auto px-5 py-6">
		{#if !turns.length}
			<div class="flex h-full flex-col items-center justify-center gap-2 text-center">
				<p class="text-sm font-medium text-neutral-400">Ask about a GitHub repo</p>
				<p class="max-w-xs text-xs text-neutral-600">
					Paste a repo URL below and ask a question. The agent will clone, search, and read files in
					a Daytona sandbox.
				</p>
			</div>
		{/if}

		<div class="mx-auto max-w-3xl space-y-6">
			{#each turns as turn (turn)}
				{#if turn.role === 'user'}
					<div class="flex justify-end">
						<div class="max-w-[75%] space-y-1.5">
							{#if turn.repoUrl}
								<div class="rounded-lg bg-neutral-800 px-3 py-2 text-right">
									<p class="font-mono text-xs text-neutral-400">{turn.repoUrl}</p>
								</div>
							{/if}
							<div class="rounded-2xl rounded-tr-sm bg-primary/15 px-4 py-3">
								<p class="text-sm text-neutral-100">{turn.text}</p>
							</div>
						</div>
					</div>
				{:else}
					<div class="space-y-2">
						{#if !turn.blocks.length && streamRunning}
							<div class="flex items-center gap-2 py-1">
								<span class="size-1.5 animate-pulse rounded-full bg-neutral-600"></span>
								<span class="animate-pulse text-xs text-neutral-600">thinking…</span>
							</div>
						{/if}
						{#each turn.blocks as block (block.id)}
							{#if block.kind === 'tool_start'}
								<details class="group rounded-lg border border-neutral-800 bg-neutral-900/60">
									<summary
										class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs"
									>
										<span
											class="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500"
											>call</span
										>
										<span class="font-medium text-neutral-300">{block.name}</span>
										<svg
											class="ml-auto size-3 shrink-0 text-neutral-600 transition-transform group-open:rotate-180"
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
												class="overflow-x-auto text-[11px] leading-relaxed text-neutral-500">{JSON.stringify(
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
								<details class="group rounded-lg border border-neutral-800 bg-neutral-900/60">
									<summary
										class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs"
									>
										<span
											class="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500"
											>result</span
										>
										<span class="font-medium text-neutral-300">{block.name}</span>
										{#if meta.badge}
											<span class="text-neutral-600">{meta.badge}</span>
										{/if}
										{#if meta.detail}
											<span class="max-w-[200px] truncate font-mono text-neutral-600"
												>{meta.detail}</span
											>
										{/if}
										<svg
											class="ml-auto size-3 shrink-0 text-neutral-600 transition-transform group-open:rotate-180"
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
															<p class="truncate text-neutral-600">{result.url}</p>
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
														<li class="font-mono text-[11px] text-neutral-500">
															<span>{m.file}:{m.line}</span>
															<span class="ml-2 text-neutral-300">{m.content}</span>
														</li>
													{/each}
												</ul>
											{:else}
												<p class="text-xs text-neutral-600">No matches found.</p>
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
												class="overflow-x-auto text-[11px] leading-relaxed text-neutral-500">{JSON.stringify(
													block.result,
													null,
													2
												)}</pre>
										{/if}
									</div>
								</details>
							{:else}
								<div class="px-1">
									<div
										class="prose prose-sm max-w-none prose-neutral prose-invert prose-a:text-primary prose-code:rounded prose-code:bg-neutral-800 prose-code:px-1 prose-code:py-0.5 prose-code:text-neutral-300 prose-pre:bg-neutral-900 prose-pre:text-neutral-300"
									>
										{@html renderMd(block.text)}
									</div>
									{#if streamRunning && turn === turns.at(-1) && block === turn.blocks.at(-1)}
										<span class="text-primary opacity-70">▌</span>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			{/each}

			{#if streamError}
				<p class="text-xs text-red-400">{streamError}</p>
			{/if}
		</div>
	</div>

	<div class="shrink-0 border-t border-neutral-800 px-5 py-4">
		<div class="mx-auto max-w-3xl space-y-2">
			<div class="flex flex-wrap gap-1.5">
				{#each [{ label: 'svelte.dev', url: 'https://github.com/sveltejs/svelte.dev' }, { label: 'effect-smol', url: 'https://github.com/Effect-TS/effect-smol' }, { label: 'daytona', url: 'https://github.com/daytonaio/daytona' }] as preset}
					<button
						onclick={() => (repoUrl = preset.url)}
						class="rounded-md border px-2.5 py-1 text-xs transition-colors"
						class:border-primary={repoUrl === preset.url}
						class:text-primary={repoUrl === preset.url}
						class:border-neutral-800={repoUrl !== preset.url}
						class:text-neutral-500={repoUrl !== preset.url}
						class:hover:border-neutral-700={repoUrl !== preset.url}
						class:hover:text-neutral-400={repoUrl !== preset.url}>{preset.label}</button
					>
				{/each}
			</div>
			<input
				bind:value={repoUrl}
				placeholder="GitHub repo URL (optional)"
				class="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-300 ring-primary/40 outline-none placeholder:text-neutral-600 focus:border-neutral-700 focus:ring-1"
			/>
			<div class="flex items-end gap-2">
				<textarea
					bind:value={prompt}
					onkeydown={handleKeydown}
					placeholder="Type your message here..."
					rows={3}
					class="flex-1 resize-none rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100 ring-primary/40 outline-none placeholder:text-neutral-600 focus:border-neutral-700 focus:ring-1"
				></textarea>
				<button
					onclick={() => void handleSandboxStream()}
					disabled={streamRunning || !prompt.trim()}
					class="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
					aria-label="Send"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						class="size-4"
					>
						<path d="M12 19V5M5 12l7-7 7 7" />
					</svg>
				</button>
			</div>
			<p class="text-[11px] text-neutral-700">⌘↵ to send</p>
		</div>
	</div>
</div>
