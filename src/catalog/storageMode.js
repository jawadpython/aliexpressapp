/**
 * Upstash Redis (Vercel “Redis” integration) — required on Vercel; local dev uses data/*.json.
 * Env: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (auto-added when you connect Redis in Vercel).
 */
export function useRedis() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  );
}

export function vercelStorageHint() {
  if (process.env.VERCEL && !useRedis()) {
    return "Add Upstash Redis from Vercel Marketplace and link it (UPSTASH_REDIS_REST_* env vars).";
  }
  return null;
}
