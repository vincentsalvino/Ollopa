#!/usr/bin/env node
/**
 * Post-build copy step — bundles the webview and sidecar build outputs
 * inside the extension's package directory so the .vsix is self-contained.
 *
 * Runs after `npm run build:extension` (and after webview + sidecar builds).
 * Idempotent — overwrites prior copies.
 */
const { cpSync, existsSync, mkdirSync, rmSync } = require('node:fs');
const { resolve, dirname } = require('node:path');

const root = resolve(__dirname, '..', '..');
const ext = resolve(root, 'extension');

function copyDir(srcRel, dstRel, label, { optional = false } = {}) {
  const src = resolve(root, srcRel);
  const dst = resolve(ext, dstRel);
  if (!existsSync(src)) {
    if (optional) {
      console.log(`[copy-dist] skip ${label}: source not found at ${src}`);
      return;
    }
    throw new Error(`${label}: source not found at ${src}`);
  }
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log(`[copy-dist] ${label}: ${srcRel} -> extension/${dstRel}`);
}

try {
  copyDir('webview/dist', 'webview/dist', 'webview build');
  // Only copy sidecar/dist/start.js + the import graph it needs; full
  // node_modules mirroring is heavy and unused (sidecar resolves via tsx in
  // dev, via Node resolution otherwise). Copy dist + memory + llm + agents
  // + plugins etc. so the JS graph is intact.
  copyDir('sidecar/dist', 'sidecar/dist', 'sidecar build');
  // Stage `ws` under dist/node_modules so vsce's cwd walker (which hard-codes
  // `ignore: 'node_modules/**'` at the dep-collection phase and bypasses
  // .vscodeignore negation) still picks it up. The extension host finds it
  // from dist/sidecarManager.js via normal resolution. The sidecar child
  // process is spawned with NODE_PATH pointing here so its require('ws')
  // resolves too.
  //
  // NOTE: only `ws` is staged. The sidecar's other runtime deps
  // (`@langchain/langgraph`, `@supabase/supabase-js`, `better-sqlite3`,
  // `diff`, `dotenv`) and their transitive tree are NOT included — they
  // would balloon the .vsix to ~70 MB and the script does not currently
  // walk transitive deps. The sidecar child process will fail to load
  // those modules until the sidecar is bundled (esbuild) or the dep tree
  // is mirrored wholesale. See [[ollopa-sidecar-bundling]].
  // Stage `ws` (used by the extension host) and `diff` (used by
  // toolBridge.ts for createTwoFilesPatch) under dist/node_modules. The
  // extension's tsc emit produces CJS require()s for these and they must
  // resolve at runtime. esbuild already inlines everything inside
  // dist/sidecar.js, so this only covers deps loaded by the extension
  // host itself. -- ponytail: replace with esbuild bundling of the
  // extension too, when the dep list grows past a handful.
  copyDir('node_modules/ws', 'dist/node_modules/ws', 'ws runtime dep');
  copyDir('node_modules/diff', 'dist/node_modules/diff', 'diff runtime dep');
  // Stage `better-sqlite3` (the one external dep) under dist/node_modules.
  // esbuild inlines every JS dep into dist/sidecar.js; native modules must
  // be externalised because esbuild can't bundle .node binaries. The
  // directory copy brings the platform-specific .node file too, which is
  // how better-sqlite3's JS entry resolves its binding at runtime.
  copyDir('node_modules/better-sqlite3', 'dist/node_modules/better-sqlite3', 'better-sqlite3 native dep');
  // `bindings` is the only pure-JS dep of better-sqlite3. It can't be
  // bundled by esbuild (it's loaded by the externalised better-sqlite3
  // module at runtime). Stage it alongside so Node's resolver finds it.
  // better-sqlite3 v13 dropped `bindings` in favour of node-addon-api +
  // a single per-platform prebuild — the bindings dir won't exist on
  // installs that pulled v13+.
  copyDir('node_modules/bindings', 'dist/node_modules/bindings', 'better-sqlite3 transitive: bindings', { optional: true });
  // `file-uri-to-path` is a transitive of bindings on Windows. Same story.
  copyDir('node_modules/file-uri-to-path', 'dist/node_modules/file-uri-to-path', 'bindings transitive: file-uri-to-path', { optional: true });
  console.log('[copy-dist] done');
} catch (err) {
  console.error('[copy-dist] FAILED:', err.message);
  process.exit(1);
}