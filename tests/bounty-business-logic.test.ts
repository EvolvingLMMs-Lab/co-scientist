/**
 * Bounty System — Business Logic Tests
 *
 * Tests the core business logic functions without database dependencies:
 * - Escrow calculations (platform fee, agent payout)
 * - Reputation computation (trust tier, acceptance rate)
 * - Bounty status transitions
 * - Reward display formatting
 * - Deadline/expiry logic
 * - Self-dealing detection
 */
import { describe, it, expect } from "vitest";

import {
  computePlatformFee,
  computeAgentPayout,
  formatRewardDisplay,
  computeTrustTier,
  computeAcceptanceRate,
  isBountyExpired,
  canTransitionStatus,
  validateSelfDealingCheck,
  PLATFORM_FEE_RATE,
  BOUNTY_STATUS_TRANSITIONS,
} from "@/lib/bounty-logic";

// ============================================================
// Fee Calculations
// ============================================================
describe("computePlatformFee", () => {
  it("computes 10% fee on standard bounty", () => {
    expect(computePlatformFee(10000)).toBe(1000);
  });

  it("computes fee on minimum bounty (1 credit)", () => {
    // 10% of 1 = 0.1 -> floor to 0
    expect(computePlatformFee(1)).toBe(0);
  });

  it("computes fee on small bounty (100 credits = $1)", () => {
    expect(computePlatformFee(100)).toBe(10);
  });

  it("computes fee on large bounty (100000 credits = $1000)", () => {
    expect(computePlatformFee(100000)).toBe(10000);
  });

  it("always returns an integer (floors fractional credits)", () => {
    // 10% of 33 = 3.3 -> floor to 3
    expect(computePlatformFee(33)).toBe(3);
    expect(Number.isInteger(computePlatformFee(33))).toBe(true);
  });

  it("fee is never negative", () => {
    expect(computePlatformFee(0)).toBe(0);
  });
});

describe("computeAgentPayout", () => {
  it("payout = reward - fee", () => {
    expect(computeAgentPayout(10000)).toBe(9000);
  });

  it("agent gets full amount when fee rounds to 0", () => {
    expect(computeAgentPayout(1)).toBe(1);
  });

  it("payout + fee = reward (no credits lost)", () => {
    const reward = 7777;
    const fee = computePlatformFee(reward);
    const payout = computeAgentPayout(reward);
    expect(fee + payout).toBe(reward);
  });

  it("payout is always non-negative", () => {
    expect(computeAgentPayout(0)).toBeGreaterThanOrEqual(0);
  });
});

describe("PLATFORM_FEE_RATE", () => {
  it("is 0.10 (10%)", () => {
    expect(PLATFORM_FEE_RATE).toBe(0.1);
  });
});

// ============================================================
// Reward Display
// ============================================================
describe("formatRewardDisplay", () => {
  it("formats credits as USD with 2 decimal places", () => {
    expect(formatRewardDisplay(10000)).toBe("$100.00");
  });

  it("formats 1 credit as $0.01", () => {
    expect(formatRewardDisplay(1)).toBe("$0.01");
  });

  it("formats 100 credits as $1.00", () => {
    expect(formatRewardDisplay(100)).toBe("$1.00");
  });

  it("formats 0 credits as $0.00", () => {
    expect(formatRewardDisplay(0)).toBe("$0.00");
  });

  it("formats large amounts with commas", () => {
    // 1,000,000 credits = $10,000.00
    const result = formatRewardDisplay(1000000);
    expect(result).toBe("$10,000.00");
  });
});

// ============================================================
// Trust Tier Computation
// ============================================================
describe("computeTrustTier", () => {
  it("returns 'new' for agent with no completions", () => {
    expect(
      computeTrustTier({
        tasksCompleted: 0,
        tasksSubmitted: 0,
        averageQuality: null,
      }),
    ).toBe("new");
  });

  it("returns 'new' for agent with < 5 completions", () => {
    expect(
      computeTrustTier({
        tasksCompleted: 4,
        tasksSubmitted: 5,
        averageQuality: 5.0,
      }),
    ).toBe("new");
  });

  it("returns 'active' for agent with 5+ completions", () => {
    expect(
      computeTrustTier({
        tasksCompleted: 5,
        tasksSubmitted: 7,
        averageQuality: 3.0,
      }),
    ).toBe("active");
  });

  it("returns 'trusted' for agent with 20+ completions and >75% acceptance and quality >= 3.8", () => {
    expect(
      computeTrustTier({
        tasksCompleted: 20,
        tasksSubmitted: 25,
        averageQuality: 3.8,
      }),
    ).toBe("trusted");
  });

  it("returns 'expert' for agent with 50+ completions and >85% acceptance and quality >= 4.2", () => {
    expect(
      computeTrustTier({
        tasksCompleted: 50,
        tasksSubmitted: 55,
        averageQuality: 4.2,
      }),
    ).toBe("expert");
  });

  it("does not return 'expert' if quality is below 4.2", () => {
    expect(
      computeTrustTier({
        tasksCompleted: 60,
        tasksSubmitted: 65,
        averageQuality: 4.1,
      }),
    ).not.toBe("expert");
  });

  it("does not return 'trusted' if acceptance rate is below 75%", () => {
    expect(
      computeTrustTier({
        tasksCompleted: 20,
        tasksSubmitted: 30, // 66% acceptance
        averageQuality: 4.5,
      }),
    ).not.toBe("trusted");
  });

  // 'verified' is never computed — it's manually set by admins
  it("never returns 'verified' from computation", () => {
    expect(
      computeTrustTier({
        tasksCompleted: 1000,
        tasksSubmitted: 1000,
        averageQuality: 5.0,
      }),
    ).not.toBe("verified");
  });
});

describe("computeAcceptanceRate", () => {
  it("returns 0 when no submissions", () => {
    expect(computeAcceptanceRate(0, 0)).toBe(0);
  });

  it("returns 1.0 for perfect acceptance", () => {
    expect(computeAcceptanceRate(10, 10)).toBe(1.0);
  });

  it("computes correct rate", () => {
    expect(computeAcceptanceRate(3, 4)).toBe(0.75);
  });

  it("handles edge case of 1 completed out of many", () => {
    expect(computeAcceptanceRate(1, 100)).toBe(0.01);
  });
});

// ============================================================
// Deadline / Expiry Logic
// ============================================================
describe("isBountyExpired", () => {
  it("returns false when deadline is in the future", () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    expect(isBountyExpired(futureDeadline)).toBe(false);
  });

  it("returns true when deadline is in the past", () => {
    const pastDeadline = Math.floor(Date.now() / 1000) - 1;
    expect(isBountyExpired(pastDeadline)).toBe(true);
  });

  it("returns true when deadline is exactly now", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isBountyExpired(now, now)).toBe(true);
  });

  it("accepts optional 'now' parameter for testing", () => {
    const deadline = 1000000;
    expect(isBountyExpired(deadline, 999999)).toBe(false);
    expect(isBountyExpired(deadline, 1000001)).toBe(true);
  });
});

// ============================================================
// Status Transitions
// ============================================================
describe("canTransitionStatus", () => {
  it("allows open -> awarded", () => {
    expect(canTransitionStatus("open", "awarded")).toBe(true);
  });

  it("allows open -> expired", () => {
    expect(canTransitionStatus("open", "expired")).toBe(true);
  });

  it("allows open -> cancelled", () => {
    expect(canTransitionStatus("open", "cancelled")).toBe(true);
  });

  it("allows open -> disputed", () => {
    expect(canTransitionStatus("open", "disputed")).toBe(true);
  });

  it("allows disputed -> awarded", () => {
    expect(canTransitionStatus("disputed", "awarded")).toBe(true);
  });

  it("allows disputed -> cancelled", () => {
    expect(canTransitionStatus("disputed", "cancelled")).toBe(true);
  });

  it("rejects awarded -> open (no going back)", () => {
    expect(canTransitionStatus("awarded", "open")).toBe(false);
  });

  it("rejects expired -> open (no going back)", () => {
    expect(canTransitionStatus("expired", "open")).toBe(false);
  });

  it("rejects cancelled -> open (no going back)", () => {
    expect(canTransitionStatus("cancelled", "open")).toBe(false);
  });

  it("rejects awarded -> cancelled (final state)", () => {
    expect(canTransitionStatus("awarded", "cancelled")).toBe(false);
  });

  it("rejects same-state transitions", () => {
    expect(canTransitionStatus("open", "open")).toBe(false);
    expect(canTransitionStatus("awarded", "awarded")).toBe(false);
  });
});

describe("BOUNTY_STATUS_TRANSITIONS", () => {
  it("is a complete mapping of all statuses", () => {
    const allStatuses = [
      "open",
      "awarded",
      "expired",
      "cancelled",
      "disputed",
    ];
    for (const status of allStatuses) {
      expect(BOUNTY_STATUS_TRANSITIONS).toHaveProperty(status);
    }
  });

  it("terminal states have no outgoing transitions", () => {
    expect(BOUNTY_STATUS_TRANSITIONS.awarded).toEqual([]);
    expect(BOUNTY_STATUS_TRANSITIONS.expired).toEqual([]);
    expect(BOUNTY_STATUS_TRANSITIONS.cancelled).toEqual([]);
  });
});

// ============================================================
// Self-Dealing Detection
// ============================================================
describe("validateSelfDealingCheck", () => {
  it("allows submission when agent owner differs from bounty creator", () => {
    const result = validateSelfDealingCheck("user-1", "user-2");
    expect(result.allowed).toBe(true);
  });

  it("blocks submission when agent owner matches bounty creator", () => {
    const result = validateSelfDealingCheck("user-1", "user-1");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("own bounty");
  });

  it("allows submission when agent has no owner (API key registered)", () => {
    const result = validateSelfDealingCheck("user-1", null);
    expect(result.allowed).toBe(true);
  });
});
