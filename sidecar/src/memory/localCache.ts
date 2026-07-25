/**
 * Local SQLite cache for memories.
 *
 * Schema is a faithful subset of `public.memories` plus the embedding (stored
 * as JSON text for portability — we never use it in SQL, only in JS for
 * cosine scoring). The cache is the offline fallback when Supabase is
 * unreachable. Writes only — no migrations, no schema drift.
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let db: Database.Database | undefined;

export interface CachedMemory {
  id: string;
  title: string;
  content: string;
  scope: string;
  status: string;
  source: string;
  quality_score: number | null;
  performance_score: number | null;
  tags: string[];
  category: string | null;
  code_block: string | null;
  use_when: string[];
  avoid_when: string[];
  embedding: number[] | null;
  updated_at: string;
}

function dbPath(): string {
  const dir = path.join(os.homedir(), '.ollopa');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path.join(dir, 'memory_cache.db');
}

export function initLocalCache(): void {
  if (db) return;
  const p = dbPath();
  db = new Database(p);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      title TEXT,
      content TEXT,
      scope TEXT,
      status TEXT,
      source TEXT,
      quality_score REAL,
      performance_score REAL,
      tags TEXT,
      category TEXT,
      code_block TEXT,
      use_when TEXT,
      avoid_when TEXT,
      embedding TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
    CREATE TABLE IF NOT EXISTS mistakes (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      task_text TEXT,
      bad_diff TEXT,
      review_feedback TEXT,
      violated_principles TEXT,
      retry_count INTEGER,
      captured_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mistakes_task ON mistakes(task_id);
  `);
}

/** Get the live cache handle. Throws if `initLocalCache` has not run. */
export function getLocalCache(): {
  insertMistake: (m: import('./mistakeCapture').CapturedMistake) => void;
  listMistakes: () => import('./mistakeCapture').CapturedMistake[];
} {
  if (!db) throw new Error('local cache not initialised');
  return {
    insertMistake(m) {
      db!.prepare(`
        INSERT OR REPLACE INTO mistakes (
          id, task_id, task_text, bad_diff, review_feedback,
          violated_principles, retry_count, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        m.id,
        m.taskId,
        m.task,
        m.badDiff,
        m.reviewFeedback,
        JSON.stringify(m.violatedPrinciples ?? []),
        m.retryCount ?? 0,
        new Date(m.timestamp).toISOString(),
      );
    },
    listMistakes() {
      const rows = db!.prepare('SELECT * FROM mistakes').all() as Array<{
        id: string; task_id: string; task_text: string; bad_diff: string;
        review_feedback: string; violated_principles: string; retry_count: number; captured_at: string;
      }>;
      return rows.map((r) => ({
        id: r.id,
        taskId: r.task_id,
        task: r.task_text,
        badDiff: r.bad_diff,
        reviewFeedback: r.review_feedback,
        violatedPrinciples: safeParse(r.violated_principles) as never,
        retryCount: r.retry_count,
        timestamp: Date.parse(r.captured_at) || Date.now(),
        delivery: 'queued' as const,
      }));
    },
  };
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return []; }
}

export function isCacheReady(): boolean {
  return db !== undefined;
}

export function upsertMemories(memories: CachedMemory[]): void {
  if (!db) throw new Error('local cache not initialised');
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO memories (
      id, title, content, scope, status, source,
      quality_score, performance_score, tags, category,
      code_block, use_when, avoid_when, embedding, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  const txn = db.transaction((rows: CachedMemory[]) => {
    for (const m of rows) {
      stmt.run(
        m.id,
        m.title,
        m.content,
        m.scope,
        m.status,
        m.source,
        m.quality_score,
        m.performance_score,
        JSON.stringify(m.tags ?? []),
        m.category,
        m.code_block,
        JSON.stringify(m.use_when ?? []),
        JSON.stringify(m.avoid_when ?? []),
        m.embedding ? JSON.stringify(m.embedding) : null,
        m.updated_at ?? now,
      );
    }
  });
  txn(memories);
}

export function countMemories(): number {
  if (!db) return 0;
  const row = db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number };
  return row.n;
}

interface RawRow {
  id: string;
  title: string;
  content: string;
  scope: string;
  status: string;
  source: string;
  quality_score: number | null;
  performance_score: number | null;
  tags: string | null;
  category: string | null;
  code_block: string | null;
  use_when: string | null;
  avoid_when: string | null;
  embedding: string | null;
  updated_at: string;
}

function rowToMemory(r: RawRow): CachedMemory {
  return {
    id: r.id,
    title: r.title ?? '',
    content: r.content ?? '',
    scope: r.scope ?? 'general',
    status: r.status ?? 'Candidate',
    source: r.source ?? 'SEED',
    quality_score: r.quality_score,
    performance_score: r.performance_score,
    tags: parseJsonArray(r.tags),
    category: r.category,
    code_block: r.code_block,
    use_when: parseJsonArray(r.use_when),
    avoid_when: parseJsonArray(r.avoid_when),
    embedding: r.embedding ? safeParseNumbers(r.embedding) : null,
    updated_at: r.updated_at ?? '',
  };
}

function parseJsonArray(s: string | null): string[] {
  if (!s) return [];
  try { return JSON.parse(s); } catch { return []; }
}

function safeParseNumbers(s: string): number[] | null {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

/**
 * Cosine-similarity search across cached memories. Pulls only the rows
 * whose scope matches the request and ranks in JS. For the cache sizes we
 * expect (hundreds to low thousands) this is sub-millisecond.
 */
export function searchLocal(
  queryEmbedding: number[],
  scope: string,
  limit: number,
): CachedMemory[] {
  if (!db) return [];
  const rows = db
    .prepare('SELECT * FROM memories WHERE scope IN (?, ?) OR scope IS NULL')
    .all(scope, 'general') as RawRow[];

  const scored: Array<{ m: CachedMemory; score: number }> = [];
  for (const r of rows) {
    const m = rowToMemory(r);
    if (m.embedding && m.embedding.length === queryEmbedding.length) {
      const s = cosine(queryEmbedding, m.embedding);
      scored.push({ m, score: s });
    } else {
      // No embedding — give it a 0 so it still surfaces if we widen the limit.
      scored.push({ m, score: 0 });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.m);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
