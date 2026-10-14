interface Bucket {
  count: number;
  suppressed: number;
  resetAt: number;
  timer?: NodeJS.Timeout;
}

// Lets the first `limit` lines per key through each window and counts the rest,
// then reports how many were held back once the window ends. The count matters:
// a flood that simply goes quiet in the log reads as no flood at all.
//
// The key space is capped so that what a sender controls cannot grow the map
// without bound; keys past the cap share one bucket.
export function createLogThrottle(options: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  onSuppressed: (key: string, count: number) => void;
}) {
  const { limit, windowMs, maxKeys = 64, onSuppressed } = options;
  const buckets = new Map<string, Bucket>();

  function flush(key: string) {
    const bucket = buckets.get(key);
    if (!bucket) return;
    clearTimeout(bucket.timer);
    buckets.delete(key);
    if (bucket.suppressed > 0) onSuppressed(key, bucket.suppressed);
  }

  return {
    allow(requested: string): boolean {
      const now = Date.now();
      const key =
        buckets.has(requested) || buckets.size < maxKeys ? requested : "other";

      const existing = buckets.get(key);
      if (existing && now >= existing.resetAt) flush(key);

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { count: 0, suppressed: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }

      if (bucket.count < limit) {
        bucket.count += 1;
        return true;
      }

      bucket.suppressed += 1;
      if (!bucket.timer) {
        // Without this, a flood that stops would never have its total reported.
        // unref so a pending report never keeps the process alive.
        bucket.timer = setTimeout(() => flush(key), bucket.resetAt - now);
        bucket.timer.unref();
      }
      return false;
    },
  };
}
