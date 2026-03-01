import { describe, expect, it } from "vitest";

import { DISPUTE_STATUS_TRANSITIONS as LOGIC_DISPUTE_STATUS_TRANSITIONS } from "../src/lib/dispute-logic";
import {
  DISPUTE_STATUS_TRANSITIONS as TYPE_DISPUTE_STATUS_TRANSITIONS,
  type DisputeStatus,
  type TestCase,
  type VerificationResults,
  type VerificationVerdict,
} from "../src/types/bounty";

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

describe("Phase B type constants", () => {
  it("matches dispute transitions between types and logic modules", () => {
    expect(TYPE_DISPUTE_STATUS_TRANSITIONS).toEqual(LOGIC_DISPUTE_STATUS_TRANSITIONS);
  });

  it("has transition entries for all DisputeStatus values", () => {
    for (const status of ALL_DISPUTE_STATUSES) {
      expect(TYPE_DISPUTE_STATUS_TRANSITIONS).toHaveProperty(status);
    }
  });

  it("defines terminal statuses with empty transition arrays", () => {
    const terminalStatuses: DisputeStatus[] = [
      "resolved_agent_full",
      "resolved_split",
      "resolved_publisher",
      "withdrawn",
      "expired",
    ];

    for (const status of terminalStatuses) {
      expect(TYPE_DISPUTE_STATUS_TRANSITIONS[status]).toEqual([]);
    }
  });
});

describe("Phase B verification types", () => {
  it("VerificationVerdict values are correct", () => {
    const verdicts: VerificationVerdict[] = ["AC", "WA", "TLE", "RE", "CE", "MLE"];

    expect(verdicts).toEqual(["AC", "WA", "TLE", "RE", "CE", "MLE"]);
  });

  it("TestCase shape matches expected fields", () => {
    const testCase: TestCase = {
      id: "case-1",
      stdin: "2 3",
      expectedOutput: "5",
      isPublic: true,
      label: "public-sample",
    };

    expect(testCase.id).toBe("case-1");
    expect(testCase.stdin).toBe("2 3");
    expect(testCase.expectedOutput).toBe("5");
    expect(testCase.isPublic).toBe(true);
    expect(testCase.label).toBe("public-sample");
  });

  it("VerificationResults shape matches expected fields", () => {
    const verification: VerificationResults = {
      allPassed: false,
      summary: { passed: 1, total: 2 },
      results: [
        {
          testCaseId: "case-1",
          passed: true,
          verdict: "AC",
          wallTimeMs: 14,
          actualOutput: "5",
          memoryKb: 256,
        },
        {
          testCaseId: "case-2",
          passed: false,
          verdict: "WA",
          wallTimeMs: 9,
          actualOutput: "6",
        },
      ],
    };

    expect(verification.summary.passed).toBe(1);
    expect(verification.summary.total).toBe(2);
    expect(verification.results).toHaveLength(2);
    expect(verification.results[0].verdict).toBe("AC");
    expect(verification.results[1].verdict).toBe("WA");
  });
});
