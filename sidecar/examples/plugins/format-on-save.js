/**
 * Example plugin: format-on-save.
 *
 * Registers an `after` hook on the `search_replace` builtin tool. When the
 * agent edits a file, we run Prettier against the changed file (if it
 * exists) and overwrite the temp workspace file in place.
 *
 * MVP: spawns `npx prettier --write <relative-path>` from the temp
 * workspace. Fails silently — formatting is best-effort.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

module.exports = {
  name: 'format-on-save',
  version: '0.1.0',
  hooks: [
    {
      tool: 'search_replace',
      phase: 'after',
      handler: ({ args, output }) => {
        if (!args || typeof args.filePath !== 'string') return;
        const tempRoot = thisTempRoot();
        if (!tempRoot) return;
        const abs = path.join(tempRoot, args.filePath);
        if (!fs.existsSync(abs)) return;
        // Best-effort. Don't await — we don't want to slow the agent loop.
        const child = spawn(
          'npx',
          ['--no-install', 'prettier', '--write', abs],
          { cwd: tempRoot, stdio: 'ignore' },
        );
        child.on('error', () => { /* prettier missing — ignore */ });
      },
    },
  ],
};

// The plugin loader does not give us a context object on hooks. We rely on
// the temp workspace being the only thing the bridge is allowed to write to,
// so a side-channel stash is OK for the MVP.
function thisTempRoot() {
  return global.__ollopaTempRoot || null;
}
