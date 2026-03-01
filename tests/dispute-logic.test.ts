import { describe, expect, it } from "vitest";

import {
  DISPUTE_FILING_WINDOW,
  DISPUTE_STATUS_TRANSITIONS,
  REPUTATION_DELTAS,
  canTransitionDispute,
  computeDisputePayout,
  isDisputeTerminal,
  isPublisherDeadlineExpired,
  isResolutionDeadlineExpired,
  isWithinDisputeWindow,
  shouldAutoResolve,
} from "../src/lib/dispute-logic";
import type { DisputeOutcome, DisputeStatus } from "../src/types/bounty";

const ALL_DISPUTE_STATUSES: DisputeStatus[] = [
  "filed",
  "responded",
  "under_review",
  "resolved_agent_full",
  "resolved_split",
  "resolved_publisher",
  "withdrawn",
  "expired",
];

describe("canTransitionDispute", () => {
  it("allows all configured transitions and blocks invalid transitions", () => {
    for (const from of ALL_DISPUTE_STATUSES) {
      const allowed = DISPUTE_STATUS_TRANSITIONS[from];

      for (const to of allowed) {
        expect(canTransitionDispute(from, to)).toBe(true);
      }

      for (const to of ALL_DISPUTE_STATUSES) {
        if (!allowed.includes(to)) {
          expect(canTransitionDispute(from, to)).toBe(false);
        }
      }
    }
  });
});

describe("isDisputeTerminal", () => {
  it("returns true for terminal statuses", () => {
    const terminal: DisputeStatus[] = [
      "resolved_agent_full",
      "resolved_split",
      "resolved_publisher",
      "withdrawn",
      "expired",
    ];

    for (const status of terminal) {
      expect(isDisputeTerminal(status)).toBe(true);
    }
  });

  it("returns false for active statuses", () => {
    const active: DisputeStatus[] = ["filed", "responded", "under_review"];

    for (const status of active) {
      expect(isDisputeTerminal(status)).toBe(false);
    }
  });
});

describe("dispute windows and deadlines", () => {
  it("isWithinDisputeWindow returns true within 72h and false after 72h", () => {
    const rejectedAt = 1_000_000;

    expect(isWithinDisputeWindow(rejectedAt, rejectedAt + 1)).toBe(true);
    expect(isWithinDisputeWindow(rejectedAt, rejectedAt + DISPUTE_FILING_WINDOW)).toBe(true);
    expect(isWithinDisputeWindow(rejectedAt, rejectedAt + DISPUTE_FILING_WINDOW + 1)).toBe(false);
  });

  it("isWithinDisputeWindow handles edge cases", () => {
    const rejectedAt = 2_000_000;

    expect(isWithinDisputeWindow(rejectedAt, rejectedAt)).toBe(true);
    expect(isWithinDisputeWindow(rejectedAt, rejectedAt - 60)).toBe(true);
  });

  it("isPublisherDeadlineExpired works before/at/after deadline", () => {
    const deadline = 3_000_000;

    expect(isPublisherDeadlineExpired(deadline, deadline - 1)).toBe(false);
    expect(isPublisherDeadlineExpired(deadline, deadline)).toBe(false);
    expect(isPublisherDeadlineExpired(deadline, deadline + 1)).toBe(true);
  });

  it("isResolutionDeadlineExpired works before/at/after deadline", () => {
    const deadline = 4_000_000;

    expect(isResolutionDeadlineExpired(deadline, deadline - 1)).toBe(false);
    expect(isResolutionDeadlineExpired(deadline, deadline)).toBe(false);
    expect(isResolutionDeadlineExpired(deadline, deadline + 1)).toBe(true);
  });
});

describe("computeDisputePayout", () => {
  it("resolved_publisher gives full refund to publisher with no fee", () => {
    expect(computeDisputePayout(10_000, "resolved_publisher")).toEqual({
      agentAmount: 0,
      publisherRefund: 10_000,
      platformFee: 0,
    });
  });

  it("resolved_agent_full gives 90% to agent and 10% platform fee", () => {
    expect(computeDisputePayout(10_000, "resolved_agent_full")).toEqual({
      agentAmount: 9_000,
      publisherRefund: 0,
      platformFee: 1_000,
    });
  });

  it("resolved_split with 6000 bps gives 60% share minus 10% fee", () => {
    expect(computeDisputePayout(10_000, "resolved_split", 6_000)).toEqual({
      agentAmount: 5_400,
      publisherRefund: 4_000,
      platformFee: 600,
    });
  });

  it("resolved_split defaults to 5000 bps (50/50)", () => {
    expect(computeDisputePayout(10_000, "resolved_split")).toEqual({
      agentAmount: 4_500,
      publisherRefund: 5_000,
      platformFee: 500,
    });
  });

  it("handles small amounts (1 credit)", () => {
    expect(computeDisputePayout(1, "resolved_agent_full")).toEqual({
      agentAmount: 1,
      publisherRefund: 0,
      platformFee: 0,
    });
    expect(computeDisputePayout(1, "resolved_split")).toEqual({
      agentAmount: 0,
      publisherRefund: 1,
      platformFee: 0,
    });
  });
});

describe("shouldAutoResolve", () => {
  it("auto resolves for agent when publisher deadline expires", () => {
    expect(shouldAutoResolve(false, false, true)).toEqual({
      autoResolve: true,
      outcome: "resolved_agent_full",
      reason: "Publisher did not respond within 48h deadline",
    });
  });

  it("auto resolves for agent when verification passed and criteria are objective", () => {
    expect(shouldAutoResolve(true, true, false)).toEqual({
      autoResolve: true,
      outcome: "resolved_agent_full",
      reason: "All automated tests passed and all acceptance criteria are objective",
    });
  });

  it("does not auto resolve when neither condition is met", () => {
    expect(shouldAutoResolve(false, true, false)).toEqual({
      autoResolve: false,
      outcome: null,
      reason: null,
    });
  });
});

describe("dispute constants", () => {
  it("REPUTATION_DELTAS includes all dispute outcomes", () => {
    const expectedOutcomes: Array<DisputeOutcome | "auto_agent"> = [
      "resolved_agent_full",
      "resolved_split",
      "resolved_publisher",
      "auto_agent",
    ];

    for (const outcome of expectedOutcomes) {
      expect(REPUTATION_DELTAS).toHaveProperty(outcome);
      expect(REPUTATION_DELTAS[outcome]).toEqual(
        expect.objectContaining({
          agent: expect.any(Number),
          publisher: expect.any(Number),
        }),
      );
    }
  });

  it("DISPUTE_STATUS_TRANSITIONS has expected entries", () => {
    expect(DISPUTE_STATUS_TRANSITIONS).toEqual({
      filed: ["responded", "resolved_agent_full", "withdrawn", "expired"],
      responded: [
        "under_review",
        "resolved_agent_full",
        "resolved_split",
        "resolved_publisher",
        "withdrawn",
      ],
      under_review: ["resolved_agent_full", "resolved_split", "resolved_publisher"],
      resolved_agent_full: [],
      resolved_split: [],
      resolved_publisher: [],
      withdrawn: [],
      expired: [],
    });
  });
});
