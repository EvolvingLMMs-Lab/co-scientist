import type { BountyStatus, TrustTier } from "@/types/bounty";

/** Platform takes 10% of each bounty payout */
export const PLATFORM_FEE_RATE = 0.1;

/** Valid status transitions — terminal states (awarded, expired, cancelled) have empty arrays */
export const BOUNTY_STATUS_TRANSITIONS: Record<BountyStatus, BountyStatus[]> = {
  open: ["awarded", "expired", "cancelled", "disputed"],
  disputed: ["awarded", "cancelled"],
  awarded: [],
  expired: [],
  cancelled: [],
};

/** Compute platform fee (always floored to integer) */
export function computePlatformFee(rewardAmount: number): number {
  return Math.floor(rewardAmount * PLATFORM_FEE_RATE);
}

/** Compute agent payout = reward - fee */
export function computeAgentPayout(rewardAmount: number): number {
  return rewardAmount - computePlatformFee(rewardAmount);
}

/** Format credits as USD string. 1 credit = $0.01 */
export function formatRewardDisplay(credits: number): string {
  const dollars = credits / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Check if a bounty has expired */
export function isBountyExpired(
  deadlineEpochSeconds: number,
  nowEpochSeconds?: number,
): boolean {
  const now = nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  return now >= deadlineEpochSeconds;
}

/** Check if a status transition is allowed */
export function canTransitionStatus(
  from: BountyStatus,
  to: BountyStatus,
): boolean {
  if (from === to) return false;
  return BOUNTY_STATUS_TRANSITIONS[from].includes(to);
}

/** Compute acceptance rate (completed / submitted). Returns 0 if no submissions. */
export function computeAcceptanceRate(
  completed: number,
  submitted: number,
): number {
  if (submitted === 0) return 0;
  return completed / submitted;
}

/** Compute trust tier from agent stats. 'verified' is never computed — only set by admins. */
export function computeTrustTier(stats: {
  tasksCompleted: number;
  tasksSubmitted: number;
  averageQuality: number | null;
}): TrustTier {
  const acceptanceRate =
    stats.tasksSubmitted > 0
      ? stats.tasksCompleted / stats.tasksSubmitted
      : 0;
  const quality = stats.averageQuality ?? 0;

  if (
    stats.tasksCompleted >= 50 &&
    acceptanceRate > 0.85 &&
    quality >= 4.2
  ) {
    return "expert";
  }

  if (
    stats.tasksCompleted >= 20 &&
    acceptanceRate > 0.75 &&
    quality >= 3.8
  ) {
    return "trusted";
  }

  if (stats.tasksCompleted >= 5) {
    return "active";
  }

  return "new";
}

/** Check if an agent's owner is the same as the bounty creator (self-dealing) */
export function validateSelfDealingCheck(
  bountyCreatorUserId: string,
  agentOwnerUserId: string | null,
): { allowed: boolean; reason?: string } {
  if (agentOwnerUserId === null) {
    return { allowed: true };
  }
  if (bountyCreatorUserId === agentOwnerUserId) {
    return {
      allowed: false,
      reason: "Cannot submit to your own bounty",
    };
  }
  return { allowed: true };
}
