/**
 * Marketplace installer unit tests (Phase 10).
 *
 * Verifies:
 *   - parseSpec recognizes npm: / github: / git: prefixes
 *   - loadLockFile / saveLockFile roundtrip
 *   - integrity() hashes the plugin.json + payload files
 *   - parseSpec rejects malformed inputs
 *
 * Pure unit test — no network, no Supabase, no LLM.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseSpec,
  loadLockFile,
  saveLockFile,
  type LockFile,
} from '../dist/plugins/marketplace';
import { integrity } from '../dist/plugins/marketplace';

function freshLock(tmp: string): void {
  process.env.OLLOPA_LOCK_PATH = join(tmp, 'plugins.lock.json');
  // marketplace.ts honours USERPROFILE / HOME for its paths, so point HOME here.
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
}

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}: ${err.message}\n${err.stack}`); throw err; });
}

async function run(): Promise<void> {
  console.log('[marketplace] unit tests');
  const tmp = mkdtempSync(join(tmpdir(), 'ollopa-mp-test-'));

  await test('parseSpec parses npm: with version', () => {
    const s = parseSpec('npm:@scope/name@1.2.3');
    assert.equal(s.kind, 'npm');
    assert.equal(s.spec, '@scope/name@1.2.3');
  });

  await test('parseSpec parses npm: without version', () => {
    const s = parseSpec('npm:@scope/name');
    assert.equal(s.kind, 'npm');
    assert.equal(s.spec, '@scope/name');
    assert.equal(s.ref, undefined);
  });

  await test('parseSpec parses github: owner/repo@ref', () => {
    const s = parseSpec('github:owner/repo@v1.0.0');
    assert.equal(s.kind, 'github');
    assert.equal(s.spec, 'owner/repo');
    assert.equal(s.ref, 'v1.0.0');
  });

  await test('parseSpec parses github: owner/repo without ref', () => {
    const s = parseSpec('github:owner/repo');
    assert.equal(s.ref, undefined);
  });

  await test('parseSpec parses git: with #ref', () => {
    const s = parseSpec('git:https://github.com/owner/repo.git#main');
    assert.equal(s.kind, 'git');
    assert.equal(s.spec, 'https://github.com/owner/repo.git');
    assert.equal(s.ref, 'main');
  });

  await test('parseSpec parses git: without ref', () => {
    const s = parseSpec('git:https://github.com/owner/repo.git');
    assert.equal(s.spec, 'https://github.com/owner/repo.git');
    assert.equal(s.ref, undefined);
  });

  await test('parseSpec rejects bad github shape', () => {
    assert.throws(() => parseSpec('github:no-slash'), /owner\/repo/);
  });

  await test('parseSpec rejects unknown prefix', () => {
    assert.throws(() => parseSpec('http:example.com/x'), /npm:|github:|git:/);
  });

  await test('lockfile roundtrip', () => {
    freshLock(tmp);
    const orig: LockFile = { version: 1, entries: {} };
    orig.entries['demo'] = {
      id: 'demo@0.1.0',
      name: 'demo',
      version: '0.1.0',
      source: 'npm:@x/demo@0.1.0',
      integrity: 'sha256:abc',
      installedAt: new Date().toISOString(),
    };
    saveLockFile(orig);
    const back = loadLockFile();
    assert.equal(back.entries['demo'].name, 'demo');
    assert.equal(back.entries['demo'].version, '0.1.0');
    assert.equal(back.entries['demo'].source, 'npm:@x/demo@0.1.0');
  });

  await test('integrity() hashes plugin.json + payload files', () => {
    const proj = mkdtempSync(join(tmp, 'plug-'));
    writeFileSync(join(proj, 'plugin.json'), JSON.stringify({ name: 'demo', version: '0.1.0', description: 'x' }));
    mkdirSync(join(proj, 'commands'));
    writeFileSync(join(proj, 'commands', 'hello.md'), '---\nname: hello\ndescription: hi\n---\nbody');
    mkdirSync(join(proj, 'agents'));
    writeFileSync(join(proj, 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: reviews\n---\nprompt');

    const h1 = integrity(proj);
    assert.match(h1, /^sha256:[a-f0-9]{64}$/);
    // Changing a payload file changes the hash.
    writeFileSync(join(proj, 'commands', 'hello.md'), '---\nname: hello\ndescription: changed\n---\nbody');
    const h2 = integrity(proj);
    assert.notEqual(h1, h2);
  });

  rmSync(tmp, { recursive: true, force: true });
  console.log('[marketplace] all passed');
}

run().then(() => process.exit(0)).catch((err) => {
  console.error('[marketplace] FAILED:', err);
  process.exit(1);
});
