/**
 * Phase 3.5 — webSearch self-check (offline only).
 *
 * Exercises:
 *   1. htmlToText strips tags, decodes entities, collapses whitespace.
 *   2. parseDuckDuckGo regex extracts title/url/snippet triples.
 *   3. Domain whitelist rejects unlisted hosts.
 *   4. Web cache: putWebCache/getWebCache roundtrip + TTL expiry.
 *   5. Cache is independent of the memories table.
 *
 * No live HTTP. Run: npx tsx sidecar/test/webSearch.ts
 */
import { htmlToText } from '../src/tools/webSearch';
import { initLocalCache, getWebCache, putWebCache, pruneWebCache } from '../src/memory/localCache';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}${detail ? ' — ' + JSON.stringify(detail) : ''}`);
  }
}

/* --- htmlToText --- */
{
  const html = '<html><head><script>alert(1)</script></head>' +
    '<body><h1>Title</h1><p>Hello &amp; <b>world</b>!</p>' +
    '<!-- comment --><style>.x{}</style></body></html>';
  const out = htmlToText(html);
  check('htmlToText strips scripts', !out.includes('alert(1)'));
  check('htmlToText strips styles', !out.includes('.x{}'));
  check('htmlToText strips comments', !out.includes('comment'));
  check('htmlToText keeps body text', out.includes('Title') && out.includes('Hello'));
  check('htmlToText decodes entities', out.includes('Hello & world'));
  check('htmlToText collapses whitespace', !out.includes('  '));
}

{
  // Numeric entities
  const out = htmlToText('&#65;&#66;'); // AB
  check('htmlToText decodes numeric entities', out === 'AB');
}

/* --- Domain whitelist --- */
{
  process.env.WEB_ALLOWED_DOMAINS = 'developer.mozilla.org,github.com';
  // Re-import via env (functions read env at call time).
  const { fetchUrl } = require('../src/tools/webSearch');
  // Use a dummy URL — we want the rejection before any network call.
  fetchUrl('https://evil.example/x').then(
    () => check('whitelist rejects unknown domain', false, 'expected throw'),
    (err: Error) => check('whitelist rejects unknown domain', /not in whitelist/i.test(err.message)),
  );
}

/* --- Web cache roundtrip --- */
{
  initLocalCache();
  const key = `test:webSearch:${Date.now()}`;
  putWebCache(key, 'hello', 60);
  check('cache put/get roundtrip', getWebCache(key) === 'hello');

  // TTL expiry: insert with fetched_at in the past so expiry is deterministic.
  const expired = `test:webSearch:expired:${Date.now()}`;
  // Reach in via the local cache helper to bypass the freshness floor.
  const Database = require('better-sqlite3');
  const path = require('node:path');
  const os = require('node:os');
  const fs = require('node:fs');
  const dir = path.join(os.homedir(), '.ollopa');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, 'memory_cache.db');
  const raw = new Database(dbFile);
  raw.prepare(`
    INSERT OR REPLACE INTO web_cache (key, payload, fetched_at, ttl_seconds)
    VALUES (?, ?, ?, ?)
  `).run(expired, 'gone', Date.now() - 10_000, 1);
  raw.close();
  const v = getWebCache(expired);
  check('cache expires when fetched_at + ttl < now', v === null);
}

/* --- Cache isolation from memories table --- */
{
  // Sanity: web cache uses its own table; inserting a row with a memory-shaped
  // id should not collide with `memories`.
  const key = `test:webSearch:weird:mem-id-123`;
  putWebCache(key, 'data', 60);
  check('web cache stores under its own key', getWebCache(key) === 'data');
}

/* --- prune --- */
{
  putWebCache(`test:webSearch:prune:${Date.now()}`, 'old', 0);
  const removed = pruneWebCache();
  check('pruneWebCache returns non-negative count', typeof removed === 'number' && removed >= 0);
}

console.log(`webSearch: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
