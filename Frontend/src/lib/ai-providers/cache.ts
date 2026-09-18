import { createHash } from "crypto";

/**
 * Lightweight in-memory cache + in-flight request de-duplication for LLM calls.
 *
 * Two things this protects against:
 *  1. Two identical prompts fired at (almost) the same time — e.g. a double-submit,
 *     a React effect re-run, or a retried background job — result in ONE network call,
 *     not two. The second caller just waits on the first call's promise.
 *  2. The exact same prompt repeated within a short window (default 10 minutes) is
 *     served from memory instead of re-billed/re-latencied against the provider.
 *
 * Scope/limits (intentionally simple, not a distributed cache):
 *  - Lives in the Node.js process's memory only. On Vercel/serverless this resets on
 *    cold starts, so it mainly helps warm-instance bursts and local development —
 *    it is a safety net on top of already-efficient call sites, not a replacement for
 *    the app's existing dedup logic (e.g. resume SHA-256 hashing, cached interview
 *    questions in Postgres).
 *  - Caching is keyed on (provider name + exact prompt text), so any change in prompt
 *    content (different resume, different answer, etc.) is always a cache miss.
 *
 * Toggle via .env.local:
 *   AI_CACHE_ENABLED=false   to disable entirely (default: enabled)
 *   AI_CACHE_TTL_MS=600000   to change the cache lifetime in ms (default: 10 minutes)
 */

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const responseCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<string>>();

function isCacheEnabled(): boolean {
  return process.env.AI_CACHE_ENABLED !== "false";
}

function getCacheTtlMs(): number {
  const configured = Number(process.env.AI_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 10 * 60 * 1000;
}

function buildCacheKey(providerName: string, prompt: string): string {
  return createHash("sha256").update(`${providerName}::${prompt}`).digest("hex");
}

/**
 * Run `call` with caching + in-flight de-duplication applied.
 * Pass the provider name (for cache-key namespacing) and the exact prompt string.
 */
export async function withAICache(
  providerName: string,
  prompt: string,
  call: () => Promise<string>
): Promise<string> {
  if (!isCacheEnabled()) {
    return call();
  }

  const key = buildCacheKey(providerName, prompt);
  const now = Date.now();

  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing;
  }

  const promise = call()
    .then((value) => {
      responseCache.set(key, { value, expiresAt: Date.now() + getCacheTtlMs() });
      inFlightRequests.delete(key);
      return value;
    })
    .catch((err) => {
      inFlightRequests.delete(key);
      throw err;
    });

  inFlightRequests.set(key, promise);
  return promise;
}
