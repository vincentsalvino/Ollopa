/**
 * Phase 3 — outbound web search + fetch + HTML strip.
 *
 * Sidecar-side. Three concerns:
 *   1. `search(query, limit)` — query a backend, return top results.
 *   2. `fetchUrl(url, maxBytes)` — GET a URL, strip HTML to text.
 *   3. `lookupApi(library, method)` / `lookupExample(library, method)` —
 *      thin wrappers that compose search + fetch.
 *
 * Default backend: DuckDuckGo HTML (no API key). Backends are pluggable
 * via `getBackend()` — add `bing`/`google` later behind the same shape.
 *
 * Domain whitelist: enforced in `fetchUrl`. Default list is the typical
 * dev-doc sites. Configurable via `WEB_ALLOWED_DOMAINS` env (comma-sep).
 *
 * Ponytail: no npm dep. Node 20 fetch + a tiny HTML stripper. If we grow
 * past 5 backends or need XPath, swap in `cheerio`.
 */
import { getWebCache, putWebCache } from '../memory/localCache';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchBackend {
  readonly name: string;
  search(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]>;
}

/* -------------------------------------------------------------------------- */
/*  Backend registry                                                          */
/* -------------------------------------------------------------------------- */

const BACKENDS: Record<string, SearchBackend> = {
  duckduckgo: {
    name: 'duckduckgo',
    async search(query, limit, signal) {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetchWithTimeout(url, { signal }, 10_000);
      if (!res.ok) throw new Error(`duckduckgo HTTP ${res.status}`);
      const html = await res.text();
      return parseDuckDuckGo(html, limit);
    },
  },
};

export function getBackend(name: string | undefined): SearchBackend {
  const choice = name ?? process.env.OLLOPA_SEARCH_BACKEND ?? 'duckduckgo';
  const b = BACKENDS[choice];
  if (!b) throw new Error(`unknown search backend: ${choice}`);
  return b;
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;       // 1 day for search results
const URL_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 1 week for raw URLs
const DEFAULT_FETCH_MAX = 50 * 1024;            // 50KB

export async function search(
  query: string,
  limit = 5,
  backendName?: string,
): Promise<SearchResult[]> {
  const cacheKey = `search:${backendName ?? 'default'}:${query.toLowerCase().trim()}:${limit}`;
  const hit = getWebCache(cacheKey);
  if (hit) {
    try { return JSON.parse(hit) as SearchResult[]; } catch { /* corrupt — fall through */ }
  }
  const backend = getBackend(backendName);
  const results = await backend.search(query, limit);
  putWebCache(cacheKey, JSON.stringify(results), DEFAULT_TTL_SECONDS);
  return results;
}

export async function fetchUrl(url: string, maxBytes = DEFAULT_FETCH_MAX): Promise<string> {
  const allowed = getAllowedDomains();
  const host = safeHost(url);
  if (!host) throw new Error(`invalid URL: ${url}`);
  if (!allowed.has(host) && !allowed.has('*')) {
    throw new Error(`domain not in whitelist: ${host} (set WEB_ALLOWED_DOMAINS=* to allow all)`);
  }
  const cacheKey = `url:${url}`;
  const hit = getWebCache(cacheKey);
  if (hit) return hit;
  const res = await fetchWithTimeout(url, {}, 15_000);
  if (!res.ok) throw new Error(`fetch HTTP ${res.status} for ${url}`);
  const raw = await res.text();
  const text = htmlToText(raw).slice(0, maxBytes);
  putWebCache(cacheKey, text, URL_CACHE_TTL_SECONDS);
  return text;
}

export async function lookupApi(library: string, method: string): Promise<string> {
  // Ponytail: build a targeted query. No devdocs API — SERP scraping is
  // a reasonable stub. Replace with a real API client when we add one.
  const q = `${library} ${method} signature site:devdocs.io OR site:developer.mozilla.org`;
  const results = await search(q, 3);
  if (results.length === 0) return '(no results)';
  // Fetch the top result for richer context.
  try {
    const body = await fetchUrl(results[0].url, 16 * 1024);
    return body.slice(0, 4000);
  } catch {
    return results.map((r) => `- ${r.title}\n  ${r.url}\n  ${r.snippet}`).join('\n');
  }
}

export async function lookupExample(library: string, method: string): Promise<string> {
  const q = `${library} ${method} example github OR site:stackoverflow.com`;
  return search(q, 5).then((rs) =>
    rs.length === 0
      ? '(no results)'
      : rs.map((r) => `- ${r.title}\n  ${r.url}\n  ${r.snippet}`).join('\n'),
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: init.signal ?? ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function safeHost(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.host.toLowerCase();
  } catch {
    return null;
  }
}

function getAllowedDomains(): Set<string> {
  const fromEnv = process.env.WEB_ALLOWED_DOMAINS;
  if (!fromEnv) {
    return new Set([
      'developer.mozilla.org',
      'nodejs.org',
      'devdocs.io',
      'github.com',
      'stackoverflow.com',
      'wikipedia.org',
    ]);
  }
  if (fromEnv.trim() === '*') return new Set(['*']);
  return new Set(fromEnv.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean));
}

/* -------------------------------------------------------------------------- */
/*  HTML stripper — tiny, no dep                                              */
/* -------------------------------------------------------------------------- */

/**
 * Strip HTML tags and decode the most common entities. We deliberately
 * keep this dumb: dev docs are mostly text. If a page needs Markdown
 * export, swap in `turndown` later.
 */
export function htmlToText(html: string): string {
  // Remove scripts, styles, comments.
  let s = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  // Drop tags but keep their text content.
  s = s.replace(/<[^>]+>/g, ' ');
  // Decode common entities.
  s = s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  // Numeric entities.
  s = s.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
  // Collapse whitespace.
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

/* -------------------------------------------------------------------------- */
/*  DuckDuckGo HTML scraper                                                   */
/* -------------------------------------------------------------------------- */

function parseDuckDuckGo(html: string, limit: number): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  // DDG HTML result blocks: each has a `.result__a` link with title and
  // a `.result__snippet` for the snippet. Attributes, not text, so the
  // regex is brittle but works for the current HTML layout.
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  const titles: string[] = [];
  const urls: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && urls.length < limit) {
    const href = cleanDdgHref(m[1]);
    const title = stripTags(m[2]);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    urls.push(href);
    titles.push(title);
  }
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) && snippets.length < limit) {
    snippets.push(stripTags(m[1]));
  }
  for (let i = 0; i < urls.length; i++) {
    out.push({
      title: titles[i] ?? '(no title)',
      url: urls[i],
      snippet: snippets[i] ?? '',
    });
  }
  return out;
}

function cleanDdgHref(href: string): string {
  // DDG wraps links in a redirector like //duckduckgo.com/l/?uddg=https%3A%2F%2F...
  if (href.startsWith('//duckduckgo.com/l/?') || href.startsWith('https://duckduckgo.com/l/?') || href.startsWith('http://duckduckgo.com/l/?')) {
    try {
      const u = new URL(href.startsWith('//') ? `https:${href}` : href);
      const uddg = u.searchParams.get('uddg');
      if (uddg) return uddg;
    } catch { /* fall through */ }
  }
  return href;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}
