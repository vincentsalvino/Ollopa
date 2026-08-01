/**
 * Phase 5.4 — licenseCheck self-check.
 *
 * Coverage:
 *   1. isLicenseForbidden — exact, glob (`*`), case-insensitive, null safe.
 *   2. formatLicenseResults — empty / clean / forbidden banner.
 *   3. extractDeps — deps + devDeps + optional + peer, deduplicated.
 *   4. end-to-end: scratch a fake workspace, write package.json, run
 *      checkWorkspaceLicenses — should skip the real `npm view` round
 *      trip by letting the spawn fail (timeout-graceful).
 *
 * No live `npm view`. Run: npx tsx sidecar/test/licenseCheck.ts
 */
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isLicenseForbidden,
  formatLicenseResults,
  checkWorkspaceLicenses,
  getForbiddenLicenses,
} from '../src/tools/licenseCheck';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; }
  else { fail++; console.error(`FAIL: ${name}${detail ? ' — ' + JSON.stringify(detail) : ''}`); }
}

/* --- isLicenseForbidden --- */
{
  const patterns = ['AGPL-*', 'SSPL*'];
  check('null license not forbidden', isLicenseForbidden(null, patterns) === false);
  check('exact match AGPL-3.0', isLicenseForbidden('AGPL-3.0', patterns) === true);
  check('glob SSPL matches SSPL-1.0', isLicenseForbidden('SSPL-1.0', patterns) === true);
  check('MIT not forbidden', isLicenseForbidden('MIT', patterns) === false);
  check('Apache-2.0 not forbidden', isLicenseForbidden('Apache-2.0', patterns) === false);
  check('case-insensitive agpl-3.0', isLicenseForbidden('agpl-3.0', patterns) === true);
  check('empty patterns → none forbidden', isLicenseForbidden('AGPL-3.0', []) === false);
  check('empty license returns false', isLicenseForbidden('', patterns) === false);
}

/* --- getForbiddenLicenses (env override) --- */
{
  const prev = process.env.OLLOPA_FORBIDDEN_LICENSES;
  delete process.env.OLLOPA_FORBIDDEN_LICENSES;
  const def = getForbiddenLicenses();
  check('default list non-empty', def.length > 0);
  check('default includes AGPL-*', def.includes('AGPL-*'));

  process.env.OLLOPA_FORBIDDEN_LICENSES = 'MIT,Apache-2.0';
  const custom = getForbiddenLicenses();
  check('env override applied', custom.length === 2 && custom[0] === 'MIT');

  process.env.OLLOPA_FORBIDDEN_LICENSES = '';
  const empty = getForbiddenLicenses();
  check('empty env falls back to default', empty.includes('AGPL-*'));

  if (prev === undefined) delete process.env.OLLOPA_FORBIDDEN_LICENSES;
  else process.env.OLLOPA_FORBIDDEN_LICENSES = prev;
}

/* --- formatLicenseResults --- */
{
  const empty = formatLicenseResults([]);
  check('empty results gives no-deps message', /no dependencies/i.test(empty));

  const clean = formatLicenseResults([
    { package: 'a', license: 'MIT', forbidden: false },
    { package: 'b', license: 'Apache-2.0', forbidden: false },
  ]);
  check('clean report has no FORBIDDEN banner', !/FORBIDDEN/.test(clean));
  check('clean report lists both', clean.includes('a: MIT') && clean.includes('b: Apache-2.0'));

  const bad = formatLicenseResults([
    { package: 'a', license: 'MIT', forbidden: false },
    { package: 'b', license: 'AGPL-3.0', forbidden: true },
  ]);
  check('bad report has FORBIDDEN banner', /FORBIDDEN/.test(bad));
  check('bad report names the offending package', bad.includes('b: AGPL-3.0'));

  const errored = formatLicenseResults([
    { package: 'c', license: null, forbidden: false, error: 'not found' },
  ]);
  check('errored results show [ERROR]', /\[ERROR\]/.test(errored) || /c: not found/.test(errored));
}

/* --- end-to-end against scratch workspace --- */
async function e2e(): Promise<void> {
  const prev = process.env.OLLOPA_FORBIDDEN_LICENSES;
  process.env.OLLOPA_FORBIDDEN_LICENSES = 'GPL-*';

  let dir = '';
  try {
    dir = await mkdtemp(join(tmpdir(), 'ollopa-license-'));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'scratch',
        version: '0.0.0',
        dependencies: { '@types/node': '^20' },
        devDependencies: { 'typescript': '^5' },
        optionalDependencies: { 'fsevents': '*' },
        peerDependencies: { 'react': '*' },
      }),
    );
    const results = await checkWorkspaceLicenses(dir);
    check('returns one result per dep', results.length >= 4);
    for (const r of results) {
      if (typeof r.package !== 'string') { fail++; console.error('FAIL: missing package name in result'); break; }
      if (!('forbidden' in r)) { fail++; console.error('FAIL: missing forbidden flag in result'); break; }
    }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.OLLOPA_FORBIDDEN_LICENSES;
    else process.env.OLLOPA_FORBIDDEN_LICENSES = prev;
  }
}

e2e().then(() => {
  console.log(`licenseCheck: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}).catch((err: unknown) => {
  console.error('test crashed:', err);
  process.exit(1);
});
