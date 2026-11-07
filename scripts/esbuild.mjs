import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

rmSync(path.join(root, 'out'), { recursive: true, force: true });

const shared = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  sourcesContent: false,
  logLevel: 'info',
  absWorkingDir: root,
};

const builds = [
  {
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'out/extension.js',
    external: ['vscode'],
  },
  {
    ...shared,
    entryPoints: ['src/server/index.ts'],
    outfile: 'out/server/index.js',
  },
];

if (watch) {
  const tsc = spawn(
    process.execPath,
    [path.join(root, 'node_modules', 'typescript', 'lib', 'tsc.js'), '-p', '.', '--noEmit', '--watch', '--preserveWatchOutput'],
    { cwd: root, stdio: 'inherit' },
  );
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
  process.on('SIGINT', () => {
    tsc.kill();
    process.exit(130);
  });
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
