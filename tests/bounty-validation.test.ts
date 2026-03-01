/**
 * Bounty System — Validation Schema Tests
 *
 * Tests all Zod validation schemas for the bounty marketplace:
 * - createBountySchema
 * - createSubmissionSchema
 * - awardBountySchema
 * - rejectSubmissionSchema
 */
import { describe, it, expect } from "vitest";

// We import the schemas that MUST be created in src/lib/validation.ts
import {
  createBountySchema,
  createSubmissionSchema,
  awardBountySchema,
  rejectSubmissionSchema,
} from "@/lib/bounty-validation";

describe("createBountySchema", () => {
  const validBounty = {
    title: "Prove the Riemann Hypothesis for a special case",
    description:
      "## Problem\n\nProvide a constructive proof for the following special case...\n\nPlease show all intermediate steps.",
    rewardAmount: 5000,
    deadline: Math.floor(Date.now() / 1000) + 86400 * 7, // 7 days from now
  };

  it("accepts a valid bounty with required fields only", () => {
    const result = createBountySchema.safeParse(validBounty);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe(validBounty.title);
      expect(result.data.rewardAmount).toBe(5000);
    }
  });

  it("accepts a valid bounty with all optional fields", () => {
    const full = {
      ...validBounty,
      panel: "math",
      maxSubmissions: 5,
      difficultyTier: "hard" as const,
      evaluationCriteria: "Must include formal proof with every step justified",
      tags: ["proof", "number-theory"],
    };
    const result = createBountySchema.safeParse(full);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.difficultyTier).toBe("hard");
      expect(result.data.tags).toEqual(["proof", "number-theory"]);
    }
  });

  // Title validation
  it("rejects title shorter than 3 characters", () => {
    const result = createBountySchema.safeParse({ ...validBounty, title: "ab" });
    expect(result.success).toBe(false);
  });

  it("rejects title longer than 300 characters", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      title: "a".repeat(301),
    });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from title", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      title: "  Prove something  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Prove something");
    }
  });

  // Description validation
  it("rejects description shorter than 10 characters", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      description: "too short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects description longer than 50000 characters", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      description: "a".repeat(50001),
    });
    expect(result.success).toBe(false);
  });

  // Reward amount validation
  it("rejects reward amount of 0", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      rewardAmount: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative reward amount", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      rewardAmount: -100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer reward amount", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      rewardAmount: 50.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts minimum reward amount of 1", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      rewardAmount: 1,
    });
    expect(result.success).toBe(true);
  });

  // Deadline validation
  it("rejects deadline that is not a number", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      deadline: "tomorrow",
    });
    expect(result.success).toBe(false);
  });

  // Panel slug validation
  it("accepts valid panel slug", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      panel: "computer-science",
    });
    expect(result.success).toBe(true);
  });

  it("rejects panel slug with uppercase", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      panel: "Math",
    });
    expect(result.success).toBe(false);
  });

  it("rejects panel slug with spaces", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      panel: "my panel",
    });
    expect(result.success).toBe(false);
  });

  // Difficulty tier validation
  it("accepts all valid difficulty tiers", () => {
    for (const tier of ["trivial", "moderate", "hard", "research"]) {
      const result = createBountySchema.safeParse({
        ...validBounty,
        difficultyTier: tier,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid difficulty tier", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      difficultyTier: "impossible",
    });
    expect(result.success).toBe(false);
  });

  // Max submissions validation
  it("rejects maxSubmissions of 0", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      maxSubmissions: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects maxSubmissions above 100", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      maxSubmissions: 101,
    });
    expect(result.success).toBe(false);
  });

  // Tags validation
  it("accepts up to 10 tags", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      tags: Array.from({ length: 10 }, (_, i) => `tag-${i}`),
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than 10 tags", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty string tags", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      tags: ["valid", ""],
    });
    expect(result.success).toBe(false);
  });

  // Evaluation criteria
  it("accepts evaluation criteria up to 5000 chars", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      evaluationCriteria: "a".repeat(5000),
    });
    expect(result.success).toBe(true);
  });

  it("rejects evaluation criteria over 5000 chars", () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      evaluationCriteria: "a".repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

describe("createSubmissionSchema", () => {
  const validSubmission = {
    content:
      "## Solution\n\nHere is my detailed approach to solving this problem with full derivation steps and working shown...",
  };
  it("accepts a valid submission with content only", () => {
    const result = createSubmissionSchema.safeParse(validSubmission);
    expect(result.success).toBe(true);
  });

  it("accepts a valid submission with approach summary", () => {
    const result = createSubmissionSchema.safeParse({
      ...validSubmission,
      approachSummary: "Using Fourier analysis and contour integration",
    });
    expect(result.success).toBe(true);
  });

  it("rejects content shorter than 100 characters", () => {
    const result = createSubmissionSchema.safeParse({ content: "too short" });
    expect(result.success).toBe(false);
  });

  it("rejects content longer than 100000 characters", () => {
    const result = createSubmissionSchema.safeParse({
      content: "a".repeat(100001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects approach summary longer than 500 characters", () => {
    const result = createSubmissionSchema.safeParse({
      ...validSubmission,
      approachSummary: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe("awardBountySchema", () => {
  it("accepts valid award with quality score 1-5", () => {
    for (let score = 1; score <= 5; score++) {
      const result = awardBountySchema.safeParse({
        submissionId: "abc123def456ghi789jkl",
        qualityScore: score,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects quality score of 0", () => {
    const result = awardBountySchema.safeParse({
      submissionId: "abc123def456ghi789jkl",
      qualityScore: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects quality score above 5", () => {
    const result = awardBountySchema.safeParse({
      submissionId: "abc123def456ghi789jkl",
      qualityScore: 6,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer quality score", () => {
    const result = awardBountySchema.safeParse({
      submissionId: "abc123def456ghi789jkl",
      qualityScore: 3.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional review notes up to 2000 chars", () => {
    const result = awardBountySchema.safeParse({
      submissionId: "abc123def456ghi789jkl",
      qualityScore: 5,
      reviewNotes: "Excellent work, thorough and well-explained",
    });
    expect(result.success).toBe(true);
  });

  it("rejects review notes over 2000 chars", () => {
    const result = awardBountySchema.safeParse({
      submissionId: "abc123def456ghi789jkl",
      qualityScore: 5,
      reviewNotes: "a".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("requires submissionId", () => {
    const result = awardBountySchema.safeParse({
      qualityScore: 5,
    });
    expect(result.success).toBe(false);
  });
});

describe("rejectSubmissionSchema", () => {
  it("accepts rejection with reason", () => {
    const result = rejectSubmissionSchema.safeParse({
      reason: "The proof contains a logical error in step 3",
    });
    expect(result.success).toBe(true);
  });

  it("accepts rejection without reason (optional)", () => {
    const result = rejectSubmissionSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects reason over 2000 chars", () => {
    const result = rejectSubmissionSchema.safeParse({
      reason: "a".repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});
