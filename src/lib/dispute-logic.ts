import type { DisputeStatus, DisputeOutcome } from '@/types/bounty';

// Dispute time windows (seconds)
export const DISPUTE_FILING_WINDOW = 72 * 60 * 60;         // 72h from rejection
export const PUBLISHER_RESPONSE_WINDOW = 48 * 60 * 60;     // 48h to respond
export const ADMIN_RESOLUTION_WINDOW = 5 * 24 * 60 * 60;   // 5 days to resolve

// Reputation deltas per outcome
export const REPUTATION_DELTAS: Record<DisputeOutcome | 'auto_agent', { agent: number; publisher: number }> = {
  resolved_agent_full: { agent: 5, publisher: -10 },
  resolved_split: { agent: 2, publisher: 0 },
  resolved_publisher: { agent: -5, publisher: 3 },
  auto_agent: { agent: 3, publisher: -15 },
};

export const DISPUTE_STATUS_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  filed: ['responded', 'resolved_agent_full', 'withdrawn', 'expired'],
  responded: ['under_review', 'resolved_agent_full', 'resolved_split', 'resolved_publisher', 'withdrawn'],
  under_review: ['resolved_agent_full', 'resolved_split', 'resolved_publisher'],
  resolved_agent_full: [],
  resolved_split: [],
  resolved_publisher: [],
  withdrawn: [],
  expired: [],
};

export function canTransitionDispute(from: DisputeStatus, to: DisputeStatus): boolean {
  return DISPUTE_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isDisputeTerminal(status: DisputeStatus): boolean {
  return DISPUTE_STATUS_TRANSITIONS[status]?.length === 0;
}

export function isWithinDisputeWindow(rejectedAtEpoch: number, nowEpoch?: number): boolean {
  const now = nowEpoch ?? Math.floor(Date.now() / 1000);
  return now - rejectedAtEpoch <= DISPUTE_FILING_WINDOW;
}

export function isPublisherDeadlineExpired(publisherDeadlineEpoch: number, nowEpoch?: number): boolean {
  const now = nowEpoch ?? Math.floor(Date.now() / 1000);
  return now > publisherDeadlineEpoch;
}

export function isResolutionDeadlineExpired(resolutionDeadlineEpoch: number, nowEpoch?: number): boolean {
  const now = nowEpoch ?? Math.floor(Date.now() / 1000);
  return now > resolutionDeadlineEpoch;
}

export function computeDisputePayout(
  rewardAmount: number,
  outcome: DisputeOutcome,
  splitBps?: number
): { agentAmount: number; publisherRefund: number; platformFee: number } {
  if (outcome === 'resolved_publisher') {
    return { agentAmount: 0, publisherRefund: rewardAmount, platformFee: 0 };
  }

  if (outcome === 'resolved_agent_full') {
    const platformFee = Math.floor(rewardAmount * 0.1);
    const agentAmount = rewardAmount - platformFee;
    return { agentAmount, publisherRefund: 0, platformFee };
  }

  // resolved_split
  const bps = splitBps ?? 5000; // default 50/50
  const agentShare = Math.floor(rewardAmount * bps / 10000);
  const platformFee = Math.floor(agentShare * 0.1);
  const agentAmount = agentShare - platformFee;
  const publisherRefund = rewardAmount - agentShare;
  return { agentAmount, publisherRefund, platformFee };
}

export function shouldAutoResolve(
  verificationPassed: boolean,
  hasObjectiveCriteriaOnly: boolean,
  publisherDeadlineExpired: boolean
): { autoResolve: boolean; outcome: DisputeOutcome | null; reason: string | null } {
  // Publisher ghosted the dispute
  if (publisherDeadlineExpired) {
    return {
      autoResolve: true,
      outcome: 'resolved_agent_full',
      reason: 'Publisher did not respond within 48h deadline',
    };
  }

  // Code bounty: all tests passed + objective criteria only + publisher rejected
  if (verificationPassed && hasObjectiveCriteriaOnly) {
    return {
      autoResolve: true,
      outcome: 'resolved_agent_full',
      reason: 'All automated tests passed and all acceptance criteria are objective',
    };
  }

  return { autoResolve: false, outcome: null, reason: null };
}
