import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import { build } from 'esbuild';
import path from 'path';
import fs from 'fs/promises';

const ESBUILD_BANNER =
	"import { createRequire } from 'module'; const require = createRequire(import.meta.url);";

type BundleSpec = { virtualId: string; entry: string; out: string };

const BUNDLES: BundleSpec[] = [
	{
		virtualId: 'virtual:coderun-bundle',
		entry: path.resolve('./src/lib/services/daytona/coderun.ts'),
		out: path.resolve('./src/lib/services/daytona/coderun.bundle.mjs')
	},
	{
		virtualId: 'virtual:coderun-stream-bundle',
		entry: path.resolve('./src/lib/services/daytona/coderunStream.ts'),
		out: path.resolve('./src/lib/services/daytona/coderunStream.bundle.mjs')
	}
];

const buildBundle = async (spec: BundleSpec): Promise<string> => {
	const result = await build({
		entryPoints: [spec.entry],
		bundle: true,
		platform: 'node',
		format: 'esm',
		write: false,
		banner: { js: ESBUILD_BANNER }
	});
	const text = result.outputFiles[0].text;
	await fs.writeFile(spec.out, text);
	return text;
};

const sandboxBundlesPlugin = (): Plugin => {
	const resolvedIds = new Map(BUNDLES.map((b) => [b.virtualId, '\0' + b.virtualId]));
	const bundles = new Map<string, string>();
	const entryToVirtualId = new Map(BUNDLES.map((b) => [b.entry, b.virtualId]));

	return {
		name: 'sandbox-bundles',
		async buildStart() {
			await Promise.all(
				BUNDLES.map(async (spec) => {
					bundles.set(spec.virtualId, await buildBundle(spec));
				})
			);
		},
		resolveId(id) {
			return resolvedIds.get(id);
		},
		load(id) {
			for (const [virtualId, resolvedId] of resolvedIds) {
				if (id === resolvedId) return `export default ${JSON.stringify(bundles.get(virtualId))};`;
			}
		},
		async handleHotUpdate({ file, server }) {
			const virtualId = entryToVirtualId.get(file);
			if (!virtualId) return;
			const spec = BUNDLES.find((b) => b.virtualId === virtualId)!;
			bundles.set(virtualId, await buildBundle(spec));
			const resolvedId = resolvedIds.get(virtualId)!;
			const mod = server.moduleGraph.getModuleById(resolvedId);
			if (mod) server.moduleGraph.invalidateModule(mod);
			server.hot.send({ type: 'full-reload' });
		}
	};
};

export default defineConfig({ plugins: [tailwindcss(), sveltekit(), sandboxBundlesPlugin()] });
