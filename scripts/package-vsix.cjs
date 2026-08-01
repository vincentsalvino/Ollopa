#!/usr/bin/env node
/**
 * Cross-platform VSIX packager.
 *
 * On Windows, vsce's `-o ../name-$(node -e "...").vsix` flag fails because
 * cmd's argument parser mangles the embedded `-e`. This script reads the
 * extension's version directly and shells out to vsce with a clean arg list.
 *
 * vsce 3.9.2 unconditionally un-ignores `README.md` and walks parent dirs to
 * find it, then re-adds the file with a `..`-relative path inside the zip —
 * yauzl then rejects the entry with `invalid relative path`. The fix is to
 * hand vsce a README that lives *inside* the package via `--readmePath`.
 */
const { spawn } = require('node:child_process');
const { copyFile, mkdir } = require('node:fs/promises');
const { resolve, dirname } = require('node:path');

(async () => {
  const root = resolve(__dirname, '..');
  const extPkg = require(resolve(root, 'extension', 'package.json'));
  const version = extPkg.version;
  const outFile = resolve(root, `ollopa-${version}.vsix`);

  console.log(`[package] version: ${version}`);
  console.log(`[package] output:  ${outFile}`);

  // Copy the workspace-root README into the extension/ directory so vsce can
  // pick it up via --readmePath without ever resolving a parent-relative path.
  const rootReadme = resolve(root, 'README.md');
  const extReadme = resolve(root, 'extension', 'README.md');
  await mkdir(dirname(extReadme), { recursive: true });
  await copyFile(rootReadme, extReadme);
  console.log(`[package] staged: ${extReadme}`);

  // Resolve the vsce CLI entry. The published bin entry is `vsce` (no .js),
  // but it just requires('./out/main'). Calling the underlying file works
  // on every platform without invoking a bash wrapper.
  const vsceEntry = resolve(root, 'node_modules', '@vscode', 'vsce', 'vsce');

  const proc = spawn(
    process.execPath,
    [
      vsceEntry,
      'package',
      '-o', outFile,
      '--readme-path', 'README.md',
      // ws is staged into dist/node_modules by copy-dist so it ships with
      // the .vsix. --no-dependencies stops vsce from running `npm list`
      // which walks the workspace root and emits ../ entries that yauzl
      // rejects as "invalid relative path".
      '--no-dependencies',
    ],
    { cwd: resolve(root, 'extension'), stdio: ['ignore', 'inherit', 'inherit'] },
  );

  proc.on('exit', (code) => {
    console.log(`[package] vsce exited with code ${code}`);
    process.exit(code ?? 1);
  });
})().catch((err) => {
  console.error('[package] failed:', err);
  process.exit(1);
});
