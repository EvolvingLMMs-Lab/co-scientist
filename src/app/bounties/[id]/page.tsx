import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentType } from "react";
import * as HeaderModule from "@/components/Header";
import * as SubmissionReviewFormModule from "@/components/SubmissionReviewForm";
import TimeAgo from "@/components/TimeAgo";
import { getSupabase } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import type {
  AcceptanceCriterion,
  Bid,
  BidRow,
  Bounty,
  BountyRow,
  BountySubmission,
  BountySubmissionRow,
  Dispute,
  DisputeGround,
  DisputeStatus,
  PublisherReputation,
  PublisherTier,
  TestCase,
  TestCaseResult,
  VerificationResults,
  VerificationStatus,
} from "@/types/bounty";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

type PanelRelation = {
  slug: string;
  name: string;
};

type AgentRelation = {
  name: string;
  source_tool: string;
  avatar_url: string | null;
};

type SupabaseBountyRow = BountyRow & {
  bid_count: number;
  acceptance_criteria: unknown;
  test_cases: unknown;
  panels: PanelRelation | PanelRelation[] | null;
};

type SupabaseBidRow = BidRow & {
  agents: AgentRelation | AgentRelation[] | null;
};

type SupabaseBountySubmissionRow = BountySubmissionRow & {
  agents: AgentRelation | AgentRelation[] | null;
  verification_status: VerificationStatus | null;
  verification_results: unknown;
};

type SupabasePublisherReputationRow = {
  publisher_id: string;
  score: number;
  confidence: number;
  tier: PublisherTier;
  bounties_posted: number;
  bounties_awarded: number;
  bounties_expired: number;
  total_rejections: number;
  disputes_received: number;
  disputes_lost: number;
  reviews_on_time: number;
  average_review_hours: number | null;
  total_credits_escrowed: number;
  total_credits_paid_out: number;
  updated_at: number;
};

type SupabaseDisputeRow = {
  id: string;
  submission_id: string;
  bounty_id: string;
  agent_id: string;
  publisher_id: string;
  status: DisputeStatus;
  grounds: DisputeGround[];
  agent_statement: string;
  publisher_response: string | null;
  resolution_amount: number | null;
  resolution_split_bps: number | null;
  resolution_notes: string | null;
  resolved_by: string | null;
  filed_at: number;
  publisher_deadline: number;
  resolution_deadline: number | null;
  responded_at: number | null;
  resolved_at: number | null;
};

type AgentNameRow = {
  id: string;
  name: string;
};

type DisputeWithAgentName = Dispute & {
  agentName: string;
};

interface BountyDetailData {
  bounty: Bounty;
  bidCount: number;
  testCaseById: Record<string, { label: string; isPublic: boolean }>;
}

type BountySubmissionWithVerification = BountySubmission & {
  verificationStatus: VerificationStatus;
  verificationResults: VerificationResults | null;
};

const Header = resolveComponent(HeaderModule, "Header");
const SubmissionReviewForm = resolveComponent(
  SubmissionReviewFormModule,
  "SubmissionReviewForm",
);

function resolveComponent(
  moduleValue: unknown,
  namedExport: string,
): ComponentType<any> {
  const moduleRecord = moduleValue as Record<string, unknown>;
  const component = (moduleRecord.default ?? moduleRecord[namedExport]) as
    | ComponentType<any>
    | undefined;

  return component ?? (() => null);
}

function toIsoTimestamp(epochSeconds: number | null): string | null {
  if (epochSeconds === null) {
    return null;
  }

  return new Date(epochSeconds * 1000).toISOString();
}

function parseAcceptanceCriteria(raw: unknown): AcceptanceCriterion[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

function parseTestCases(raw: unknown): TestCase[] {
  if (!raw) return [];

  const value = typeof raw === "string" ? safeJsonParse(raw) : raw;
  if (!Array.isArray(value)) return [];

  const parsed: TestCase[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.stdin !== "string" ||
      typeof record.expectedOutput !== "string" ||
      typeof record.isPublic !== "boolean"
    ) {
      continue;
    }

    parsed.push({
      id: record.id,
      stdin: record.stdin,
      expectedOutput: record.expectedOutput,
      isPublic: record.isPublic,
      label: typeof record.label === "string" ? record.label : undefined,
    });
  }

  return parsed;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseVerificationResults(raw: unknown): VerificationResults | null {
  if (!raw) return null;

  const value = typeof raw === "string" ? safeJsonParse(raw) : raw;
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  const summaryRecord =
    typeof record.summary === "object" && record.summary !== null
      ? (record.summary as Record<string, unknown>)
      : null;

  const resultsRaw = Array.isArray(record.results) ? record.results : [];
  const results: TestCaseResult[] = [];

  for (const item of resultsRaw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const result = item as Record<string, unknown>;
    if (
      typeof result.testCaseId !== "string" ||
      typeof result.passed !== "boolean" ||
      typeof result.verdict !== "string" ||
      typeof result.wallTimeMs !== "number"
    ) {
      continue;
    }

    results.push({
      testCaseId: result.testCaseId,
      passed: result.passed,
      verdict: result.verdict as TestCaseResult["verdict"],
      actualOutput: typeof result.actualOutput === "string" ? result.actualOutput : undefined,
      wallTimeMs: result.wallTimeMs,
      memoryKb: typeof result.memoryKb === "number" ? result.memoryKb : undefined,
    });
  }

  const passed = summaryRecord && typeof summaryRecord.passed === "number"
    ? summaryRecord.passed
    : results.filter((result) => result.passed).length;
  const total = summaryRecord && typeof summaryRecord.total === "number"
    ? summaryRecord.total
    : results.length;

  return {
    allPassed: typeof record.allPassed === "boolean" ? record.allPassed : passed === total,
    summary: { passed, total },
    results,
  };
}

function normalizeVerificationStatus(status: VerificationStatus | null): VerificationStatus {
  if (
    status === "none" ||
    status === "queued" ||
    status === "running" ||
    status === "passed" ||
    status === "failed" ||
    status === "error"
  ) {
    return status;
  }

  return "none";
}

function mapBountyRow(row: SupabaseBountyRow): BountyDetailData {
  const panel = Array.isArray(row.panels) ? row.panels[0] : row.panels;
  const testCases = parseTestCases(row.test_cases);
  const testCaseById: Record<string, { label: string; isPublic: boolean }> = {};

  for (let index = 0; index < testCases.length; index += 1) {
    const testCase = testCases[index];
    testCaseById[testCase.id] = {
      label: testCase.label ?? `Test ${index + 1}`,
      isPublic: testCase.isPublic,
    };
  }

  return {
    bounty: {
      id: row.id,
      title: row.title,
      description: row.description,
      panelId: row.panel_id,
      panelSlug: panel?.slug ?? null,
      panelName: panel?.name ?? null,
      creatorUserId: row.creator_user_id,
      rewardAmount: row.reward_amount,
      rewardDisplay: `$${(row.reward_amount / 100).toFixed(2)}`,
      status: row.status,
      awardedSubmissionId: row.awarded_submission_id,
      deadline: new Date(row.deadline * 1000).toISOString(),
      maxSubmissions: row.max_submissions,
      submissionCount: row.submission_count,
      difficultyTier: row.difficulty_tier,
      evaluationCriteria: row.evaluation_criteria,
      acceptanceCriteria: parseAcceptanceCriteria(row.acceptance_criteria),
      tags: row.tags ? row.tags.split(",").map((t) => t.trim()) : [],
      createdAt: new Date(row.created_at * 1000).toISOString(),
      updatedAt: toIsoTimestamp(row.updated_at),
      isExpired: row.deadline < Math.floor(Date.now() / 1000),
    },
    bidCount: row.bid_count ?? 0,
    testCaseById,
  };
}

function mapBidRow(row: SupabaseBidRow): Bid {
  const agent = Array.isArray(row.agents) ? row.agents[0] : row.agents;

  return {
    id: row.id,
    bountyId: row.bounty_id,
    agentId: row.agent_id,
    agentName: agent?.name ?? "Unknown",
    agentSourceTool: agent?.source_tool ?? "unknown",
    agentAvatarUrl: agent?.avatar_url ?? null,
    proposedAmount: row.proposed_amount,
    proposedDisplay: `$${(row.proposed_amount / 100).toFixed(2)}`,
    estimatedHours: row.estimated_hours,
    approachSummary: row.approach_summary,
    status: row.status,
    createdAt: new Date(row.created_at * 1000).toISOString(),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

function mapBountySubmissionRow(
  row: SupabaseBountySubmissionRow,
): BountySubmissionWithVerification {
  const agent = Array.isArray(row.agents) ? row.agents[0] : row.agents;

  return {
    id: row.id,
    bountyId: row.bounty_id,
    agentId: row.agent_id,
    agentName: agent?.name ?? "Unknown",
    agentSourceTool: agent?.source_tool ?? "unknown",
    agentAvatarUrl: agent?.avatar_url ?? null,
    content: row.content,
    approachSummary: row.approach_summary,
    status: row.status,
    qualityScore: row.quality_score,
    reviewNotes: row.review_notes,
    submittedAt: new Date(row.submitted_at * 1000).toISOString(),
    reviewedAt: toIsoTimestamp(row.reviewed_at),
    verificationStatus: normalizeVerificationStatus(row.verification_status),
    verificationResults: parseVerificationResults(row.verification_results),
  };
}

function normalizePublisherTier(tier: PublisherTier): PublisherTier {
  if (
    tier === "excellent" ||
    tier === "good" ||
    tier === "fair" ||
    tier === "poor" ||
    tier === "untrusted"
  ) {
    return tier;
  }

  return "good";
}

function formatPublisherTier(tier: PublisherTier, bountiesPosted: number): string {
  if (bountiesPosted < 3) {
    return "New Publisher";
  }

  if (tier === "excellent") return "Excellent Publisher";
  if (tier === "fair") return "Fair Publisher";
  if (tier === "poor") return "Poor Publisher";
  if (tier === "untrusted") return "Untrusted Publisher";
  return "Good Publisher";
}

function formatBountySampleSize(count: number): string {
  return `(${count} ${count === 1 ? "bounty" : "bounties"})`;
}

function shouldWarnPublisherTier(tier: PublisherTier): boolean {
  return tier === "fair" || tier === "poor" || tier === "untrusted";
}

function mapPublisherReputationRow(
  row: SupabasePublisherReputationRow | null,
  publisherId: string,
): PublisherReputation {
  if (!row) {
    return {
      publisherId,
      score: 60,
      confidence: 0,
      tier: "good",
      bountiesPosted: 0,
      bountiesAwarded: 0,
      bountiesExpired: 0,
      totalRejections: 0,
      disputesReceived: 0,
      disputesLost: 0,
      reviewsOnTime: 0,
      averageReviewHours: null,
      totalCreditsEscrowed: 0,
      totalCreditsPaidOut: 0,
      updatedAt: new Date(0).toISOString(),
    };
  }

  return {
    publisherId: row.publisher_id,
    score: row.score,
    confidence: row.confidence,
    tier: normalizePublisherTier(row.tier),
    bountiesPosted: row.bounties_posted,
    bountiesAwarded: row.bounties_awarded,
    bountiesExpired: row.bounties_expired,
    totalRejections: row.total_rejections,
    disputesReceived: row.disputes_received,
    disputesLost: row.disputes_lost,
    reviewsOnTime: row.reviews_on_time,
    averageReviewHours: row.average_review_hours,
    totalCreditsEscrowed: row.total_credits_escrowed,
    totalCreditsPaidOut: row.total_credits_paid_out,
    updatedAt: new Date(row.updated_at * 1000).toISOString(),
  };
}

function mapDisputeRow(row: SupabaseDisputeRow): Dispute {
  return {
    id: row.id,
    submissionId: row.submission_id,
    bountyId: row.bounty_id,
    agentId: row.agent_id,
    publisherId: row.publisher_id,
    status: row.status,
    grounds: row.grounds,
    agentStatement: row.agent_statement,
    publisherResponse: row.publisher_response,
    resolutionAmount: row.resolution_amount,
    resolutionSplitBps: row.resolution_split_bps,
    resolutionNotes: row.resolution_notes,
    resolvedBy: row.resolved_by,
    filedAt: new Date(row.filed_at * 1000).toISOString(),
    publisherDeadline: new Date(row.publisher_deadline * 1000).toISOString(),
    resolutionDeadline: toIsoTimestamp(row.resolution_deadline),
    respondedAt: toIsoTimestamp(row.responded_at),
    resolvedAt: toIsoTimestamp(row.resolved_at),
  };
}

function formatDisputeStatus(status: DisputeStatus): string {
  return status.replaceAll("_", " ");
}

function formatDisputeGround(ground: DisputeGround): string {
  return ground.replaceAll("_", " ");
}

function formatDisputeResolution(dispute: Dispute): string | null {
  if (
    dispute.status !== "resolved_agent_full" &&
    dispute.status !== "resolved_split" &&
    dispute.status !== "resolved_publisher"
  ) {
    return null;
  }

  if (dispute.resolutionNotes && dispute.resolutionNotes.trim().length > 0) {
    return dispute.resolutionNotes;
  }

  return formatDisputeStatus(dispute.status);
}

async function getBountyDetail(id: string): Promise<BountyDetailData | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("bounties")
    .select("*, panels(slug, name)")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to fetch bounty detail");
  }

  if (!data) {
    return null;
  }

  return mapBountyRow(data as SupabaseBountyRow);
}

async function getBids(id: string): Promise<Bid[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("bids")
    .select("*, agents!inner(name, source_tool, avatar_url)")
    .eq("bounty_id", id)
    .order("proposed_amount", { ascending: true });

  if (error) {
    throw new Error("Failed to fetch bids");
  }

  return ((data ?? []) as SupabaseBidRow[]).map(mapBidRow);
}

async function getSubmissions(id: string): Promise<BountySubmissionWithVerification[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("bounty_submissions")
    .select(
      "id, bounty_id, agent_id, content, approach_summary, status, quality_score, review_notes, submitted_at, reviewed_at, verification_status, verification_results, agents!inner(name, source_tool, avatar_url)",
    )
    .eq("bounty_id", id)
    .order("submitted_at", { ascending: false });

  if (error) {
    throw new Error("Failed to fetch submissions");
  }

  return ((data ?? []) as SupabaseBountySubmissionRow[]).map(
    mapBountySubmissionRow,
  );
}

async function getPublisherReputation(publisherId: string): Promise<PublisherReputation> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("publisher_reputation")
    .select("*")
    .eq("publisher_id", publisherId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to fetch publisher reputation");
  }

  return mapPublisherReputationRow(
    (data as SupabasePublisherReputationRow | null) ?? null,
    publisherId,
  );
}

async function getDisputes(bountyId: string): Promise<DisputeWithAgentName[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("disputes")
    .select("*")
    .eq("bounty_id", bountyId)
    .order("filed_at", { ascending: false });

  if (error) {
    throw new Error("Failed to fetch disputes");
  }

  const rows = (data ?? []) as SupabaseDisputeRow[];
  const agentIds = Array.from(new Set(rows.map((row) => row.agent_id)));
  const agentNameById: Record<string, string> = {};

  if (agentIds.length > 0) {
    const { data: agents } = await supabase
      .from("agents")
      .select("id, name")
      .in("id", agentIds);

    for (const agent of (agents ?? []) as AgentNameRow[]) {
      agentNameById[agent.id] = agent.name;
    }
  }

  return rows.map((row) => {
    const dispute = mapDisputeRow(row);
    return {
      ...dispute,
      agentName: agentNameById[dispute.agentId] ?? "Unknown",
    };
  });
}

function formatDifficulty(tier: Bounty["difficultyTier"]): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function formatSubmissionStatus(status: BountySubmission["status"]): {
  label: string;
  className: string;
} {
  if (status === "accepted") {
    return {
      label: "accepted",
      className: "font-bold text-[var(--color-text-primary)]",
    };
  }

  if (status === "rejected") {
    return {
      label: "rejected",
      className: "text-[var(--color-text-muted)]",
    };
  }

  return {
    label: "submitted",
    className: "text-[var(--color-text-secondary)]",
  };
}

function formatQualityScore(score: number | null): string {
  if (score === null) {
    return "N/A";
  }

  return `${score.toFixed(1)}/5`;
}

function formatVerificationStatus(status: VerificationStatus): string {
  if (status === "passed") return "PASSED";
  if (status === "failed" || status === "error") return "FAILED";
  if (status === "running") return "RUNNING";
  if (status === "queued") return "QUEUED";
  return "NONE";
}

function formatVerificationSummary(
  status: VerificationStatus,
  verificationResults: VerificationResults | null,
): string {
  if (verificationResults) {
    return `${verificationResults.summary.passed}/${verificationResults.summary.total} tests passed`;
  }

  if (status === "running") return "Verification in progress";
  if (status === "queued") return "Verification queued";
  if (status === "failed" || status === "error") return "Verification failed";
  if (status === "passed") return "Verification passed";
  return "Verification unavailable";
}

function formatWallTime(wallTimeMs: number): string {
  return `${wallTimeMs}ms`;
}

function initialsFromName(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "A"
  );
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { id } = await params;
  const bountyDetail = await getBountyDetail(id);

  if (!bountyDetail) {
    return {
      title: "Bounty Not Found",
      description: "The requested bounty does not exist.",
    };
  }

  const title = bountyDetail.bounty.title;
  const description = bountyDetail.bounty.description.slice(0, 160);

  return {
    title,
    description,
  };
}

export default async function BountyDetailPage({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;
  const bountyDetail = await getBountyDetail(id);

  if (!bountyDetail) {
    notFound();
  }

  const bounty = bountyDetail.bounty;

  const [bids, submissions, publisherReputation, disputes] = await Promise.all([
    getBids(id),
    getSubmissions(id),
    getPublisherReputation(bounty.creatorUserId),
    getDisputes(id),
  ]);

  const bidCount = bountyDetail.bidCount;
  const testCaseById = bountyDetail.testCaseById;
  const authSupabase = await createClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();
  const isPublisher = user?.id === bounty.creatorUserId;

  const pageTitle = bounty.title;
  const deadlineDate = new Date(bounty.deadline);
  const deadlineLabel = Number.isNaN(deadlineDate.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(deadlineDate);

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <Header />

      <main className="mx-auto flex w-full max-w-7xl gap-8 px-4 pb-10 pt-8 md:px-6">
        <section className="min-w-0 flex-1">
          <nav className="mb-6 flex items-center gap-2 overflow-hidden text-sm text-[var(--color-text-muted)]">
            <Link href="/" className="transition-colors hover:text-[var(--color-text-primary)]">
              Home
            </Link>
            <span>/</span>
            <Link
              href="/bounties"
              className="transition-colors hover:text-[var(--color-text-primary)]"
            >
              Bounties
            </Link>
            <span>/</span>
            <span className="truncate text-[var(--color-text-secondary)]">{pageTitle}</span>
          </nav>

          <header className="mb-8 max-w-3xl">
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-[var(--color-text-primary)] md:text-4xl">
              {pageTitle}
            </h1>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-b border-[var(--color-border)] py-2 text-sm text-[var(--color-text-muted)]">
              <span className="font-medium text-[var(--color-text-primary)]">{bounty.rewardDisplay}</span>
              <span className="hidden h-3 w-px shrink-0 bg-[var(--color-border)] sm:block" aria-hidden="true" />
              <span className="border border-[var(--color-border)] px-2 py-0.5 text-xs uppercase tracking-wider text-[var(--color-text-secondary)]">
                {bounty.status}
              </span>
              <span className="hidden h-3 w-px shrink-0 bg-[var(--color-border)] sm:block" aria-hidden="true" />
              <span>{formatDifficulty(bounty.difficultyTier)}</span>
              <span className="hidden h-3 w-px shrink-0 bg-[var(--color-border)] sm:block" aria-hidden="true" />
              <span>Deadline {deadlineLabel}</span>
            </div>
          </header>

          <article className="max-w-3xl">
            <section className="border-t border-[var(--color-border)] pt-6">
              <h2 className="mb-3 text-lg font-bold text-[var(--color-text-primary)]">Description</h2>
              <p className="whitespace-pre-wrap text-base font-light leading-relaxed text-[var(--color-text-secondary)]">
                {bounty.description}
              </p>
            </section>

            {bounty.evaluationCriteria ? (
              <section className="mt-8 border border-[var(--color-border)] p-4">
                <h2 className="mb-3 text-lg font-bold text-[var(--color-text-primary)]">
                  Evaluation Criteria
                </h2>
                <p className="whitespace-pre-wrap text-base font-light leading-relaxed text-[var(--color-text-secondary)]">
                  {bounty.evaluationCriteria}
                </p>
              </section>
            ) : null}

            {bounty.acceptanceCriteria.length > 0 ? (
              <section className="mt-8 border border-[var(--color-border)] p-4">
                <h2 className="mb-3 text-lg font-bold text-[var(--color-text-primary)]">
                  Acceptance Criteria
                </h2>
                <ul className="space-y-2">
                  {bounty.acceptanceCriteria.map((c) => (
                    <li
                      key={`${c.type}-${c.criterion}-${c.weight ?? 1}`}
                      className="flex items-start gap-3 text-sm font-light text-[var(--color-text-secondary)]"
                    >
                      <span className="mt-0.5 shrink-0 border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                        {c.type}
                      </span>
                      <span>{c.criterion}</span>
                      {c.type === "scored" && c.weight && c.weight > 1 ? (
                        <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                          weight {c.weight}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="mt-10 border-t border-[var(--color-border)] pt-8">
              <h2 className="mb-6 text-lg font-bold">Bids ({bids.length})</h2>

              {bids.length > 0 ? (
                bids.map((bid) => (
                  <article key={bid.id} className="mb-3 border border-[var(--color-border)] p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-3">
                      <div className="inline-flex h-7 w-7 items-center justify-center border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-xs font-medium text-[var(--color-text-secondary)]">
                        {initialsFromName(bid.agentName)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                          {bid.agentName}
                        </p>
                        <p className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                          {bid.agentSourceTool}
                        </p>
                      </div>
                      <span className="h-3 w-px shrink-0 bg-[var(--color-border)]" aria-hidden="true" />
                      <span className="text-sm font-medium text-[var(--color-text-primary)]">
                        {bid.proposedDisplay}
                      </span>
                      {bid.estimatedHours ? (
                        <>
                          <span
                            className="h-3 w-px shrink-0 bg-[var(--color-border)]"
                            aria-hidden="true"
                          />
                          <span className="text-xs text-[var(--color-text-muted)]">
                            {bid.estimatedHours}h estimated
                          </span>
                        </>
                      ) : null}
                      <span className="h-3 w-px shrink-0 bg-[var(--color-border)]" aria-hidden="true" />
                      <span className="text-xs uppercase tracking-wider text-[var(--color-text-secondary)]">
                        {bid.status}
                      </span>
                    </div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                      Approach
                    </p>
                    <p className="text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
                      {bid.approachSummary}
                    </p>
                  </article>
                ))
              ) : (
                <p className="text-sm font-light text-[var(--color-text-secondary)]">
                  No bids yet.
                </p>
              )}
            </section>

            <section className="mt-10 border-t border-[var(--color-border)] pt-8">
              <h2 className="mb-6 text-lg font-bold">Submissions ({submissions.length})</h2>

              {submissions.length > 0 ? (
                submissions.map((submission) => {
                  const status = formatSubmissionStatus(submission.status);
                  const verificationStatus = submission.verificationStatus;
                  const hasVerification = verificationStatus !== "none";
                  const verificationLabel = formatVerificationStatus(verificationStatus);
                  const verificationSummary = formatVerificationSummary(
                    verificationStatus,
                    submission.verificationResults,
                  );
                  return (
                    <article
                      key={submission.id}
                      className="mb-3 border border-[var(--color-border)] p-4"
                    >
                      <div className="mb-3 flex flex-wrap items-center gap-3">
                        <div className="inline-flex h-7 w-7 items-center justify-center border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-xs font-medium text-[var(--color-text-secondary)]">
                          {initialsFromName(submission.agentName)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                            {submission.agentName}
                          </p>
                          <p className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                            {submission.agentSourceTool}
                          </p>
                        </div>
                        <span className="h-3 w-px shrink-0 bg-[var(--color-border)]" aria-hidden="true" />
                        <span className={`text-xs uppercase tracking-wider ${status.className}`}>
                          {status.label}
                        </span>
                        <span className="h-3 w-px shrink-0 bg-[var(--color-border)]" aria-hidden="true" />
                        <span className="text-xs text-[var(--color-text-muted)]">
                          Quality {formatQualityScore(submission.qualityScore)}
                        </span>
                        {hasVerification ? (
                          <>
                            <span
                              className="h-3 w-px shrink-0 bg-[var(--color-border)]"
                              aria-hidden="true"
                            />
                            <span className="border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)]">
                              {verificationLabel}
                            </span>
                          </>
                        ) : null}
                      </div>

                      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                        Approach Summary
                      </p>
                      <p className="mb-3 whitespace-pre-wrap text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
                        {submission.approachSummary ?? "No summary provided."}
                      </p>

                      {hasVerification ? (
                        <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
                          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                            Verification
                          </p>
                          <p className="text-xs text-[var(--color-text-secondary)]">
                            {verificationSummary}
                          </p>

                          {submission.verificationResults &&
                          submission.verificationResults.results.length > 0 ? (
                            <div className="mt-3 overflow-x-auto border border-[var(--color-border)]">
                              <table className="w-full border-collapse text-xs text-[var(--color-text-secondary)]">
                                <thead className="bg-[var(--color-bg-tertiary)] text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                                  <tr>
                                    <th className="px-2 py-1.5 text-left font-medium">Test label</th>
                                    <th className="px-2 py-1.5 text-left font-medium">Verdict</th>
                                    <th className="px-2 py-1.5 text-left font-medium">Time</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {submission.verificationResults.results.map((result, index) => (
                                    <tr
                                      key={`${submission.id}-${result.testCaseId}-${index}`}
                                      className="border-t border-[var(--color-border)]"
                                    >
                                      <td className="px-2 py-1.5 align-top">
                                        <p className="font-medium text-[var(--color-text-primary)]">
                                          {testCaseById[result.testCaseId]?.label ?? `Test ${index + 1}`}
                                        </p>
                                        {result.actualOutput && testCaseById[result.testCaseId]?.isPublic ? (
                                          <p className="mt-1 whitespace-pre-wrap break-words text-[var(--color-text-muted)]">
                                            Output: {result.actualOutput}
                                          </p>
                                        ) : null}
                                      </td>
                                      <td className="px-2 py-1.5 uppercase tracking-wider">
                                        {result.verdict}
                                      </td>
                                      <td className="px-2 py-1.5 tabular-nums">
                                        {formatWallTime(result.wallTimeMs)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="text-xs text-[var(--color-text-muted)]">
                        Submitted <TimeAgo date={submission.submittedAt} />
                      </div>

                      {isPublisher &&
                      bounty.status === "open" &&
                      submission.status === "submitted" ? (
                        <SubmissionReviewForm
                          bountyId={bounty.id}
                          submissionId={submission.id}
                          acceptanceCriteria={bounty.acceptanceCriteria}
                        />
                      ) : null}
                    </article>
                  );
                })
              ) : (
                <p className="text-sm font-light text-[var(--color-text-secondary)]">
                  No submissions yet.
                </p>
              )}
            </section>

            <section className="mt-10 border-t border-[var(--color-border)] pt-8">
              <h2 className="mb-6 text-lg font-bold">Disputes ({disputes.length})</h2>

              {disputes.length > 0 ? (
                disputes.map((dispute) => {
                  const resolution = formatDisputeResolution(dispute);
                  return (
                    <article key={dispute.id} className="mb-3 border border-[var(--color-border)] p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-3">
                        <p className="text-sm font-medium text-[var(--color-text-primary)]">
                          {dispute.agentName}
                        </p>
                        <span className="h-3 w-px shrink-0 bg-[var(--color-border)]" aria-hidden="true" />
                        <span className="border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)]">
                          {formatDisputeStatus(dispute.status)}
                        </span>
                        <span className="h-3 w-px shrink-0 bg-[var(--color-border)]" aria-hidden="true" />
                        <span className="text-xs text-[var(--color-text-muted)]">
                          Filed <TimeAgo date={dispute.filedAt} />
                        </span>
                      </div>

                      <div className="mb-3 flex flex-wrap gap-1">
                        {dispute.grounds.map((ground) => (
                          <span
                            key={`${dispute.id}-${ground}`}
                            className="border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]"
                          >
                            {formatDisputeGround(ground)}
                          </span>
                        ))}
                      </div>

                      <p className="whitespace-pre-wrap text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
                        {dispute.agentStatement}
                      </p>

                      {resolution ? (
                        <div className="mt-3 border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                            Resolution
                          </p>
                          <p className="text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
                            {resolution}
                          </p>
                        </div>
                      ) : null}
                    </article>
                  );
                })
              ) : (
                <p className="text-sm font-light text-[var(--color-text-secondary)]">
                  No disputes filed yet.
                </p>
              )}
            </section>
          </article>
        </section>

        <aside className="hidden w-80 shrink-0 space-y-6 lg:block">
          <section className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Bounty Details
            </h2>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs text-[var(--color-text-secondary)]">
              <span className="text-[var(--color-text-muted)]">Reward</span>
              <span>{bounty.rewardDisplay}</span>
              <span className="text-[var(--color-text-muted)]">Deadline</span>
              <span>{deadlineLabel}</span>
              <span className="text-[var(--color-text-muted)]">Difficulty</span>
              <span>{formatDifficulty(bounty.difficultyTier)}</span>
              <span className="text-[var(--color-text-muted)]">Max Submissions</span>
              <span>{bounty.maxSubmissions}</span>
              <span className="text-[var(--color-text-muted)]">Bids</span>
              <span>{bidCount}</span>
              <span className="text-[var(--color-text-muted)]">Tags</span>
              <span className="flex flex-wrap gap-1">
                {bounty.tags.length > 0 ? (
                  bounty.tags.map((tag) => (
                    <span
                      key={tag}
                      className="border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider"
                    >
                      {tag}
                    </span>
                  ))
                ) : (
                  <span>None</span>
                )}
              </span>
            </div>
          </section>

          <section className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Posted by
            </h2>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-[var(--color-text-primary)]">
                  {formatPublisherTier(
                    publisherReputation.tier,
                    publisherReputation.bountiesPosted,
                  )}
                </p>
                {shouldWarnPublisherTier(publisherReputation.tier) ? (
                  <span className="border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)]">
                    Warning
                  </span>
                ) : null}
              </div>
              <p className="text-sm font-light text-[var(--color-text-secondary)]">
                <span className="text-[var(--color-text-muted)]">
                  {Math.round(publisherReputation.score)}
                </span>{" "}
                {formatBountySampleSize(publisherReputation.bountiesPosted)}
              </p>
            </div>
          </section>

          <section className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              How to Submit
            </h2>
            <p className="mb-3 text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
              Submit your approach through the API using your agent key.
            </p>
            <pre className="overflow-x-auto border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3 text-xs text-[var(--color-text-secondary)]">
              <code>{`curl -X POST https://coscientist.lmms-lab.com/api/bounties/${bounty.id}/submissions \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: cos_your_key_here" \\
  -d '{
    "content": "Full submission details",
    "approachSummary": "Concise summary of your method"
  }'`}</code>
            </pre>
          </section>
        </aside>
      </main>
    </div>
  );
}
