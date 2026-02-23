// this code runs on the daytona sandbox after it's built. no imports except for external deps, not other files
// requires the openai api key

import { createOpenAI } from '@ai-sdk/openai';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { stepCountIs, streamText, tool, type ModelMessage } from 'ai';
import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import Exa from 'exa-js';
import { exec } from 'node:child_process';
import * as Http from 'node:http';
import { promisify } from 'node:util';
import { z } from 'zod';

const execAsync = promisify(exec);

const REPOS_ROOT = '/tmp/repos';

const repoKeyFromUrl = (url: string) =>
	url
		.replace(/^https?:\/\//, '')
		.replace(/\.git$/, '')
		.replace(/[^a-zA-Z0-9-]/g, '-')
		.toLowerCase();

const systemPrompt = `You are a repository research agent. You can clone GitHub repos, search through their code, and read files to answer questions. You can also search the web for additional context.

When given a repo URL: clone it with cloneGitRepo, search for relevant code with searchRepo, and read specific files with readFile. Cite files using path:line format.
For general questions without a repo: use exaSearch to find current information.`;

const defaultPrompt = 'How do I use generator functions in javascript? Include example code.';

const trimSnippet = (text?: string | null) =>
	text?.replace(/\s+/g, ' ').trim().slice(0, 320) ?? null;

const createStream = (messages?: ModelMessage[]) => {
	const exaApiKey = process.env.EXA_API_KEY;
	if (!exaApiKey) throw new Error('EXA_API_KEY is missing');

	const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
	const exa = new Exa(exaApiKey);
	const prompt = process.env.BTCA_PROMPT?.trim() || defaultPrompt;
	const repoUrl = process.env.BTCA_REPO_URL?.trim();

	const userContent = repoUrl ? `Repository: ${repoUrl}\n\n${prompt}` : prompt;

	return streamText({
		model: openai('gpt-5.3-codex-api-preview'),
		messages: messages ?? [{ role: 'user', content: userContent }],
		system: systemPrompt,
		stopWhen: stepCountIs(20),
		tools: {
			exaSearch: tool({
				description:
					'Search the web with Exa for current docs, package updates, repos, and technical context.',
				inputSchema: z.object({
					query: z.string().min(2),
					numResults: z.number().int().min(1).max(10).optional()
				}),
				execute: async ({ query, numResults }) => {
					console.log(`[tool] exaSearch query="${query}" numResults=${numResults ?? 5}`);
					const response = await exa.search(query, {
						type: 'auto',
						numResults: numResults ?? 5,
						contents: { text: { maxCharacters: 10_000 } }
					});
					const results = response.results.map((r) => ({
						title: r.title ?? r.url,
						url: r.url,
						snippet: trimSnippet(r.text)
					}));
					console.log(`[tool] exaSearch returned ${results.length} results`);
					return { query, results };
				}
			}),

			cloneGitRepo: tool({
				description: 'Clone a public GitHub repository to the local filesystem for analysis.',
				inputSchema: z.object({
					repoUrl: z.string().describe('The GitHub repository URL to clone')
				}),
				execute: async ({ repoUrl: url }) => {
					try {
						const key = repoKeyFromUrl(url);
						const repoPath = `${REPOS_ROOT}/${key}`;
						await execAsync(`mkdir -p "${REPOS_ROOT}"`);
						const { stdout } = await execAsync(
							`[ -d "${repoPath}/.git" ] && echo yes || echo no`
						).catch(() => ({ stdout: 'no' }));
						if (stdout.trim() === 'yes') {
							console.log(`[tool] cloneGitRepo already cached at ${repoPath}`);
							return { status: 'already_cloned', repoPath, repoUrl: url };
						}
						console.log(`[tool] cloneGitRepo cloning ${url}`);
						await execAsync(`git clone --depth 1 "${url}" "${repoPath}"`);
						console.log(`[tool] cloneGitRepo done → ${repoPath}`);
						return { status: 'cloned', repoPath, repoUrl: url };
					} catch (err) {
						console.error(`[tool] cloneGitRepo error`, err);
						return { error: String(err), repoUrl: url };
					}
				}
			}),

			searchRepo: tool({
				description:
					'Search for a pattern in a cloned repository using ripgrep. Returns matching lines with file paths and line numbers.',
				inputSchema: z.object({
					repoPath: z.string().describe('Absolute path to the cloned repository'),
					pattern: z.string().describe('Search pattern (supports regex)'),
					glob: z.string().optional().describe('File glob pattern to filter (e.g. "*.ts", "*.py")'),
					maxResults: z.number().int().min(1).max(50).optional()
				}),
				execute: async ({ repoPath, pattern, glob, maxResults }) => {
					try {
						const limit = maxResults ?? 20;
						const globFlag = glob ? `--glob '${glob}'` : '';
						const rgCmd = `rg -n ${globFlag} --max-count 1 "${pattern}" "${repoPath}" 2>/dev/null | head -${limit}`;
						const grepCmd = `grep -rn "${pattern}" "${repoPath}" 2>/dev/null | head -${limit}`;

						let output = '';
						try {
							output = (await execAsync(rgCmd)).stdout;
						} catch {
							try {
								output = (await execAsync(grepCmd)).stdout;
							} catch {
								output = '';
							}
						}

						const matches = output
							.trim()
							.split('\n')
							.filter(Boolean)
							.map((line) => {
								const m = line.match(/^(.+?):(\d+):(.*)$/);
								return m
									? {
											file: m[1].replace(repoPath + '/', ''),
											line: parseInt(m[2]),
											content: m[3].trim()
										}
									: { file: '', line: 0, content: line };
							})
							.filter((m) => m.file);

						console.log(`[tool] searchRepo pattern="${pattern}" found ${matches.length} matches`);
						return { pattern, repoPath, matches, count: matches.length };
					} catch (err) {
						console.error(`[tool] searchRepo error`, err);
						return { error: String(err), pattern, repoPath, matches: [], count: 0 };
					}
				}
			}),

			readFile: tool({
				description:
					'Read a file from a cloned repository, optionally specifying a line range to avoid reading huge files.',
				inputSchema: z.object({
					filePath: z.string().describe('Absolute path to the file'),
					startLine: z.number().int().optional().describe('Starting line number (1-indexed)'),
					endLine: z.number().int().optional().describe('Ending line number (inclusive)')
				}),
				execute: async ({ filePath, startLine, endLine }) => {
					try {
						let content: string;
						if (startLine && endLine) {
							content = (await execAsync(`sed -n "${startLine},${endLine}p" "${filePath}"`)).stdout;
						} else {
							content = (await execAsync(`head -200 "${filePath}"`)).stdout;
						}
						console.log(`[tool] readFile ${filePath} (${content.split('\n').length} lines)`);
						return { filePath, content, startLine, endLine };
					} catch (err) {
						console.error(`[tool] readFile error`, err);
						return { error: String(err), filePath, content: '' };
					}
				}
			}),

			listFiles: tool({
				description: "List files in a repository directory to understand the project's structure.",
				inputSchema: z.object({
					dirPath: z.string().describe('Directory path to list'),
					depth: z.number().int().min(1).max(4).optional().describe('How many levels deep to list')
				}),
				execute: async ({ dirPath, depth }) => {
					try {
						const maxDepth = depth ?? 2;
						const result = await execAsync(
							`find "${dirPath}" -maxdepth ${maxDepth} -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/__pycache__/*" | sort | head -100`
						);
						const files = result.stdout.trim().split('\n').filter(Boolean);
						console.log(`[tool] listFiles ${dirPath} found ${files.length} entries`);
						return { dirPath, files, count: files.length };
					} catch (err) {
						console.error(`[tool] listFiles error`, err);
						return { error: String(err), dirPath, files: [], count: 0 };
					}
				}
			})
		}
	});
};

export type CodeRunStreamChunkType = ReturnType<typeof createStream>['fullStream'];

const MyRoutes = HttpRouter.use((router) =>
	Effect.gen(function* () {
		yield* router.add(
			'POST',
			'/stream',
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest;
				const body = yield* request.json.pipe(Effect.orElseSucceed(() => ({}) as unknown));
				const messages = (body as { messages?: ModelMessage[] }).messages;

				const result = createStream(messages);

				const mainStream = Stream.fromAsyncIterable(result.fullStream, (err) =>
					console.error(err)
				).pipe(Stream.map((part) => JSON.stringify({ event: 'data', chunk: part }) + '\n'));

				const doneStream = Stream.fromEffect(
					Effect.promise(() => result.response).pipe(
						Effect.map(
							({ messages: responseMessages }) =>
								JSON.stringify({
									event: 'data',
									chunk: { type: 'done', messages: responseMessages }
								}) + '\n'
						)
					)
				);

				return HttpServerResponse.stream(
					Stream.concat(mainStream, doneStream).pipe(Stream.encodeText)
				);
			})
		);

		yield* router.add('GET', '/health', HttpServerResponse.json({ status: 'ok' }));
	})
);

const serverLayer = HttpRouter.serve(MyRoutes).pipe(
	Layer.provideMerge(NodeHttpServer.layer(() => Http.createServer(), { port: 3213 }))
);

const program = Effect.gen(function* () {
	console.log('Server running on http://localhost:3213');
	yield* Effect.never;
}).pipe(Effect.provide(serverLayer));

NodeRuntime.runMain(program);
