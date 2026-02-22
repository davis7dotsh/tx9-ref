import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import { build } from 'esbuild';
import path from 'path';
import fs from 'fs/promises';

const VIRTUAL_ID = 'virtual:coderun-bundle';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
const ENTRY = path.resolve('./src/lib/services/daytona/coderun.ts');
const OUT = path.resolve('./src/lib/services/daytona/coderun.bundle.mjs');

const buildBundle = async (): Promise<string> => {
	const result = await build({
		entryPoints: [ENTRY],
		bundle: true,
		platform: 'node',
		format: 'esm',
		write: false,
		banner: {
			js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
		}
	});
	const text = result.outputFiles[0].text;
	await fs.writeFile(OUT, text);
	return text;
};

const coderunBundlePlugin = (): Plugin => {
	let bundle = '';

	return {
		name: 'coderun-bundle',
		async buildStart() {
			bundle = await buildBundle();
		},
		resolveId(id) {
			if (id === VIRTUAL_ID) return RESOLVED_ID;
		},
		load(id) {
			if (id === RESOLVED_ID) return `export default ${JSON.stringify(bundle)};`;
		},
		async handleHotUpdate({ file, server }) {
			if (file === ENTRY) {
				bundle = await buildBundle();
				const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
				if (mod) server.moduleGraph.invalidateModule(mod);
				server.hot.send({ type: 'full-reload' });
			}
		}
	};
};

export default defineConfig({ plugins: [tailwindcss(), sveltekit(), coderunBundlePlugin()] });
