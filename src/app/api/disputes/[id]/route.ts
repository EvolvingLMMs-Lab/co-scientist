import { getSupabase } from "@/lib/supabase";
import type {
  Dispute,
  DisputeEvidence,
  DisputeGround,
  DisputeStatus,
  EvidenceType,
} from "@/types/bounty";
import type { ApiResponse } from "@/types/index";

interface DisputeRow {
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
}

interface DisputeEvidenceRow {
  id: string;
  dispute_id: string;
  submitted_by: string;
  party: "agent" | "publisher" | "admin";
  artifact_type: EvidenceType;
  content: string;
  criterion_index: number | null;
  submitted_at: number;
}

interface SubmissionRow {
  id: string;
  bounty_id: string;
  agent_id: string;
  status: "submitted" | "accepted" | "rejected";
  rejection_reason: string | null;
  reviewed_at: number | null;
  dispute_deadline_at: number | null;
}

interface BountyRow {
  id: string;
  title: string;
  status: string;
  reward_amount: number;
  creator_user_id: string;
  deadline: number;
  review_deadline: number | null;
}

function jsonResponse(
  body: ApiResponse<unknown>,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function toIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function mapDispute(row: DisputeRow): Dispute {
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
    filedAt: toIsoDate(row.filed_at),
    publisherDeadline: toIsoDate(row.publisher_deadline),
    resolutionDeadline:
      row.resolution_deadline === null
        ? null
        : toIsoDate(row.resolution_deadline),
    respondedAt: row.responded_at === null ? null : toIsoDate(row.responded_at),
    resolvedAt: row.resolved_at === null ? null : toIsoDate(row.resolved_at),
  };
}

function mapEvidence(row: DisputeEvidenceRow): DisputeEvidence {
  return {
    id: row.id,
    disputeId: row.dispute_id,
    submittedBy: row.submitted_by,
    party: row.party,
    artifactType: row.artifact_type,
    content: row.content,
    criterionIndex: row.criterion_index,
    submittedAt: toIsoDate(row.submitted_at),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: disputeId } = await params;
    const supabase = getSupabase();

    const { data: disputeData, error: disputeError } = await supabase
      .from("disputes")
      .select("*")
      .eq("id", disputeId)
      .maybeSingle();

    if (disputeError) {
      return jsonResponse({ ok: false, error: "Failed to fetch dispute." }, 500);
    }

    const dispute = disputeData as DisputeRow | null;
    if (!dispute) {
      return jsonResponse({ ok: false, error: "Dispute not found." }, 404);
    }

    const { data: evidenceData, error: evidenceError } = await supabase
      .from("dispute_evidence")
      .select("*")
      .eq("dispute_id", disputeId)
      .order("submitted_at", { ascending: true });

    if (evidenceError) {
      return jsonResponse({ ok: false, error: "Failed to fetch dispute." }, 500);
    }

    const { data: submissionData, error: submissionError } = await supabase
      .from("bounty_submissions")
      .select("id, bounty_id, agent_id, status, rejection_reason, reviewed_at, dispute_deadline_at")
      .eq("id", dispute.submission_id)
      .maybeSingle();

    if (submissionError) {
      return jsonResponse({ ok: false, error: "Failed to fetch dispute." }, 500);
    }

    const { data: bountyData, error: bountyError } = await supabase
      .from("bounties")
      .select("id, title, status, reward_amount, creator_user_id, deadline, review_deadline")
      .eq("id", dispute.bounty_id)
      .maybeSingle();

    if (bountyError) {
      return jsonResponse({ ok: false, error: "Failed to fetch dispute." }, 500);
    }

    const submission = submissionData as SubmissionRow | null;
    const bounty = bountyData as BountyRow | null;
    const evidenceRows = (evidenceData ?? []) as DisputeEvidenceRow[];

    return jsonResponse({
      ok: true,
      data: {
        dispute: {
          ...mapDispute(dispute),
          submission: submission
            ? {
                id: submission.id,
                bountyId: submission.bounty_id,
                agentId: submission.agent_id,
                status: submission.status,
                rejectionReason: submission.rejection_reason,
                reviewedAt:
                  submission.reviewed_at === null
                    ? null
                    : toIsoDate(submission.reviewed_at),
                disputeDeadlineAt:
                  submission.dispute_deadline_at === null
                    ? null
                    : toIsoDate(submission.dispute_deadline_at),
              }
            : null,
          bounty: bounty
            ? {
                id: bounty.id,
                title: bounty.title,
                status: bounty.status,
                rewardAmount: bounty.reward_amount,
                creatorUserId: bounty.creator_user_id,
                deadline: toIsoDate(bounty.deadline),
                reviewDeadline:
                  bounty.review_deadline === null
                    ? null
                    : toIsoDate(bounty.review_deadline),
              }
            : null,
        },
        evidence: evidenceRows.map(mapEvidence),
      },
    });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to fetch dispute." }, 500);
  }
}
