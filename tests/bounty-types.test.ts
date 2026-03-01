/**
 * Bounty System — Type Definitions Tests
 *
 * Tests that all required TypeScript types and interfaces exist and have correct shapes.
 * These are compile-time tests that verify the type system is complete.
 */
import { describe, it, expect } from "vitest";

// These types MUST be exported from the types module
import type {
  BountyStatus,
  SubmissionStatus,
  DifficultyTier,
  TransactionType,
  TrustTier,
  BountyRow,
  Bounty,
  BountySubmissionRow,
  BountySubmission,
  TransactionRow,
  CreateBountyRequest,
  CreateSubmissionRequest,
  AwardBountyRequest,
  WalletBalance,
  AgentBountyStats,
  LeaderboardEntry,
} from "@/types/bounty";

describe("Bounty type definitions", () => {
  // Compile-time tests: if these compile, the types exist with correct shapes

  it("BountyStatus has all required values", () => {
    const statuses: BountyStatus[] = [
      "open",
      "awarded",
      "expired",
      "cancelled",
      "disputed",
    ];
    expect(statuses).toHaveLength(5);
  });

  it("SubmissionStatus has all required values", () => {
    const statuses: SubmissionStatus[] = [
      "submitted",
      "accepted",
      "rejected",
    ];
    expect(statuses).toHaveLength(3);
  });

  it("DifficultyTier has all required values", () => {
    const tiers: DifficultyTier[] = [
      "trivial",
      "moderate",
      "hard",
      "research",
    ];
    expect(tiers).toHaveLength(4);
  });

  it("TransactionType has all required values", () => {
    const types: TransactionType[] = [
      "deposit",
      "bounty_escrow",
      "bounty_payout",
      "bounty_refund",
      "platform_fee",
      "withdrawal",
    ];
    expect(types).toHaveLength(6);
  });

  it("TrustTier has all required values", () => {
    const tiers: TrustTier[] = [
      "new",
      "active",
      "trusted",
      "expert",
      "verified",
    ];
    expect(tiers).toHaveLength(5);
  });

  it("BountyRow has all required database fields", () => {
    const row: BountyRow = {
      id: "test-id",
      title: "Test bounty",
      description: "Test description that is long enough",
      panel_id: null,
      creator_user_id: "user-123",
      reward_amount: 5000,
      escrow_tx_id: null,
      status: "open",
      awarded_submission_id: null,
      deadline: Math.floor(Date.now() / 1000) + 86400,
      max_submissions: 10,
      difficulty_tier: "moderate",
      evaluation_criteria: null,
      tags: null,
      submission_count: 0,
      created_at: Math.floor(Date.now() / 1000),
      updated_at: null,
    };
    expect(row.id).toBe("test-id");
    expect(row.reward_amount).toBe(5000);
    expect(row.status).toBe("open");
  });

  it("Bounty has all required API response fields", () => {
    const bounty: Bounty = {
      id: "test-id",
      title: "Test bounty",
      description: "Test description",
      panelId: null,
      panelSlug: null,
      panelName: null,
      creatorUserId: "user-123",
      rewardAmount: 5000,
      rewardDisplay: "$50.00",
      status: "open",
      awardedSubmissionId: null,
      deadline: new Date().toISOString(),
      maxSubmissions: 10,
      submissionCount: 0,
      difficultyTier: "moderate",
      evaluationCriteria: null,
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: null,
      isExpired: false,
    };
    expect(bounty.rewardDisplay).toBe("$50.00");
    expect(bounty.isExpired).toBe(false);
  });

  it("BountySubmission has agent enrichment fields", () => {
    const sub: BountySubmission = {
      id: "sub-1",
      bountyId: "bounty-1",
      agentId: "agent-1",
      agentName: "Test Agent",
      agentSourceTool: "claude-code",
      agentAvatarUrl: null,
      content: "Solution content",
      approachSummary: null,
      status: "submitted",
      qualityScore: null,
      reviewNotes: null,
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
    };
    expect(sub.agentName).toBe("Test Agent");
  });

  it("CreateBountyRequest has correct shape", () => {
    const req: CreateBountyRequest = {
      title: "Test",
      description: "Long enough description for a bounty",
      rewardAmount: 1000,
      deadline: Math.floor(Date.now() / 1000) + 86400,
    };
    expect(req.rewardAmount).toBe(1000);
  });

  it("CreateBountyRequest accepts all optional fields", () => {
    const req: CreateBountyRequest = {
      title: "Test",
      description: "Long enough description for a bounty",
      rewardAmount: 1000,
      deadline: Math.floor(Date.now() / 1000) + 86400,
      panel: "math",
      maxSubmissions: 5,
      difficultyTier: "hard",
      evaluationCriteria: "Must be correct",
      tags: ["proof"],
    };
    expect(req.panel).toBe("math");
  });

  it("WalletBalance has balance and display", () => {
    const wallet: WalletBalance = {
      balance: 12500,
      balanceDisplay: "$125.00",
    };
    expect(wallet.balance).toBe(12500);
  });

  it("AgentBountyStats has all reputation fields", () => {
    const stats: AgentBountyStats = {
      tasksCompleted: 15,
      tasksSubmitted: 20,
      acceptanceRate: 0.75,
      averageQuality: 4.2,
      trustTier: "trusted",
      earnings: 50000,
    };
    expect(stats.trustTier).toBe("trusted");
    expect(stats.acceptanceRate).toBe(0.75);
  });

  it("LeaderboardEntry has all required fields", () => {
    const entry: LeaderboardEntry = {
      agentId: "agent-1",
      agentName: "Top Agent",
      agentAvatarUrl: null,
      agentSourceTool: "claude-code",
      trustTier: "expert",
      tasksCompleted: 100,
      acceptanceRate: 0.95,
      averageQuality: 4.8,
    };
    expect(entry.tasksCompleted).toBe(100);
  });
});
