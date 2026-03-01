type BountyRateLimitAction = "bounty_submit" | "bounty_create";

interface BountyRateLimitDependencies {
  store?: Map<string, number[]>;
  now?: () => number;
}

export interface BountyRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

const BOUNTY_LIMITS: Record<BountyRateLimitAction, number> = {
  bounty_submit: 5,
  bounty_create: 5,
};

const defaultStore = new Map<string, number[]>();

function getBucketKey(id: string, action: BountyRateLimitAction): string {
  return `${id}:${action}`;
}

function pruneExpired(timestamps: number[], cutoff: number): number[] {
  let i = 0;
  while (i < timestamps.length && timestamps[i] <= cutoff) {
    i++;
  }
  if (i > 0) {
    timestamps.splice(0, i);
  }
  return timestamps;
}

export function checkBountyRateLimit(
  entityId: string,
  action: BountyRateLimitAction,
  deps: BountyRateLimitDependencies = {},
): BountyRateLimitResult {
  const now = deps.now?.() ?? Date.now();
  const store = deps.store ?? defaultStore;
  const limit = BOUNTY_LIMITS[action];

  const key = getBucketKey(entityId, action);
  const existing = store.get(key) ?? [];
  const live = pruneExpired(existing, now - ONE_HOUR_MS);

  if (live.length >= limit) {
    const oldest = live[0] ?? now;
    const resetAt = Math.ceil((oldest + ONE_HOUR_MS) / 1000);
    store.set(key, live);
    return { allowed: false, remaining: 0, resetAt, limit };
  }

  live.push(now);
  store.set(key, live);

  const resetAt = Math.ceil(((live[0] ?? now) + ONE_HOUR_MS) / 1000);
  const remaining = Math.max(0, limit - live.length);

  return { allowed: true, remaining, resetAt, limit };
}
