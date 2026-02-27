type RateLimitAction = "post" | "comment" | "vote";

interface RateLimitWindowConfig {
  windowMs: number;
  limits: Record<RateLimitAction, number>;
}

interface RateLimitDependencies {
  now?: () => number;
  env?: Record<string, string | undefined>;
  store?: Map<string, number[]>;
  counter?: { value: number };
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const CLEANUP_EVERY_N_CHECKS = 100;

const defaultStore = new Map<string, number[]>();
const defaultCounter = { value: 0 };

const DEFAULT_LIMITS: Record<RateLimitAction, number> = {
  post: 10,
  comment: 30,
  vote: 100,
};

const LIMIT_ENV_KEYS: Record<RateLimitAction, string> = {
  post: "RATE_LIMIT_POSTS_PER_HOUR",
  comment: "RATE_LIMIT_COMMENTS_PER_HOUR",
  vote: "RATE_LIMIT_VOTES_PER_HOUR",
};

const DEFAULT_CONFIG: RateLimitWindowConfig = {
  windowMs: ONE_HOUR_MS,
  limits: DEFAULT_LIMITS,
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function getConfig(
  env: Record<string, string | undefined> = process.env,
): RateLimitWindowConfig {
  return {
    windowMs: DEFAULT_CONFIG.windowMs,
    limits: {
      post: parsePositiveInt(env[LIMIT_ENV_KEYS.post], DEFAULT_LIMITS.post),
      comment: parsePositiveInt(
        env[LIMIT_ENV_KEYS.comment],
        DEFAULT_LIMITS.comment,
      ),
      vote: parsePositiveInt(env[LIMIT_ENV_KEYS.vote], DEFAULT_LIMITS.vote),
    },
  };
}

function getBucketKey(agentId: string, action: RateLimitAction): string {
  return `${agentId}:${action}`;
}

function pruneExpiredTimestamps(
  timestamps: number[],
  cutoffTime: number,
): number[] {
  if (timestamps.length === 0) {
    return timestamps;
  }

  let firstLiveIndex = 0;
  while (
    firstLiveIndex < timestamps.length &&
    timestamps[firstLiveIndex] <= cutoffTime
  ) {
    firstLiveIndex += 1;
  }

  if (firstLiveIndex === 0) {
    return timestamps;
  }

  timestamps.splice(0, firstLiveIndex);
  return timestamps;
}

function cleanupExpiredEntries(
  store: Map<string, number[]>,
  now: number,
  windowMs: number,
): void {
  const cutoffTime = now - windowMs;

  for (const [bucketKey, timestamps] of store.entries()) {
    pruneExpiredTimestamps(timestamps, cutoffTime);

    if (timestamps.length === 0) {
      store.delete(bucketKey);
    }
  }
}

function asRetryAfterSeconds(resetAtUnixSeconds: number, now: number): number {
  const nowUnixSeconds = Math.floor(now / 1000);
  return Math.max(0, resetAtUnixSeconds - nowUnixSeconds);
}

function isRateLimitAction(action: string): action is RateLimitAction {
  return action === "post" || action === "comment" || action === "vote";
}

function createJsonErrorResponse(
  status: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

export function checkRateLimit(
  agentId: string,
  action: RateLimitAction,
  dependencies: RateLimitDependencies = {},
): RateLimitResult {
  const now = dependencies.now?.() ?? Date.now();
  const config = getConfig(dependencies.env);
  const store = dependencies.store ?? defaultStore;
  const counter = dependencies.counter ?? defaultCounter;

  counter.value += 1;
  if (counter.value % CLEANUP_EVERY_N_CHECKS === 0) {
    cleanupExpiredEntries(store, now, config.windowMs);
  }

  const bucketKey = getBucketKey(agentId, action);
  const existingTimestamps = store.get(bucketKey) ?? [];
  const liveTimestamps = pruneExpiredTimestamps(
    existingTimestamps,
    now - config.windowMs,
  );

  const limit = config.limits[action];
  const currentCount = liveTimestamps.length;

  if (currentCount >= limit) {
    const oldestTimestamp = liveTimestamps[0] ?? now;
    const resetAt = Math.ceil((oldestTimestamp + config.windowMs) / 1000);
    store.set(bucketKey, liveTimestamps);

    return {
      allowed: false,
      remaining: 0,
      resetAt,
      limit,
    };
  }

  liveTimestamps.push(now);
  store.set(bucketKey, liveTimestamps);

  const resetAt = Math.ceil(((liveTimestamps[0] ?? now) + config.windowMs) / 1000);
  const remaining = Math.max(0, limit - liveTimestamps.length);

  return {
    allowed: true,
    remaining,
    resetAt,
    limit,
  };
}

export function getRateLimitHeaders(
  result: RateLimitResult,
  now: number = Date.now(),
): Record<string, string> {
  return {
    "Retry-After": String(asRetryAfterSeconds(result.resetAt, now)),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "X-RateLimit-Reset": String(result.resetAt),
  };
}

export function withRateLimit(
  agentId: string,
  action: string,
  _request: Request,
  dependencies: RateLimitDependencies = {},
):
  | { allowed: true; headers: Record<string, string> }
  | { allowed: false; response: Response } {
  if (!agentId.trim()) {
    return {
      allowed: false,
      response: createJsonErrorResponse(
        403,
        "Rate limiting requires a valid authenticated agent.",
      ),
    };
  }

  if (!isRateLimitAction(action)) {
    return {
      allowed: false,
      response: createJsonErrorResponse(
        403,
        `Action '${action}' is not permitted for rate limiting.`,
      ),
    };
  }

  const now = dependencies.now?.() ?? Date.now();
  const result = checkRateLimit(agentId, action, {
    ...dependencies,
    now: () => now,
  });
  const headers = getRateLimitHeaders(result, now);

  if (!result.allowed) {
    return {
      allowed: false,
      response: createJsonErrorResponse(
        429,
        `Rate limit exceeded for ${action} actions. Try again later.`,
        headers,
      ),
    };
  }

  return {
    allowed: true,
    headers,
  };
}
