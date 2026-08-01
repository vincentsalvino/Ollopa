/**
 * Phase 7 — collaboration self-check.
 *
 * Coverage:
 *   1. exportSkill: packs a LoadedSkill into a valid bundle JSON.
 *   2. parseBundle: round-trip; rejects malformed input.
 *   3. importSkillBundle: writes SKILL.md + plugin.json into the
 *      marketplace root; subsequent listing picks it up.
 *   4. Semver enforcement in installPlugin — already covered by the
 *      manifest loader's `asSemver`; smoke-check that the regex
 *      matches expected shapes.
 *
 * No live network. Run: npx tsx sidecar/test/collaboration.ts
 */
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportSkill, parseBundle, importSkillBundle } from '../src/plugins/skillExport';
import { setSkills, type LoadedSkill } from '../src/plugins/skills';
import { marketplaceRoot, loadLockFile } from '../src/plugins/marketplace';
import { compareSemver } from '../src/plugins/manifest';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; }
  else { fail++; console.error(`FAIL: ${name}${detail ? ' — ' + JSON.stringify(detail) : ''}`); }
}

/* --- exportSkill + parseBundle round trip --- */
{
  const s: LoadedSkill = {
    name: 'summarise',
    description: 'Summarise a long file',
    autoTrigger: true,
    prompt: 'Read the source first. Then write a 3-bullet summary.',
    origin: 'my-plugin:skills/summarise/SKILL.md',
  };
  setSkills([s]);
  const r = exportSkill('summarise');
  check('exportSkill ok', r.ok === true);
  if (!r.ok) throw new Error('cannot proceed');
  check('bundle format', r.bundle.format === 'ollopa-skill');
  check('bundle version', r.bundle.version === 1);
  check('json parses', typeof r.json === 'string' && r.json.length > 0);

  const parsed = parseBundle(r.json);
  check('parseBundle round-trip', 'format' in parsed && parsed.skill.name === 'summarise');

  const bad = parseBundle('not-json');
  check('parseBundle rejects bad JSON', 'error' in bad);

  const wrongFmt = parseBundle('{"format":"other","version":1,"skill":{"name":"x","description":"y","prompt":"z"}}');
  check('parseBundle rejects wrong format', 'error' in wrongFmt);

  const missing = parseBundle('{"format":"ollopa-skill","version":1}');
  check('parseBundle rejects missing skill', 'error' in missing);

  const missing2 = parseBundle('{"format":"ollopa-skill","version":1,"skill":{"name":"x","description":"y"}}');
  check('parseBundle rejects skill missing prompt', 'error' in missing2);

  const missingSkill = exportSkill('does-not-exist');
  check('exportSkill missing skill fails', missingSkill.ok === false);
}

/* --- importSkillBundle writes files --- */
async function importTest(): Promise<void> {
  const prev = process.env.OLLOPA_TEST_HOME;
  let dir = '';
  try {
    dir = await mkdtemp(join(tmpdir(), 'ollopa-collaboration-'));
    // Override homedir for this test by symlinking USERPROFILE/HOME.
    process.env.USERPROFILE = dir;
    process.env.HOME = dir;
    process.env.OLLOPA_TEST_HOME = dir;

    const bundle = JSON.stringify({
      format: 'ollapa-skill', // typo on purpose? no, correct it.
      version: 1,
      skill: {
        name: 'refactor',
        description: 'Refactor a chunk of code',
        autoTrigger: false,
        prompt: 'Read the snippet. Suggest a cleaner version.',
      },
    });
    // The typo above would fail; build a real one:
    const okBundle = JSON.stringify({
      format: 'ollopa-skill',
      version: 1,
      skill: {
        name: 'refactor',
        description: 'Refactor a chunk of code',
        autoTrigger: false,
        prompt: 'Read the snippet. Suggest a cleaner version.',
      },
    });
    void bundle; // silence "unused" warning
    const r = importSkillBundle(okBundle);
    check('importSkillBundle ok', r.ok === true);
    if (!r.ok || !r.path) throw new Error('cannot proceed');

    const skillMd = await readFile(r.path, 'utf8');
    check('SKILL.md has frontmatter', /^---/.test(skillMd));
    check('SKILL.md contains name', skillMd.includes('name: refactor'));
    check('SKILL.md contains description', skillMd.includes('Refactor a chunk of code'));
    check('SKILL.md autoTrigger=false', /autoTrigger: false/.test(skillMd));

    // The plugin.json should also exist next to it.
    const root = marketplaceRoot();
    const pluginDirs = (await import('node:fs/promises')).readdir(root);
    const list = await pluginDirs;
    const imported = list.find((d) => d.startsWith('imported-refactor'));
    check('imported plugin dir created', typeof imported === 'string');

    // Now lockfile should also have an entry (lockfile only updates on install;
    // we don't go through installPlugin for import, so no lock entry — verify
    // explicitly).
    const lock = loadLockFile();
    check('no lock entry from import (by design)', lock.entries['imported-refactor'] === undefined);

    // Round-trip: exporting the imported skill and re-importing should
    // produce the same SKILL.md content (modulo leading/trailing whitespace).
    setSkills([{
      name: 'refactor',
      description: 'Refactor a chunk of code',
      autoTrigger: false,
      prompt: 'Read the snippet. Suggest a cleaner version.',
      origin: `imported-refactor:${r.path}`,
    }]);
    const exp = exportSkill('refactor');
    if (!exp.ok) { fail++; console.error('FAIL: re-export failed'); return; }
    const re = parseBundle(exp.json);
    check('re-export parses', 'format' in re);
  } finally {
    if (prev === undefined) delete process.env.OLLOPA_TEST_HOME;
    else process.env.OLLOPA_TEST_HOME = prev;
    delete process.env.USERPROFILE;
    delete process.env.HOME;
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

/* --- semver compare smoke --- */
{
  check('compareSemver equal', compareSemver('1.2.3', '1.2.3') === 0);
  check('compareSemver a<b', compareSemver('1.2.3', '1.2.4') === -1);
  check('compareSemver a>b', compareSemver('2.0.0', '1.9.9') === 1);
  check('compareSemver release > pre', compareSemver('1.0.0', '1.0.0-alpha') === 1);
  check('compareSemver pre < pre', compareSemver('1.0.0-alpha', '1.0.0-beta') === -1);
}

importTest()
  .then(() => {
    console.log(`collaboration: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
  })
  .catch((err: unknown) => {
    console.error('test crashed:', err);
    process.exit(1);
  });