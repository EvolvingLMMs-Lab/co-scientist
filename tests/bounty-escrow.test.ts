/**
 * Bounty System — Escrow & Transaction Logic Tests
 *
 * Tests the financial operations without database:
 * - Wallet balance checks
 * - Escrow funding (lock credits)
 * - Payout distribution
 * - Refund logic
 * - Idempotency
 * - Double-spend prevention
 */
import { describe, it, expect } from "vitest";

import {
  createEscrowTransaction,
  createPayoutTransactions,
  createRefundTransaction,
  validateWalletBalance,
  buildTransactionRecord,
} from "@/lib/bounty-escrow";

import type { TransactionType } from "@/types/bounty";

// ============================================================
// Wallet Balance Validation
// ============================================================
describe("validateWalletBalance", () => {
  it("allows when balance >= reward amount", () => {
    const result = validateWalletBalance(10000, 5000);
    expect(result.sufficient).toBe(true);
  });

  it("allows when balance == reward amount exactly", () => {
    const result = validateWalletBalance(5000, 5000);
    expect(result.sufficient).toBe(true);
  });

  it("rejects when balance < reward amount", () => {
    const result = validateWalletBalance(4999, 5000);
    expect(result.sufficient).toBe(false);
    expect(result.shortfall).toBe(1);
  });

  it("rejects when balance is 0", () => {
    const result = validateWalletBalance(0, 5000);
    expect(result.sufficient).toBe(false);
    expect(result.shortfall).toBe(5000);
  });
});

// ============================================================
// Escrow Transaction Creation
// ============================================================
describe("createEscrowTransaction", () => {
  it("creates a debit transaction for the user", () => {
    const tx = createEscrowTransaction({
      userId: "user-1",
      bountyId: "bounty-1",
      amount: 5000,
      idempotencyKey: "escrow-bounty-1",
    });

    expect(tx.user_id).toBe("user-1");
    expect(tx.bounty_id).toBe("bounty-1");
    expect(tx.amount).toBe(-5000); // negative = debit
    expect(tx.type).toBe("bounty_escrow");
    expect(tx.idempotency_key).toBe("escrow-bounty-1");
  });

  it("amount is always negative (debit from user)", () => {
    const tx = createEscrowTransaction({
      userId: "user-1",
      bountyId: "bounty-1",
      amount: 100,
      idempotencyKey: "key-1",
    });
    expect(tx.amount).toBeLessThan(0);
  });

  it("includes a generated id", () => {
    const tx = createEscrowTransaction({
      userId: "user-1",
      bountyId: "bounty-1",
      amount: 100,
      idempotencyKey: "key-1",
    });
    expect(tx.id).toBeTruthy();
    expect(typeof tx.id).toBe("string");
    expect(tx.id.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Payout Transaction Creation
// ============================================================
describe("createPayoutTransactions", () => {
  it("creates exactly 2 transactions: agent payout + platform fee", () => {
    const txs = createPayoutTransactions({
      agentId: "agent-1",
      bountyId: "bounty-1",
      rewardAmount: 10000,
      idempotencyKey: "payout-bounty-1",
    });

    expect(txs).toHaveLength(2);
  });

  it("agent payout transaction is positive and correct amount", () => {
    const txs = createPayoutTransactions({
      agentId: "agent-1",
      bountyId: "bounty-1",
      rewardAmount: 10000,
      idempotencyKey: "payout-bounty-1",
    });

    const agentTx = txs.find((t) => t.type === "bounty_payout");
    expect(agentTx).toBeDefined();
    expect(agentTx!.amount).toBe(9000); // 10000 - 10% fee
    expect(agentTx!.agent_id).toBe("agent-1");
  });

  it("platform fee transaction is correct amount", () => {
    const txs = createPayoutTransactions({
      agentId: "agent-1",
      bountyId: "bounty-1",
      rewardAmount: 10000,
      idempotencyKey: "payout-bounty-1",
    });

    const feeTx = txs.find((t) => t.type === "platform_fee");
    expect(feeTx).toBeDefined();
    expect(feeTx!.amount).toBe(1000); // 10% fee
  });

  it("agent payout + platform fee = reward amount", () => {
    const txs = createPayoutTransactions({
      agentId: "agent-1",
      bountyId: "bounty-1",
      rewardAmount: 7777,
      idempotencyKey: "payout-bounty-1",
    });

    const totalOut = txs.reduce((sum, t) => sum + t.amount, 0);
    expect(totalOut).toBe(7777);
  });

  it("each transaction has a unique id", () => {
    const txs = createPayoutTransactions({
      agentId: "agent-1",
      bountyId: "bounty-1",
      rewardAmount: 10000,
      idempotencyKey: "payout-bounty-1",
    });

    const ids = txs.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("idempotency keys are distinct per transaction type", () => {
    const txs = createPayoutTransactions({
      agentId: "agent-1",
      bountyId: "bounty-1",
      rewardAmount: 10000,
      idempotencyKey: "payout-bounty-1",
    });

    const keys = txs.map((t) => t.idempotency_key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ============================================================
// Refund Transaction Creation
// ============================================================
describe("createRefundTransaction", () => {
  it("creates a credit transaction for the user", () => {
    const tx = createRefundTransaction({
      userId: "user-1",
      bountyId: "bounty-1",
      amount: 5000,
      idempotencyKey: "refund-bounty-1",
    });

    expect(tx.user_id).toBe("user-1");
    expect(tx.bounty_id).toBe("bounty-1");
    expect(tx.amount).toBe(5000); // positive = credit back
    expect(tx.type).toBe("bounty_refund");
  });

  it("amount is always positive (credit to user)", () => {
    const tx = createRefundTransaction({
      userId: "user-1",
      bountyId: "bounty-1",
      amount: 100,
      idempotencyKey: "key-1",
    });
    expect(tx.amount).toBeGreaterThan(0);
  });
});

// ============================================================
// Transaction Record Builder
// ============================================================
describe("buildTransactionRecord", () => {
  it("creates a record with all required fields", () => {
    const tx = buildTransactionRecord({
      userId: "user-1",
      agentId: null,
      bountyId: "bounty-1",
      amount: 5000,
      type: "deposit" as TransactionType,
      idempotencyKey: "dep-1",
      description: "Credit purchase",
    });

    expect(tx.id).toBeTruthy();
    expect(tx.user_id).toBe("user-1");
    expect(tx.agent_id).toBeNull();
    expect(tx.bounty_id).toBe("bounty-1");
    expect(tx.amount).toBe(5000);
    expect(tx.type).toBe("deposit");
    expect(tx.idempotency_key).toBe("dep-1");
    expect(tx.description).toBe("Credit purchase");
    expect(tx.created_at).toBeTypeOf("number");
  });

  it("generates a created_at timestamp", () => {
    const before = Math.floor(Date.now() / 1000);
    const tx = buildTransactionRecord({
      userId: "user-1",
      agentId: null,
      bountyId: null,
      amount: 100,
      type: "deposit" as TransactionType,
      idempotencyKey: "test",
    });
    const after = Math.floor(Date.now() / 1000);

    expect(tx.created_at).toBeGreaterThanOrEqual(before);
    expect(tx.created_at).toBeLessThanOrEqual(after + 1);
  });

  it("accepts optional description", () => {
    const tx = buildTransactionRecord({
      userId: "user-1",
      agentId: null,
      bountyId: null,
      amount: 100,
      type: "deposit" as TransactionType,
      idempotencyKey: "test",
    });
    expect(tx.description).toBeNull();
  });
});
