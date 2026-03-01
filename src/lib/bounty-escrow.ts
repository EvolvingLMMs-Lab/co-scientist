import { nanoid } from "nanoid";
import type { TransactionType } from "@/types/bounty";

const PLATFORM_FEE_RATE = 0.1;

/** Check if wallet balance is sufficient for a bounty */
export function validateWalletBalance(
  currentBalance: number,
  requiredAmount: number,
): { sufficient: boolean; shortfall?: number } {
  if (currentBalance >= requiredAmount) {
    return { sufficient: true };
  }
  return {
    sufficient: false,
    shortfall: requiredAmount - currentBalance,
  };
}

/** Build a transaction record with generated id and timestamp */
export function buildTransactionRecord(params: {
  userId: string | null;
  agentId: string | null;
  bountyId: string | null;
  amount: number;
  type: TransactionType;
  idempotencyKey: string;
  description?: string;
}): {
  id: string;
  user_id: string | null;
  agent_id: string | null;
  bounty_id: string | null;
  amount: number;
  type: TransactionType;
  idempotency_key: string;
  description: string | null;
  created_at: number;
} {
  return {
    id: nanoid(),
    user_id: params.userId,
    agent_id: params.agentId,
    bounty_id: params.bountyId,
    amount: params.amount,
    type: params.type,
    idempotency_key: params.idempotencyKey,
    description: params.description ?? null,
    created_at: Math.floor(Date.now() / 1000),
  };
}

/** Create an escrow transaction (debit from user wallet) */
export function createEscrowTransaction(params: {
  userId: string;
  bountyId: string;
  amount: number;
  idempotencyKey: string;
}) {
  return buildTransactionRecord({
    userId: params.userId,
    agentId: null,
    bountyId: params.bountyId,
    amount: -params.amount, // negative = debit
    type: "bounty_escrow",
    idempotencyKey: params.idempotencyKey,
    description: `Escrow for bounty ${params.bountyId}`,
  });
}

/** Create payout transactions: one for agent, one for platform fee */
export function createPayoutTransactions(params: {
  agentId: string;
  bountyId: string;
  rewardAmount: number;
  idempotencyKey: string;
}) {
  const fee = Math.floor(params.rewardAmount * PLATFORM_FEE_RATE);
  const agentPayout = params.rewardAmount - fee;

  const agentTx = buildTransactionRecord({
    userId: null,
    agentId: params.agentId,
    bountyId: params.bountyId,
    amount: agentPayout,
    type: "bounty_payout",
    idempotencyKey: `${params.idempotencyKey}:payout`,
    description: `Payout for bounty ${params.bountyId}`,
  });

  const feeTx = buildTransactionRecord({
    userId: null,
    agentId: null,
    bountyId: params.bountyId,
    amount: fee,
    type: "platform_fee",
    idempotencyKey: `${params.idempotencyKey}:fee`,
    description: `Platform fee for bounty ${params.bountyId}`,
  });

  return [agentTx, feeTx];
}

/** Create a refund transaction (credit back to user wallet) */
export function createRefundTransaction(params: {
  userId: string;
  bountyId: string;
  amount: number;
  idempotencyKey: string;
}) {
  return buildTransactionRecord({
    userId: params.userId,
    agentId: null,
    bountyId: params.bountyId,
    amount: params.amount, // positive = credit
    type: "bounty_refund",
    idempotencyKey: params.idempotencyKey,
    description: `Refund for bounty ${params.bountyId}`,
  });
}
