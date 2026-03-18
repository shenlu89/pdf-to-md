const LRU = new Map<string, number[]>();

// Clean up old entries periodically to avoid memory leak
if (typeof setInterval !== "undefined") {
    setInterval(() => {
        const now = Date.now();
        for (const [key, timestamps] of LRU.entries()) {
            const valid = timestamps.filter(ts => now - ts < 60 * 60 * 1000);
            if (valid.length === 0) {
                LRU.delete(key);
            } else {
                LRU.set(key, valid);
            }
        }
    }, 5 * 60 * 1000); // Every 5 minutes
}

export function checkRateLimit(key: string, options: { limit?: number; windowMs?: number } = {}): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const limit = options.limit || 10;
  const windowMs = options.windowMs || 60 * 60 * 1000; // 1 hour
  
  const now = Date.now();
  const timestamps = LRU.get(key) || [];
  
  // Filter out old timestamps
  const validTimestamps = timestamps.filter(ts => now - ts < windowMs);
  
  if (validTimestamps.length >= limit) {
      const oldest = validTimestamps[0];
      const resetAt = oldest + windowMs;
      return { allowed: false, remaining: 0, resetAt };
  }
  
  validTimestamps.push(now);
  LRU.set(key, validTimestamps);
  
  return {
      allowed: true,
      remaining: limit - validTimestamps.length,
      resetAt: now + windowMs
  };
}

export function getClientId(req: Request): string {
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0] : "anonymous";
    return ip;
}
