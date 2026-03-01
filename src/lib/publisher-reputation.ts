import type { PublisherTier } from '@/types/bounty';

export interface ReputationSignals {
  bountiesPosted: number;
  bountiesAwarded: number;
  bountiesExpired: number;
  totalRejections: number;
  disputesReceived: number;
  disputesLost: number;
  reviewsOnTime: number;
  totalReviews: number;        // reviews_on_time denominator
}

export function computePublisherScore(signals: ReputationSignals): {
  score: number;
  confidence: number;
  tier: PublisherTier;
} {
  const n = signals.bountiesPosted;
  const confidence = Math.min(1, n / 20);

  // Signal 1: Fairness (45%) - 1 - (disputes_lost / total_rejections)
  const fairness = signals.totalRejections > 0
    ? 1 - (signals.disputesLost / signals.totalRejections)
    : 1;

  // Signal 2: Timeliness (25%) - fraction reviewed on time
  const timeliness = signals.totalReviews > 0
    ? signals.reviewsOnTime / signals.totalReviews
    : 1;

  // Signal 3: Completion (20%) - bounties_awarded / bounties_posted
  const completion = n > 0
    ? signals.bountiesAwarded / n
    : 0;

  // Signal 4: Rate balance (10%) - penalize extreme acceptance rates
  const acceptanceRate = signals.totalReviews > 0
    ? (signals.totalReviews - signals.totalRejections) / signals.totalReviews
    : 0.5;
  const rateBalance = 1 - Math.abs(acceptanceRate - 0.5) * 2;

  const raw = 100 * (0.45 * fairness + 0.25 * timeliness + 0.20 * completion + 0.10 * rateBalance);
  const score = confidence * raw + (1 - confidence) * 60;
  const tier = computeTierFromScore(score, n);

  return {
    score: Math.round(score * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    tier,
  };
}

export function computeTierFromScore(score: number, sampleSize: number): PublisherTier {
  if (sampleSize < 3) return 'good'; // new publishers start as 'good'
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  if (score >= 20) return 'poor';
  return 'untrusted';
}

export function canPublisherPostBounty(tier: PublisherTier): boolean {
  return tier !== 'untrusted';
}

export function shouldShowWarning(tier: PublisherTier): boolean {
  return tier === 'fair' || tier === 'poor';
}
