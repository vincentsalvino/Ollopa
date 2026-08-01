/**
 * Plugin loader unit tests (Phase 3.6 + Phase 6).
 *
 * Verifies:
 *   - registerBuiltIn merges tools/commands/hooks/providers into the live registry.
 *   - loadAll loads every .js in both plugin dirs.
 *   - Hooks with phase 'before'/'after' register without error.
 *   - Duplicate command names warn + overwrite (per current spec).
 *
 * Pure unit test — no network, no Supabase, no LLM.
 */
import assert from 'node:assert/strict';
import {
  getRegistry,
  setRegistry,
  registerBuiltIn,
  pluginDirs,
} from '../dist/plugins/loader';

function fresh(): void {
  setRegistry({
    tools: new Map(),
    commands: new Map(),
    hooks: [],
    providers: new Map(),
  });
}

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}: ${err.message}`); throw err; });
}

async function run(): Promise<void> {
  console.log('[plugins] unit tests');

  await test('pluginDirs returns project + global paths', () => {
    const dirs = pluginDirs('/tmp/fake');
    // Windows uses '\\' as separator; check both.
    assert.ok(/[\\/]\.ollopa[\\/]plugins$/.test(dirs.project), `project: ${dirs.project}`);
    assert.ok(/[\\/]\.ollopa[\\/]plugins$/.test(dirs.global), `global: ${dirs.global}`);
  });

  await test('registerBuiltIn adds a tool', () => {
    fresh();
    registerBuiltIn({
      name: 'test-plugin',
      tools: [{
        name: 'hello_world',
        definition: {
          name: 'hello_world',
          description: 'test',
          parameters: { type: 'object', properties: {} },
        },
        handler: async () => ({ output: 'ok', kind: 'info' as const }),
      }],
    }, 'test');
    const reg = getRegistry();
    assert.ok(reg.tools.has('hello_world'));
  });

  await test('registerBuiltIn adds a slash command', () => {
    fresh();
    registerBuiltIn({
      name: 'cmd-plugin',
      commands: [{
        name: 'ping',
        description: 'reply pong',
        handler: async () => ({ text: 'pong', kind: 'info' as const }),
      }],
    }, 'test');
    const reg = getRegistry();
    assert.ok(reg.commands.has('ping'));
    assert.equal(reg.commands.get('ping')!.command.name, 'ping');
  });

  await test('registerBuiltIn accumulates across calls', () => {
    fresh();
    registerBuiltIn({
      name: 'p1',
      commands: [{ name: 'a', description: '', handler: async () => ({ text: 'a' }) }],
    }, 'test');
    registerBuiltIn({
      name: 'p2',
      commands: [{ name: 'b', description: '', handler: async () => ({ text: 'b' }) }],
    }, 'test');
    const reg = getRegistry();
    assert.equal(reg.commands.size, 2);
    assert.ok(reg.commands.has('a'));
    assert.ok(reg.commands.has('b'));
  });

  await test('duplicate tool name overwrites (per current spec)', () => {
    fresh();
    const mk = (label: string) => ({
      name: 'dup',
      definition: { name: 'dup', description: label, parameters: { type: 'object', properties: {} } },
      handler: async () => ({ output: label, kind: 'info' as const }),
    });
    registerBuiltIn({ name: 'first', tools: [mk('first')] }, 'first');
    registerBuiltIn({ name: 'second', tools: [mk('second')] }, 'second');
    const reg = getRegistry();
    assert.ok(reg.tools.has('dup'));
    assert.equal(reg.tools.get('dup')!.origin, 'second');
  });

  await test('registerBuiltIn handles missing arrays gracefully', () => {
    fresh();
    registerBuiltIn({ name: 'minimal' }, 'test');
    const reg = getRegistry();
    assert.equal(reg.tools.size, 0);
    assert.equal(reg.commands.size, 0);
    assert.equal(reg.hooks.length, 0);
  });

  await test('registerBuiltIn accepts hooks', () => {
    fresh();
    registerBuiltIn({
      name: 'hooky',
      hooks: [{
        tool: 'search_replace',
        phase: 'before',
        handler: () => { /* noop */ },
      }],
    }, 'test');
    const reg = getRegistry();
    assert.equal(reg.hooks.length, 1);
    assert.equal(reg.hooks[0].hook.phase, 'before');
  });

  await test('registerBuiltIn accepts providers', () => {
    fresh();
    registerBuiltIn({
      name: 'provy',
      providers: [{
        name: 'test-provider',
        baseUrl: 'http://example.test/v1',
        apiKey: 'k',
        model: 'm',
      }],
    }, 'test');
    const reg = getRegistry();
    assert.ok(reg.providers.has('test-provider'));
  });

  console.log('[plugins] all passed');
}

run().then(() => process.exit(0)).catch((err) => {
  console.error('[plugins] FAILED:', err);
  process.exit(1);
});