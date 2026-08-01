/**
 * Skill loader unit tests (Phase 10).
 *
 * Verifies:
 *   - parseFrontmatter splits YAML frontmatter from body
 *   - loadSkillFromFile parses a SKILL.md
 *   - renderSkillContext returns empty for no matches and a small block otherwise
 *   - parseCommandArgs handles key=value and quoted strings
 *   - renderTemplate substitutes {{key}} placeholders
 *
 * Pure unit test — no network, no Supabase, no LLM.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter } from '../dist/plugins/frontmatter';
import {
  loadSkillFromFile, setSkills, getSkill, listSkills,
  renderSkillContext,
} from '../dist/plugins/skills';
import { parseCommandArgs, renderTemplate } from '../dist/plugins/commandsMd';

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}: ${err.message}\n${err.stack}`); throw err; });
}

async function run(): Promise<void> {
  console.log('[skills] unit tests');

  await test('parseFrontmatter splits YAML from body', () => {
    const raw = `---
name: hi
description: Say hi
autoTrigger: true
---
Greet the user warmly.`;
    const { meta, body } = parseFrontmatter(raw);
    assert.equal(meta.name, 'hi');
    assert.equal(meta.description, 'Say hi');
    assert.equal(meta.autoTrigger, true);
    assert.match(body, /Greet the user/);
  });

  await test('parseFrontmatter returns whole text as body when no frontmatter', () => {
    const { meta, body } = parseFrontmatter('just a body');
    assert.deepEqual(meta, {});
    assert.equal(body, 'just a body');
  });

  await test('parseFrontmatter parses inline arrays', () => {
    const raw = `---
name: t
tools: [read_file, search_replace]
---
body`;
    const { meta } = parseFrontmatter(raw);
    assert.deepEqual(meta.tools, ['read_file', 'search_replace']);
  });

  await test('parseFrontmatter parses list blocks', () => {
    const raw = `---
name: t
tools:
  - read_file
  - search_replace
---
body`;
    const { meta } = parseFrontmatter(raw);
    assert.deepEqual(meta.tools, ['read_file', 'search_replace']);
  });

  await test('parseCommandArgs handles key=value pairs', () => {
    const out = parseCommandArgs('name=Ada age=42');
    assert.equal(out.name, 'Ada');
    assert.equal(out.age, '42');
  });

  await test('parseCommandArgs handles quoted strings', () => {
    const out = parseCommandArgs('"fix: typo"');
    assert.equal(out._, 'fix: typo');
  });

  await test('parseCommandArgs captures trailing positionals', () => {
    const out = parseCommandArgs('commit fix the bug');
    assert.equal(out._, 'commit fix the bug');
  });

  await test('renderTemplate substitutes placeholders', () => {
    const out = renderTemplate('Hello, {{who}}!', { who: 'Ada' });
    assert.equal(out, 'Hello, Ada!');
  });

  await test('loadSkillFromFile parses a SKILL.md', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ollopa-skill-'));
    const dir = join(tmp, 'summarise');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'),
      `---
name: summarise
description: Summarise a long file
autoTrigger: true
---
Read the source first, then produce 3 bullets.`);
    const skill = loadSkillFromFile('demo-plugin', join(dir, 'SKILL.md'));
    assert.ok(skill);
    assert.equal(skill!.name, 'summarise');
    assert.equal(skill!.autoTrigger, true);
    assert.match(skill!.prompt, /3 bullets/);
  });

  await test('setSkills replaces the global registry', () => {
    setSkills([
      { name: 'a', description: 'aa', autoTrigger: true, prompt: 'p', origin: 'o' },
      { name: 'b', description: 'bb', autoTrigger: false, prompt: 'q', origin: 'o' },
    ]);
    const all = listSkills();
    assert.equal(all.length, 2);
    assert.ok(getSkill('a'));
    assert.ok(getSkill('b'));
  });

  await test('renderSkillContext is empty for empty selection', () => {
    assert.equal(renderSkillContext([]), '');
  });

  await test('renderSkillContext formats a non-empty selection', () => {
    setSkills([{ name: 'x', description: 'x', autoTrigger: true, prompt: 'p', origin: 'o' }]);
    const out = renderSkillContext([{ skill: listSkills()[0], score: 0.91 }]);
    assert.match(out, /\[skill:x score=0\.91\]/);
    assert.match(out, /^Available skills/);
  });

  console.log('[skills] all passed');
}

run().then(() => process.exit(0)).catch((err) => {
  console.error('[skills] FAILED:', err);
  process.exit(1);
});
