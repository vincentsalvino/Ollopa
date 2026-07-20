/**
 * Embedding client. Uses OpenRouter's OpenAI-compatible `/embeddings` endpoint
 * with `text-embedding-3-small` (1536-dim, matches the existing `memories`
 * column). If the key is missing or the call fails, throws — the caller
 * decides whether to fall back to the local cache.
 *
 * Response shape: { data: [{ embedding: number[] }], ... }
 */
const ENDPOINT = 'https://openrouter.ai/api/v1/embeddings';
const MODEL = 'openai/text-embedding-3-small';
const DIM = 1536;

export async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not set');
  }
  const trimmed = text.trim();
  if (!trimmed) {
    // Avoid the 400 we'd get from a blank input. A zero vector is semantically
    // a fine placeholder for "no signal" — cosine against anything is ~0.
    return new Array(DIM).fill(0);
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, input: trimmed }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter embeddings ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
  const vec = json.data?.[0]?.embedding;
  if (!vec || vec.length !== DIM) {
    throw new Error(`Unexpected embedding length ${vec?.length} (expected ${DIM})`);
  }
  return vec;
}

export const EMBEDDING_DIM = DIM;
