<script lang="ts">
	import type { CodeRunStreamChunkType } from '$lib/services/daytona/coderunStream';
	import type { ModelMessage } from 'ai';
	import { isHttpError } from '@sveltejs/kit';
	import { marked } from 'marked';

	const renderMd = (text: string) => marked.parse(text) as string;

	type StreamChunk =
		| (CodeRunStreamChunkType extends AsyncIterable<infer T> ? T : never)
		| { type: 'done'; messages: ModelMessage[] };
	type FlowBlock =
		| { id: number; kind: 'tool_start'; name: string; input?: unknown }
		| { id: number; kind: 'tool_result'; name: string; result?: unknown }
		| { id: number; kind: 'text'; text: string };
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
	let sandboxId = $state<string | null>(null);
	let messages = $state<ModelMessage[]>([]);

	let blockId = 0;

	const currentBlocks = () => {
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
	};

	const handleError = (e: unknown) => {
		if (isHttpError(e)) console.error(e.body.message);
		else console.error(e);
	};

	const parseStreamChunk = (line: string): StreamChunk | null => {
		try {
			return JSON.parse(line) as StreamChunk;
		} catch {
			return null;
		}
	};

	const newSession = () => {
		sandboxId = null;
		messages = [];
		turns = [];
		streamError = '';
	};

	const handleSandboxStream = async () => {
		if (!prompt.trim() || streamRunning) return;
		streamRunning = true;
		streamError = '';

		const sentPrompt = prompt.trim();
		const sentRepoUrl = repoUrl.trim();
		const userContent = sentRepoUrl ? `Repository: ${sentRepoUrl}\n\n${sentPrompt}` : sentPrompt;
		const userMessage: ModelMessage = { role: 'user', content: userContent };
		const messagesToSend = [...messages, userMessage];

		const userTurn: Turn = { role: 'user', text: sentPrompt, repoUrl: sentRepoUrl || undefined };
		turns = [...turns, userTurn, { role: 'assistant', blocks: [] }];
		prompt = '';

		try {
			const res = await fetch('/api/sandbox/stream', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ messages: messagesToSend, sandboxId: sandboxId ?? undefined })
			});

			const newSandboxId = res.headers.get('X-Sandbox-Id');
			if (newSandboxId) sandboxId = newSandboxId;

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
					const chunk = parseStreamChunk(line);
					if (!chunk) continue;

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
										result: ('output' in chunk ? chunk.output : undefined) as unknown
									}
								]
							}
						];
						continue;
					}

					if (chunk.type === 'text-delta') {
						appendTextDelta(chunk.text);
						continue;
					}

					if (chunk.type === 'done') {
						console.log('done', chunk.messages);
						messages = [...messagesToSend, ...chunk.messages];
						continue;
					}

					if (chunk.type === 'error') {
						streamError = String((chunk as { error: unknown }).error) ?? 'Unknown stream error';
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

	const handleKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
			e.preventDefault();
			void handleSandboxStream();
		}
	};

	const presets = [
		{ label: 'svelte.dev', url: 'https://github.com/sveltejs/svelte.dev' },
		{ label: 'effect-smol', url: 'https://github.com/Effect-TS/effect-smol' },
		{ label: 'daytona', url: 'https://github.com/daytonaio/daytona' }
	];

	const examplePrompts = [
		'How does routing work in this codebase?',
		'Find all API endpoints and explain them',
		'Explain the authentication flow'
	];
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="page">
	<!-- Header -->
	<header class="header">
		<span class="header-title">Research Agent</span>
		<div class="header-sep"></div>
		<span class="header-sub">Daytona sandbox</span>
		{#if sandboxId}
			<span class="sandbox-id">{sandboxId.slice(0, 8)}…</span>
		{/if}
		<div class="header-right">
			{#if turns.length}
				<button onclick={newSession} disabled={streamRunning} class="btn-new-session">
					New session
				</button>
			{/if}
			<div class="status">
				<div class="status-dot" class:live={streamRunning}></div>
				<span class="status-text" class:live={streamRunning}>
					{streamRunning ? 'live' : 'idle'}
				</span>
			</div>
		</div>
	</header>

	<!-- Messages -->
	<div bind:this={messagesEl} class="messages">
		{#if !turns.length}
			<div class="empty">
				<p class="empty-label">Sandbox Research Agent</p>
				<h2 class="empty-title">Ask about any repository</h2>
				<p class="empty-desc">
					Paste a GitHub URL and ask a question. The agent clones, searches, and reads files in a
					Daytona sandbox.
				</p>
				<div class="empty-examples">
					{#each examplePrompts as ex}
						<button onclick={() => (prompt = ex)} class="example-btn">{ex}</button>
					{/each}
				</div>
			</div>
		{/if}

		<div class="turns">
			{#each turns as turn (turn)}
				{#if turn.role === 'user'}
					<div class="user-turn">
						<div class="user-content">
							{#if turn.repoUrl}
								<div class="repo-pill">
									<svg
										width="10"
										height="10"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
									>
										<path
											d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"
										/>
									</svg>
									<span class="repo-pill-text">{turn.repoUrl}</span>
								</div>
							{/if}
							<div class="user-bubble">
								<p>{turn.text}</p>
							</div>
						</div>
					</div>
				{:else}
					<div class="assistant-turn">
						{#if !turn.blocks.length && streamRunning}
							<div class="thinking">
								<div class="thinking-dots">
									<span></span><span></span><span></span>
								</div>
								<span class="thinking-text">Thinking…</span>
							</div>
						{/if}

						{#each turn.blocks as block (block.id)}
							{#if block.kind === 'tool_start'}
								<details class="tool-block call">
									<summary class="tool-summary">
										<span class="tool-tag call">call</span>
										<span class="tool-fn">{block.name}</span>
										<svg
											class="tool-chevron"
											width="12"
											height="12"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
										>
											<path d="M6 9l6 6 6-6" />
										</svg>
									</summary>
									{#if block.input}
										<div class="tool-body">
											<pre>{JSON.stringify(block.input, null, 2)}</pre>
										</div>
									{/if}
								</details>
							{:else if block.kind === 'tool_result'}
								{@const meta = resultMeta(block.name, block.result)}
								{@const r = (block.result ?? {}) as Record<string, unknown>}
								<details class="tool-block result">
									<summary class="tool-summary">
										<span class="tool-tag result">result</span>
										<span class="tool-fn">{block.name}</span>
										{#if meta.badge}
											<span class="tool-badge">{meta.badge}</span>
										{/if}
										{#if meta.detail}
											<span class="tool-detail">{meta.detail}</span>
										{/if}
										<svg
											class="tool-chevron"
											width="12"
											height="12"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
										>
											<path d="M6 9l6 6 6-6" />
										</svg>
									</summary>
									<div class="tool-body">
										{#if r.error}
											<p class="tool-err">{r.error}</p>
										{:else if block.name === 'exaSearch'}
											{#if r.query}
												<p class="search-query">Query: <strong>{r.query}</strong></p>
											{/if}
											{#if Array.isArray(r.results) && r.results.length}
												<ul class="search-list">
													{#each r.results as result (result.url)}
														<li class="search-item">
															<a
																class="search-link"
																href={result.url}
																target="_blank"
																rel="noreferrer">{result.title}</a
															>
															<span class="search-url">{result.url}</span>
															{#if result.snippet}
																<p class="search-snippet">{result.snippet}</p>
															{/if}
														</li>
													{/each}
												</ul>
											{/if}
										{:else if block.name === 'cloneGitRepo'}
											<pre>{r.repoPath}</pre>
										{:else if block.name === 'searchRepo'}
											{#if Array.isArray(r.matches) && r.matches.length}
												<div class="match-list">
													{#each r.matches as m}
														<div class="match-item">
															<span class="match-loc">{m.file}:{m.line}</span>
															<span class="match-text">{m.content}</span>
														</div>
													{/each}
												</div>
											{:else}
												<p class="no-result">No matches found.</p>
											{/if}
										{:else if block.name === 'readFile'}
											{#if r.content}
												<pre>{r.content}</pre>
											{/if}
										{:else if block.name === 'listFiles'}
											{#if Array.isArray(r.files) && r.files.length}
												<div class="file-list">
													{#each r.files as f}
														<div class="file-item">{f}</div>
													{/each}
												</div>
											{/if}
										{:else}
											<pre>{JSON.stringify(block.result, null, 2)}</pre>
										{/if}
									</div>
								</details>
							{:else}
								<div class="text-block">
									<div class="prose-content">
										{@html renderMd(block.text)}
									</div>
									{#if streamRunning && turn === turns.at(-1) && block === turn.blocks.at(-1)}
										<span class="stream-cursor"></span>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			{/each}
		</div>

		{#if streamError}
			<p class="stream-error">{streamError}</p>
		{/if}
	</div>

	<!-- Input Area -->
	<div class="input-area">
		<div class="input-inner" role="form">
			<div class="presets">
				{#each presets as preset}
					<button
						onclick={() => (repoUrl = preset.url)}
						class="preset-chip"
						class:active={repoUrl === preset.url}>{preset.label}</button
					>
				{/each}
			</div>
			<input bind:value={repoUrl} placeholder="github.com/owner/repo" class="repo-input" />
			<div class="prompt-row">
				<textarea
					bind:value={prompt}
					onkeydown={handleKeydown}
					placeholder="Ask anything about the repository…"
					rows={2}
					class="prompt-input"
				></textarea>
				<button
					onclick={() => void handleSandboxStream()}
					disabled={streamRunning || !prompt.trim()}
					class="send-btn"
					aria-label="Send"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						width="14"
						height="14"
					>
						<path d="M12 19V5M5 12l7-7 7 7" />
					</svg>
				</button>
			</div>
			<p class="hint">Return to send · Shift+Return for newline</p>
		</div>
	</div>
</div>

<style>
	:global(html) {
		background-color: #f5f5f5 !important;
	}

	.page {
		display: flex;
		height: 100vh;
		flex-direction: column;
		font-family: 'Figtree', sans-serif;
		background-color: #f5f5f5;
		color: #111111;
		overflow: hidden;
	}

	/* ── Header ──────────────────────────────────────── */
	.header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 24px;
		height: 48px;
		border-bottom: 1px solid #e2e2e2;
		background: #ffffff;
		flex-shrink: 0;
	}

	.header-title {
		font-size: 13px;
		font-weight: 600;
		color: #111111;
		letter-spacing: -0.01em;
	}

	.header-sep {
		width: 1px;
		height: 14px;
		background: #e2e2e2;
	}

	.header-sub {
		font-size: 12px;
		color: #999999;
		font-weight: 400;
	}

	.sandbox-id {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		color: #bbbbbb;
		padding: 2px 6px;
		background: #f5f5f5;
		border: 1px solid #e8e8e8;
	}

	.header-right {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.btn-new-session {
		font-family: 'Figtree', sans-serif;
		font-size: 12px;
		font-weight: 500;
		color: #999999;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		transition: color 0.1s;
	}

	.btn-new-session:hover {
		color: #111111;
	}

	.btn-new-session:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.status-dot {
		width: 6px;
		height: 6px;
		background: #e2e2e2;
	}

	.status-dot.live {
		background: #93c5fd;
		animation: live-pulse 1.4s ease-in-out infinite;
	}

	@keyframes live-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	.status-text {
		font-size: 11px;
		color: #bbbbbb;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.status-text.live {
		color: #60a5fa;
	}

	/* ── Messages ────────────────────────────────────── */
	.messages {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 32px 24px;
	}

	.messages::-webkit-scrollbar {
		width: 4px;
	}

	.messages::-webkit-scrollbar-track {
		background: transparent;
	}

	.messages::-webkit-scrollbar-thumb {
		background: #e2e2e2;
	}

	/* ── Empty State ─────────────────────────────────── */
	.empty {
		display: flex;
		height: 100%;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		text-align: center;
	}

	.empty-label {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #bbbbbb;
		margin-bottom: 4px;
	}

	.empty-title {
		font-size: 20px;
		font-weight: 600;
		color: #111111;
		letter-spacing: -0.02em;
		margin: 0;
	}

	.empty-desc {
		font-size: 14px;
		color: #888888;
		margin: 0;
		max-width: 300px;
		line-height: 1.6;
	}

	.empty-examples {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 20px;
		width: 100%;
		max-width: 360px;
	}

	.example-btn {
		font-family: 'Figtree', sans-serif;
		font-size: 13px;
		font-weight: 400;
		color: #555555;
		background: #ffffff;
		border: 1px solid #e2e2e2;
		padding: 10px 14px;
		cursor: pointer;
		text-align: left;
		transition: all 0.1s;
		width: 100%;
	}

	.example-btn:hover {
		background: #eff6ff;
		border-color: #bfdbfe;
		color: #1d4ed8;
	}

	/* ── Turns ───────────────────────────────────────── */
	.turns {
		max-width: 680px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	/* User turn */
	.user-turn {
		display: flex;
		justify-content: flex-end;
	}

	.user-content {
		max-width: 72%;
		display: flex;
		flex-direction: column;
		gap: 4px;
		align-items: flex-end;
	}

	.repo-pill {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 3px 8px;
		background: #f5f5f5;
		border: 1px solid #e2e2e2;
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		color: #999999;
		max-width: 100%;
	}

	.repo-pill-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.user-bubble {
		background: #dbeafe;
		border: 1px solid #bfdbfe;
		padding: 10px 14px;
	}

	.user-bubble p {
		margin: 0;
		font-size: 14px;
		color: #1e3a5f;
		line-height: 1.55;
	}

	/* Assistant turn */
	.assistant-turn {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	/* Thinking */
	.thinking {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 0;
	}

	.thinking-dots span {
		display: inline-block;
		width: 4px;
		height: 4px;
		background: #cccccc;
		margin-right: 3px;
		animation: thinking 1.2s ease-in-out infinite;
	}

	.thinking-dots span:nth-child(2) {
		animation-delay: 0.15s;
	}

	.thinking-dots span:nth-child(3) {
		animation-delay: 0.3s;
	}

	@keyframes thinking {
		0%,
		80%,
		100% {
			opacity: 0.2;
		}
		40% {
			opacity: 1;
		}
	}

	.thinking-text {
		font-size: 12px;
		color: #bbbbbb;
		font-style: italic;
	}

	/* Tool blocks */
	.tool-block {
		border: 1px solid #e8e8e8;
		background: #ffffff;
	}

	.tool-block.call {
		border-left: 3px solid #fbbf24;
	}

	.tool-block.result {
		border-left: 3px solid #86efac;
	}

	.tool-summary {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		cursor: pointer;
		list-style: none;
		user-select: none;
	}

	.tool-summary::-webkit-details-marker {
		display: none;
	}

	.tool-tag {
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		padding: 2px 5px;
		flex-shrink: 0;
	}

	.tool-tag.call {
		background: #fef9c3;
		color: #92400e;
	}

	.tool-tag.result {
		background: #dcfce7;
		color: #14532d;
	}

	.tool-fn {
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		color: #333333;
		font-weight: 500;
	}

	.tool-badge {
		font-size: 11px;
		color: #999999;
	}

	.tool-detail {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		color: #bbbbbb;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 180px;
	}

	.tool-chevron {
		margin-left: auto;
		color: #cccccc;
		transition: transform 0.15s;
		flex-shrink: 0;
	}

	details[open] .tool-chevron {
		transform: rotate(180deg);
	}

	.tool-body {
		border-top: 1px solid #f0f0f0;
		padding: 10px 12px;
		max-height: 260px;
		overflow-y: auto;
	}

	.tool-body pre {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		line-height: 1.65;
		color: #666666;
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-all;
		margin: 0;
	}

	.tool-err {
		font-size: 12px;
		color: #ef4444;
		margin: 0;
	}

	/* Search results */
	.search-query {
		font-size: 12px;
		color: #888888;
		margin: 0 0 10px 0;
	}

	.search-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.search-item {
		font-size: 12px;
	}

	.search-link {
		font-weight: 500;
		color: #2563eb;
		text-decoration: none;
	}

	.search-link:hover {
		text-decoration: underline;
	}

	.search-url {
		display: block;
		color: #bbbbbb;
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin-top: 1px;
	}

	.search-snippet {
		color: #666666;
		margin: 3px 0 0 0;
		line-height: 1.55;
	}

	/* Match list */
	.match-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.match-item {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		color: #666666;
		line-height: 1.5;
	}

	.match-loc {
		color: #999999;
	}

	.match-text {
		color: #333333;
		margin-left: 10px;
	}

	.no-result {
		font-size: 12px;
		color: #bbbbbb;
		margin: 0;
	}

	/* File list */
	.file-list {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.file-item {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		color: #666666;
	}

	/* Prose text block */
	.text-block {
		padding: 1px 0;
	}

	.prose-content :global(p) {
		font-size: 14px;
		line-height: 1.72;
		color: #222222;
		margin: 0 0 12px 0;
	}

	.prose-content :global(p:last-child) {
		margin-bottom: 0;
	}

	.prose-content :global(h1),
	.prose-content :global(h2),
	.prose-content :global(h3),
	.prose-content :global(h4) {
		font-size: 13px;
		font-weight: 600;
		color: #111111;
		letter-spacing: -0.01em;
		margin: 18px 0 6px 0;
	}

	.prose-content :global(code) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		background: #f0f6ff;
		border: 1px solid #dbeafe;
		padding: 1px 5px;
		color: #1d4ed8;
	}

	.prose-content :global(pre) {
		background: #f8f8f8;
		border: 1px solid #e8e8e8;
		padding: 12px 14px;
		overflow-x: auto;
		margin: 10px 0;
	}

	.prose-content :global(pre code) {
		background: none;
		border: none;
		padding: 0;
		font-size: 12px;
		color: #333333;
	}

	.prose-content :global(a) {
		color: #2563eb;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.prose-content :global(ul),
	.prose-content :global(ol) {
		padding-left: 20px;
		margin: 8px 0;
	}

	.prose-content :global(li) {
		font-size: 14px;
		color: #222222;
		line-height: 1.65;
		margin: 3px 0;
	}

	.prose-content :global(blockquote) {
		border-left: 3px solid #bfdbfe;
		padding-left: 12px;
		margin: 10px 0;
		color: #555555;
	}

	.prose-content :global(strong) {
		font-weight: 600;
		color: #111111;
	}

	.prose-content :global(hr) {
		border: none;
		border-top: 1px solid #e8e8e8;
		margin: 16px 0;
	}

	.stream-cursor {
		display: inline-block;
		width: 2px;
		height: 14px;
		background: #93c5fd;
		margin-left: 2px;
		vertical-align: text-bottom;
		animation: blink 1s step-start infinite;
	}

	@keyframes blink {
		0%,
		50% {
			opacity: 1;
		}
		51%,
		100% {
			opacity: 0;
		}
	}

	/* Error */
	.stream-error {
		font-size: 12px;
		color: #ef4444;
		max-width: 680px;
		margin: 8px auto 0;
	}

	/* ── Input Area ──────────────────────────────────── */
	.input-area {
		flex-shrink: 0;
		padding: 10px 24px 16px;
		background: #f5f5f5;
		display: flex;
		justify-content: center;
	}

	.input-inner {
		width: 100%;
		max-width: 620px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		background: #ffffff;
		border: 1px solid #e2e2e2;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
		padding: 10px 12px 8px;
	}

	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
	}

	.preset-chip {
		font-family: 'Figtree', sans-serif;
		font-size: 11px;
		font-weight: 500;
		padding: 2px 8px;
		border: 1px solid #e8e8e8;
		background: #f8f8f8;
		color: #999999;
		cursor: pointer;
		transition: all 0.1s;
	}

	.preset-chip:hover {
		background: #f0f6ff;
		border-color: #bfdbfe;
		color: #2563eb;
	}

	.preset-chip.active {
		background: #eff6ff;
		border-color: #93c5fd;
		color: #1d4ed8;
	}

	.repo-input {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		width: 100%;
		background: #f8f8f8;
		border: 1px solid #eeeeee;
		padding: 5px 8px;
		color: #333333;
		outline: none;
		transition: border-color 0.1s;
	}

	.repo-input::placeholder {
		color: #cccccc;
	}

	.repo-input:focus {
		border-color: #93c5fd;
		background: #ffffff;
	}

	.prompt-row {
		display: flex;
		align-items: flex-end;
		gap: 6px;
		border-top: 1px solid #f0f0f0;
		padding-top: 6px;
		margin-top: 2px;
	}

	.prompt-input {
		font-family: 'Figtree', sans-serif;
		font-size: 13px;
		flex: 1;
		background: transparent;
		border: none;
		padding: 4px 0;
		color: #111111;
		outline: none;
		resize: none;
		line-height: 1.5;
	}

	.prompt-input::placeholder {
		color: #cccccc;
	}

	.prompt-input:focus {
		border-color: #93c5fd;
		background: #ffffff;
	}

	.send-btn {
		flex-shrink: 0;
		width: 30px;
		height: 30px;
		background: #3b82f6;
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #ffffff;
		transition: background 0.1s;
		border-radius: 6px;
	}

	.send-btn:hover:not(:disabled) {
		background: #2563eb;
	}

	.send-btn:disabled {
		background: #dbeafe;
		color: #93c5fd;
		cursor: not-allowed;
	}

	.hint {
		font-size: 10px;
		color: #d0d0d0;
		margin: 0;
	}
</style>
