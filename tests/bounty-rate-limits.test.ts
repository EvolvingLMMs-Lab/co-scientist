/**
 * Bounty System — Rate Limit Tests
 *
 * Tests that the rate limiter handles the new bounty-related actions:
 * - bounty_submit: Max 5 submissions per agent per hour
 * - bounty_create: Max 5 bounties per user per hour
 */
import { describe, it, expect } from "vitest";

import { checkBountyRateLimit } from "@/lib/bounty-rate-limit";

describe("checkBountyRateLimit", () => {
  it("allows first submission", () => {
    const store = new Map<string, number[]>();
    const result = checkBountyRateLimit("agent-1", "bounty_submit", {
      store,
      now: () => Date.now(),
    });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4); // 5 max - 1 used
  });

  it("allows up to 5 submissions per hour", () => {
    const store = new Map<string, number[]>();
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      const result = checkBountyRateLimit("agent-1", "bounty_submit", {
        store,
        now: () => now,
      });
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks 6th submission within the hour", () => {
    const store = new Map<string, number[]>();
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      checkBountyRateLimit("agent-1", "bounty_submit", {
        store,
        now: () => now,
      });
    }

    const result = checkBountyRateLimit("agent-1", "bounty_submit", {
      store,
      now: () => now,
    });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("allows submissions again after window expires", () => {
    const store = new Map<string, number[]>();
    const baseTime = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;

    // Fill up the limit
    for (let i = 0; i < 5; i++) {
      checkBountyRateLimit("agent-1", "bounty_submit", {
        store,
        now: () => baseTime,
      });
    }

    // Move past the window
    const result = checkBountyRateLimit("agent-1", "bounty_submit", {
      store,
      now: () => baseTime + ONE_HOUR_MS + 1,
    });
    expect(result.allowed).toBe(true);
  });

  it("tracks different agents independently", () => {
    const store = new Map<string, number[]>();
    const now = Date.now();

    // Fill agent-1's limit
    for (let i = 0; i < 5; i++) {
      checkBountyRateLimit("agent-1", "bounty_submit", {
        store,
        now: () => now,
      });
    }

    // agent-2 should still be allowed
    const result = checkBountyRateLimit("agent-2", "bounty_submit", {
      store,
      now: () => now,
    });
    expect(result.allowed).toBe(true);
  });

  it("allows up to 5 bounty creations per hour", () => {
    const store = new Map<string, number[]>();
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      const result = checkBountyRateLimit("user-1", "bounty_create", {
        store,
        now: () => now,
      });
      expect(result.allowed).toBe(true);
    }

    const blocked = checkBountyRateLimit("user-1", "bounty_create", {
      store,
      now: () => now,
    });
    expect(blocked.allowed).toBe(false);
  });

  it("returns correct limit value for bounty_submit", () => {
    const store = new Map<string, number[]>();
    const result = checkBountyRateLimit("agent-1", "bounty_submit", {
      store,
      now: () => Date.now(),
    });
    expect(result.limit).toBe(5);
  });

  it("returns correct limit value for bounty_create", () => {
    const store = new Map<string, number[]>();
    const result = checkBountyRateLimit("user-1", "bounty_create", {
      store,
      now: () => Date.now(),
    });
    expect(result.limit).toBe(5);
  });

  it("returns a resetAt timestamp in the future", () => {
    const store = new Map<string, number[]>();
    const now = Date.now();
    const result = checkBountyRateLimit("agent-1", "bounty_submit", {
      store,
      now: () => now,
    });
    expect(result.resetAt).toBeGreaterThan(Math.floor(now / 1000));
  });
});
