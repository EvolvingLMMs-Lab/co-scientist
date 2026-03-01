import { describe, expect, it } from "vitest";

import {
  canPublisherPostBounty,
  computePublisherScore,
  computeTierFromScore,
  shouldShowWarning,
  type ReputationSignals,
} from "../src/lib/publisher-reputation";
import type { PublisherTier } from "../src/types/bounty";

function makeSignals(overrides: Partial<ReputationSignals> = {}): ReputationSignals {
  return {
    bountiesPosted: 0,
    bountiesAwarded: 0,
    bountiesExpired: 0,
    totalRejections: 0,
    disputesReceived: 0,
    disputesLost: 0,
    reviewsOnTime: 0,
    totalReviews: 0,
    ...overrides,
  };
}

describe("computePublisherScore", () => {
  it("scores a perfect publisher at approximately 100 with excellent tier", () => {
    const result = computePublisherScore(
      makeSignals({
        bountiesPosted: 20,
        bountiesAwarded: 20,
        totalRejections: 10,
        disputesReceived: 10,
        disputesLost: 0,
        reviewsOnTime: 20,
        totalReviews: 20,
      }),
    );

    expect(result.score).toBeCloseTo(100, 1);
    expect(result.confidence).toBe(1);
    expect(result.tier).toBe("excellent");
  });

  it("keeps new publishers (<3 bounties) around baseline with good tier", () => {
    const result = computePublisherScore(
      makeSignals({
        bountiesPosted: 1,
        bountiesAwarded: 0,
        bountiesExpired: 1,
        totalRejections: 1,
        disputesReceived: 1,
        disputesLost: 1,
        reviewsOnTime: 0,
        totalReviews: 1,
      }),
    );

    expect(result.score).toBeGreaterThanOrEqual(55);
    expect(result.score).toBeLessThanOrEqual(65);
    expect(result.tier).toBe("good");
  });

  it("scores a bad publisher very low with poor or untrusted tier", () => {
    const result = computePublisherScore(
      makeSignals({
        bountiesPosted: 20,
        bountiesAwarded: 1,
        bountiesExpired: 19,
        totalRejections: 19,
        disputesReceived: 19,
        disputesLost: 19,
        reviewsOnTime: 1,
        totalReviews: 20,
      }),
    );

    expect(result.score).toBeLessThan(20);
    expect(["poor", "untrusted"]).toContain(result.tier);
  });

  it("applies confidence smoothing toward 60 for low sample sizes", () => {
    const lowSample = computePublisherScore(
      makeSignals({
        bountiesPosted: 1,
        bountiesAwarded: 0,
        totalRejections: 1,
        disputesReceived: 1,
        disputesLost: 1,
        reviewsOnTime: 0,
        totalReviews: 1,
      }),
    );

    const highSample = computePublisherScore(
      makeSignals({
        bountiesPosted: 20,
        bountiesAwarded: 0,
        totalRejections: 20,
        disputesReceived: 20,
        disputesLost: 20,
        reviewsOnTime: 0,
        totalReviews: 20,
      }),
    );

    expect(Math.abs(lowSample.score - 60)).toBeLessThan(Math.abs(highSample.score - 60));
  });

  it("returns confidence 0 and score 60 when zero bounties were posted", () => {
    const result = computePublisherScore(makeSignals());

    expect(result.confidence).toBe(0);
    expect(result.score).toBe(60);
  });

  it("returns confidence 1.0 when 20+ bounties were posted", () => {
    const result = computePublisherScore(
      makeSignals({
        bountiesPosted: 25,
        bountiesAwarded: 18,
        bountiesExpired: 2,
        totalRejections: 7,
        disputesReceived: 5,
        disputesLost: 2,
        reviewsOnTime: 22,
        totalReviews: 25,
      }),
    );

    expect(result.confidence).toBe(1);
  });

  it("handles all-zero signals edge case", () => {
    const result = computePublisherScore(
      makeSignals({
        bountiesPosted: 0,
        bountiesAwarded: 0,
        bountiesExpired: 0,
        totalRejections: 0,
        disputesReceived: 0,
        disputesLost: 0,
        reviewsOnTime: 0,
        totalReviews: 0,
      }),
    );

    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBe(60);
    expect(result.tier).toBe("good");
  });
});

describe("computeTierFromScore", () => {
  it("maps score bands to expected tiers", () => {
    const cases: Array<[number, PublisherTier]> = [
      [80, "excellent"],
      [79.9, "good"],
      [60, "good"],
      [59.9, "fair"],
      [40, "fair"],
      [39.9, "poor"],
      [20, "poor"],
      [19.9, "untrusted"],
    ];

    for (const [score, tier] of cases) {
      expect(computeTierFromScore(score, 3)).toBe(tier);
    }
  });

  it("always returns good for sample sizes below 3", () => {
    for (const score of [0, 10, 39.9, 59.9, 79.9, 100]) {
      expect(computeTierFromScore(score, 2)).toBe("good");
    }
  });
});

describe("canPublisherPostBounty", () => {
  it("returns true for all tiers except untrusted", () => {
    const allowed: PublisherTier[] = ["excellent", "good", "fair", "poor"];

    for (const tier of allowed) {
      expect(canPublisherPostBounty(tier)).toBe(true);
    }
    expect(canPublisherPostBounty("untrusted")).toBe(false);
  });
});

describe("shouldShowWarning", () => {
  it("returns true for fair and poor only", () => {
    expect(shouldShowWarning("excellent")).toBe(false);
    expect(shouldShowWarning("good")).toBe(false);
    expect(shouldShowWarning("fair")).toBe(true);
    expect(shouldShowWarning("poor")).toBe(true);
    expect(shouldShowWarning("untrusted")).toBe(false);
  });
});
