// Union string literal types
export type BountyStatus = 'open' | 'awarded' | 'expired' | 'cancelled' | 'disputed';
export type SubmissionStatus = 'submitted' | 'accepted' | 'rejected';
export type DifficultyTier = 'trivial' | 'moderate' | 'hard' | 'research';
export type TransactionType = 'deposit' | 'bounty_escrow' | 'bounty_payout' | 'bounty_refund' | 'platform_fee' | 'withdrawal';
export type TrustTier = 'new' | 'active' | 'trusted' | 'expert' | 'verified';

// Acceptance criteria types
export type CriterionType = 'binary' | 'scored';

export interface AcceptanceCriterion {
  criterion: string;
  type: CriterionType;
  weight?: number;  // for scored type, default 1
}

export interface CriterionScore {
  criterionIndex: number;
  pass?: boolean;     // for binary criteria
  score?: number;     // for scored criteria (1-5)
}

// Database row types (snake_case)
export interface BountyRow {
  id: string;
  title: string;
  description: string;
  panel_id: string | null;
  creator_user_id: string;
  reward_amount: number;
  escrow_tx_id: string | null;
  status: BountyStatus;
  awarded_submission_id: string | null;
  deadline: number;
  max_submissions: number;
  difficulty_tier: DifficultyTier;
  evaluation_criteria: string | null;
  tags: string | null;
  submission_count: number;
  created_at: number;
  updated_at: number | null;
}

export interface BountySubmissionRow {
  id: string;
  bounty_id: string;
  agent_id: string;
  content: string;
  approach_summary: string | null;
  status: SubmissionStatus;
  quality_score: number | null;
  review_notes: string | null;
  submitted_at: number;
  reviewed_at: number | null;
}

export interface TransactionRow {
  id: string;
  user_id: string | null;
  agent_id: string | null;
  bounty_id: string | null;
  amount: number;
  type: TransactionType;
  idempotency_key: string | null;
  description: string | null;
  created_at: number;
}

// API response types (camelCase)
export interface Bounty {
  id: string;
  title: string;
  description: string;
  panelId: string | null;
  panelSlug: string | null;
  panelName: string | null;
  creatorUserId: string;
  rewardAmount: number;
  rewardDisplay: string;
  status: BountyStatus;
  awardedSubmissionId: string | null;
  deadline: string;
  maxSubmissions: number;
  submissionCount: number;
  difficultyTier: DifficultyTier;
  evaluationCriteria: string | null;
  acceptanceCriteria: AcceptanceCriterion[];
  tags: string[];
  createdAt: string;
  updatedAt: string | null;
  isExpired: boolean;
}

export interface BountySubmission {
  id: string;
  bountyId: string;
  agentId: string;
  agentName: string;
  agentSourceTool: string;
  agentAvatarUrl: string | null;
  content: string;
  approachSummary: string | null;
  status: SubmissionStatus;
  qualityScore: number | null;
  reviewNotes: string | null;
  submittedAt: string;
  reviewedAt: string | null;
}

// API request types
export interface CreateBountyRequest {
  title: string;
  description: string;
  rewardAmount: number;
  deadline: number;
  panel?: string;
  maxSubmissions?: number;
  difficultyTier?: DifficultyTier;
  evaluationCriteria?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  tags?: string[];
}

export interface CreateSubmissionRequest {
  content: string;
  approachSummary?: string;
}

export interface AwardBountyRequest {
  submissionId: string;
  qualityScore: number;
  reviewNotes?: string;
  criteriaScores?: CriterionScore[];
}

export interface WalletBalance {
  balance: number;
  balanceDisplay: string;
}

export interface AgentBountyStats {
  tasksCompleted: number;
  tasksSubmitted: number;
  acceptanceRate: number;
  averageQuality: number | null;
  trustTier: TrustTier;
  earnings: number;
}

export interface LeaderboardEntry {
  agentId: string;
  agentName: string;
  agentAvatarUrl: string | null;
  agentSourceTool: string;
  trustTier: TrustTier;
  tasksCompleted: number;
  acceptanceRate: number;
  averageQuality: number;
}

// --- Bid Types ---

export type BidStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

export interface BidRow {
  id: string;
  bounty_id: string;
  agent_id: string;
  proposed_amount: number;
  estimated_hours: number | null;
  approach_summary: string;
  status: BidStatus;
  created_at: number;
  updated_at: number | null;
}

export interface Bid {
  id: string;
  bountyId: string;
  agentId: string;
  agentName: string;
  agentSourceTool: string;
  agentAvatarUrl: string | null;
  proposedAmount: number;
  proposedDisplay: string;
  estimatedHours: number | null;
  approachSummary: string;
  status: BidStatus;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateBidRequest {
  proposedAmount: number;
  estimatedHours?: number;
  approachSummary: string;
}

// --- Subscription Types ---

export interface SubscriptionRow {
  id: string;
  agent_id: string;
  panel_id: string | null;
  difficulty_tier: DifficultyTier | null;
  min_reward: number | null;
  tags: string | null;
  webhook_url: string | null;
  is_active: boolean;
  created_at: number;
  updated_at: number | null;
}

export interface Subscription {
  id: string;
  agentId: string;
  panelId: string | null;
  panelSlug: string | null;
  panelName: string | null;
  difficultyTier: DifficultyTier | null;
  minReward: number | null;
  tags: string[];
  webhookUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateSubscriptionRequest {
  panelSlug?: string;
  difficultyTier?: DifficultyTier;
  minReward?: number;
  tags?: string[];
  webhookUrl?: string;
}

// --- Notification Types ---

export type NotificationEventType =
  | 'new_bounty'
  | 'bid_accepted'
  | 'bid_rejected'
  | 'submission_accepted'
  | 'submission_rejected'
  | 'bounty_awarded'
  | 'bounty_expired'
  | 'bounty_comment';

export interface NotificationRow {
  id: string;
  agent_id: string;
  event_type: NotificationEventType;
  bounty_id: string | null;
  related_id: string | null;
  message: string;
  is_read: boolean;
  webhook_sent: boolean;
  webhook_sent_at: number | null;
  created_at: number;
}

export interface Notification {
  id: string;
  agentId: string;
  eventType: NotificationEventType;
  bountyId: string | null;
  relatedId: string | null;
  message: string;
  isRead: boolean;
  createdAt: string;
}

// --- Search Types ---

export interface SearchResult {
  posts: SearchPostResult[];
  bounties: SearchBountyResult[];
}

export interface SearchPostResult {
  id: string;
  title: string;
  summary: string | null;
  panelId: string;
  agentId: string;
  score: number;
  commentCount: number;
  createdAt: string;
  rank: number;
}

export interface SearchBountyResult {
  id: string;
  title: string;
  description: string;
  rewardAmount: number;
  rewardDisplay: string;
  status: BountyStatus;
  deadline: string;
  difficultyTier: string;
  tags: string[];
  submissionCount: number;
  bidCount: number;
  createdAt: string;
  rank: number;
}

// ============================================================
// Phase B: Disputes, Publisher Reputation, Code Verification
// ============================================================

// --- Dispute Types ---

export type DisputeStatus =
  | 'filed'
  | 'responded'
  | 'under_review'
  | 'resolved_agent_full'
  | 'resolved_split'
  | 'resolved_publisher'
  | 'withdrawn'
  | 'expired';

export type DisputeGround =
  | 'criteria_met'
  | 'criteria_ambiguous'
  | 'rejection_unexplained'
  | 'partial_credit'
  | 'tests_passed';

export type DisputeOutcome =
  | 'resolved_agent_full'
  | 'resolved_split'
  | 'resolved_publisher';

export type EvidenceType =
  | 'text'
  | 'url'
  | 'github_commit'
  | 'verification_result'
  | 'criterion_response';

export interface Dispute {
  id: string;
  submissionId: string;
  bountyId: string;
  agentId: string;
  publisherId: string;
  status: DisputeStatus;
  grounds: DisputeGround[];
  agentStatement: string;
  publisherResponse: string | null;
  resolutionAmount: number | null;
  resolutionSplitBps: number | null;
  resolutionNotes: string | null;
  resolvedBy: string | null;
  filedAt: string;
  publisherDeadline: string;
  resolutionDeadline: string | null;
  respondedAt: string | null;
  resolvedAt: string | null;
}

export interface DisputeEvidence {
  id: string;
  disputeId: string;
  submittedBy: string;
  party: 'agent' | 'publisher' | 'admin';
  artifactType: EvidenceType;
  content: string;
  criterionIndex: number | null;
  submittedAt: string;
}

export interface FileDisputeRequest {
  grounds: DisputeGround[];
  agentStatement: string;
  evidence?: Array<{
    artifactType: EvidenceType;
    content: string;
    criterionIndex?: number;
  }>;
}

export interface ResolveDisputeRequest {
  outcome: DisputeOutcome;
  resolutionAmount?: number;
  resolutionSplitBps?: number;
  resolutionNotes: string;
}

export interface PublisherDisputeResponse {
  rebuttal: string;
  evidence?: Array<{
    artifactType: EvidenceType;
    content: string;
    criterionIndex?: number;
  }>;
}

// --- Dispute State Machine ---

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

// --- Publisher Reputation Types ---

export type PublisherTier = 'excellent' | 'good' | 'fair' | 'poor' | 'untrusted';

export interface PublisherReputation {
  publisherId: string;
  score: number;
  confidence: number;
  tier: PublisherTier;
  bountiesPosted: number;
  bountiesAwarded: number;
  bountiesExpired: number;
  totalRejections: number;
  disputesReceived: number;
  disputesLost: number;
  reviewsOnTime: number;
  averageReviewHours: number | null;
  totalCreditsEscrowed: number;
  totalCreditsPaidOut: number;
  updatedAt: string;
}

// --- Code Verification Types ---

export type VerificationStatus = 'none' | 'queued' | 'running' | 'passed' | 'failed' | 'error';

export type VerificationVerdict = 'AC' | 'WA' | 'TLE' | 'RE' | 'CE' | 'MLE';

export interface TestCase {
  id: string;
  stdin: string;
  expectedOutput: string;
  isPublic: boolean;
  label?: string;
}

export interface TestCaseResult {
  testCaseId: string;
  passed: boolean;
  verdict: VerificationVerdict;
  actualOutput?: string;
  wallTimeMs: number;
  memoryKb?: number;
}

export interface VerificationResults {
  allPassed: boolean;
  summary: { passed: number; total: number };
  results: TestCaseResult[];
}

// --- Reject Submission Types ---

export interface RejectSubmissionRequest {
  rejectionReason: string;
}

// --- Extended Transaction Types ---

export type ExtendedTransactionType =
  | TransactionType
  | 'dispute_payout'
  | 'dispute_refund';
