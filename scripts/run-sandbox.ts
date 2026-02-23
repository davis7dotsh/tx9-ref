import { build } from 'esbuild';
import { resolve } from 'path';
import { $ } from 'bun';

const ESBUILD_BANNER =
	"import { createRequire } from 'module'; const require = createRequire(import.meta.url);";

const targets = {
	demo: {
		label: 'demo (coderun)',
		entry: resolve('./src/lib/services/daytona/coderun.ts'),
		out: resolve('./src/lib/services/daytona/coderun.bundle.mjs')
	},
	stream: {
		label: 'stream server (coderunStream) → http://localhost:3213',
		entry: resolve('./src/lib/services/daytona/coderunStream.ts'),
		out: resolve('./src/lib/services/daytona/coderunStream.bundle.mjs')
	}
} as const;

const targetKey = (process.argv[2] ?? 'demo') as keyof typeof targets;
const spec = targets[targetKey];

if (!spec) {
	console.error(`Unknown target: ${process.argv[2]}. Use: demo | stream`);
	process.exit(1);
}

console.log(`[sandbox] building ${spec.label}...`);
await build({
	entryPoints: [spec.entry],
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: true,
	outfile: spec.out,
	banner: { js: ESBUILD_BANNER }
});

console.log(`[sandbox] running ${spec.label}`);
await $`bun ${spec.out}`;
