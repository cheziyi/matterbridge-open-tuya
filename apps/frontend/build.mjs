/**
 * build.mjs
 *
 * Builds the setup page into apps/frontend/build, where Matterbridge looks for a plugin frontend:
 * checks the types with tsc, bundles src/app.ts and what it imports into one app.js with esbuild, and copies the
 * static files next to it.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import * as esbuild from 'esbuild';

const root = import.meta.dirname;
const build = path.join(root, 'build');

rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });
// esbuild does not check types, so tsc does first: tsconfig.json has it emit nothing.
// npm puts node_modules/.bin on the PATH of a script, so tsc resolves from this package or from the plugin's.
execFileSync('tsc', ['--project', path.join(root, 'tsconfig.json')], { stdio: 'inherit', shell: process.platform === 'win32' });
await esbuild.build({
  entryPoints: [path.join(root, 'src', 'app.ts')],
  outfile: path.join(build, 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  // The map lets the browser show the TypeScript the page was built from.
  sourcemap: true,
  logLevel: 'warning',
});
for (const file of ['index.html', 'styles.css']) cpSync(path.join(root, 'src', file), path.join(build, file));
console.log(`Built the setup page into ${build}`);
