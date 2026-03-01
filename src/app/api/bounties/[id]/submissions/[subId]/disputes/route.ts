import { nanoid } from "nanoid";
import { authenticateAgent } from "@/lib/agent-auth";
import { canTransitionStatus } from "@/lib/bounty-logic";
import { PUBLISHER_RESPONSE_WINDOW } from "@/lib/dispute-logic";
import { getSupabase } from "@/lib/supabase";
import type {
  BountyStatus,
  Dispute,
  DisputeGround,
  DisputeStatus,
  EvidenceType,
} from "@/types/bounty";
import type { ApiResponse } from "@/types/index";

interface SubmissionRow {
  id: string;
  bounty_id: string;
  agent_id: string;
  status: "submitted" | "accepted" | "rejected";
  dispute_deadline_at: number | null;
}

interface BountyRow {
  id: string;
  creator_user_id: string;
  status: BountyStatus;
}

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

type ParsedEvidence = {
  artifactType: EvidenceType;
  content: string;
  criterionIndex: number | null;
};

const VALID_GROUNDS: DisputeGround[] = [
  "criteria_met",
  "criteria_ambiguous",
  "rejection_unexplained",
  "partial_credit",
  "tests_passed",
];

const VALID_EVIDENCE_TYPES: EvidenceType[] = [
  "text",
  "url",
  "github_commit",
  "verification_result",
  "criterion_response",
];

function isDisputeGround(value: string): value is DisputeGround {
  return (VALID_GROUNDS as readonly string[]).includes(value);
}

function isEvidenceType(value: string): value is EvidenceType {
  return (VALID_EVIDENCE_TYPES as readonly string[]).includes(value);
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; subId: string }> },
): Promise<Response> {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) {
      return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    }

    const { id: bountyId, subId: submissionId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
    }

    if (typeof body !== "object" || body === null) {
      return jsonResponse({ ok: false, error: "Request body must be a JSON object." }, 400);
    }

    const payload = body as Record<string, unknown>;

    const groundsRaw = Array.isArray(payload.grounds) ? payload.grounds : null;
    if (!groundsRaw || groundsRaw.length === 0) {
      return jsonResponse({ ok: false, error: "grounds must be a non-empty array." }, 400);
    }

    const parsedGrounds: DisputeGround[] = [];
    for (const ground of groundsRaw) {
      if (typeof ground !== "string" || !isDisputeGround(ground)) {
        return jsonResponse({ ok: false, error: "grounds contains an invalid dispute code." }, 400);
      }
      parsedGrounds.push(ground);
    }

    const agentStatement =
      typeof payload.agentStatement === "string"
        ? payload.agentStatement.trim()
        : "";

    if (!agentStatement) {
      return jsonResponse({ ok: false, error: "agentStatement is required." }, 400);
    }

    if (agentStatement.length > 10000) {
      return jsonResponse({ ok: false, error: "agentStatement must be at most 10000 characters." }, 400);
    }

    const parsedEvidence: ParsedEvidence[] = [];
    if (payload.evidence !== undefined) {
      if (!Array.isArray(payload.evidence)) {
        return jsonResponse({ ok: false, error: "evidence must be an array." }, 400);
      }

      for (const item of payload.evidence) {
        if (typeof item !== "object" || item === null) {
          return jsonResponse({ ok: false, error: "Each evidence item must be an object." }, 400);
        }

        const evidenceItem = item as Record<string, unknown>;
        const artifactType = evidenceItem.artifactType;
        const content =
          typeof evidenceItem.content === "string"
            ? evidenceItem.content.trim()
            : "";
        const criterionIndex = evidenceItem.criterionIndex;

        if (typeof artifactType !== "string" || !isEvidenceType(artifactType)) {
          return jsonResponse({ ok: false, error: "evidence.artifactType is invalid." }, 400);
        }

        if (!content) {
          return jsonResponse({ ok: false, error: "evidence.content is required." }, 400);
        }

        if (content.length > 20000) {
          return jsonResponse({ ok: false, error: "evidence.content must be at most 20000 characters." }, 400);
        }

        if (
          criterionIndex !== undefined &&
          (typeof criterionIndex !== "number" ||
            !Number.isInteger(criterionIndex) ||
            criterionIndex < 0)
        ) {
          return jsonResponse({ ok: false, error: "evidence.criterionIndex must be a non-negative integer." }, 400);
        }

        parsedEvidence.push({
          artifactType,
          content,
          criterionIndex:
            typeof criterionIndex === "number" ? criterionIndex : null,
        });
      }
    }

    const supabase = getSupabase();
    const now = Math.floor(Date.now() / 1000);

    const { data: submissionData, error: submissionError } = await supabase
      .from("bounty_submissions")
      .select("id, bounty_id, agent_id, status, dispute_deadline_at")
      .eq("id", submissionId)
      .maybeSingle();

    if (submissionError) {
      return jsonResponse({ ok: false, error: "Failed to file dispute." }, 500);
    }

    const submission = submissionData as SubmissionRow | null;
    if (!submission) {
      return jsonResponse({ ok: false, error: "Submission not found." }, 404);
    }

    if (submission.bounty_id !== bountyId) {
      return jsonResponse({ ok: false, error: "Submission does not belong to this bounty." }, 400);
    }

    if (submission.status !== "rejected") {
      return jsonResponse({ ok: false, error: "Only rejected submissions can be disputed." }, 400);
    }

    if (submission.agent_id !== agent.id) {
      return jsonResponse({ ok: false, error: "You can only dispute your own submission." }, 403);
    }

    if (
      typeof submission.dispute_deadline_at !== "number" ||
      submission.dispute_deadline_at <= now
    ) {
      return jsonResponse({ ok: false, error: "Dispute filing window has expired." }, 400);
    }

    const { data: existingDisputeData, error: existingDisputeError } = await supabase
      .from("disputes")
      .select("id")
      .eq("submission_id", submissionId)
      .maybeSingle();

    if (existingDisputeError) {
      return jsonResponse({ ok: false, error: "Failed to file dispute." }, 500);
    }

    if (existingDisputeData) {
      return jsonResponse({ ok: false, error: "A dispute already exists for this submission." }, 409);
    }

    const { data: bountyData, error: bountyError } = await supabase
      .from("bounties")
      .select("id, creator_user_id, status")
      .eq("id", bountyId)
      .maybeSingle();

    if (bountyError) {
      return jsonResponse({ ok: false, error: "Failed to file dispute." }, 500);
    }

    const bounty = bountyData as BountyRow | null;
    if (!bounty) {
      return jsonResponse({ ok: false, error: "Bounty not found." }, 404);
    }

    if (
      bounty.status !== "disputed" &&
      !canTransitionStatus(bounty.status, "disputed")
    ) {
      return jsonResponse({ ok: false, error: "Bounty cannot transition to disputed status." }, 400);
    }

    const disputeId = nanoid();
    const publisherDeadline = now + PUBLISHER_RESPONSE_WINDOW;

    const { data: createdDisputeData, error: createDisputeError } = await supabase
      .from("disputes")
      .insert({
        id: disputeId,
        submission_id: submissionId,
        bounty_id: bountyId,
        agent_id: agent.id,
        publisher_id: bounty.creator_user_id,
        status: "filed",
        grounds: parsedGrounds,
        agent_statement: agentStatement,
        filed_at: now,
        publisher_deadline: publisherDeadline,
        created_at: now,
      })
      .select("*")
      .single();

    if (createDisputeError) {
      if (createDisputeError.code === "23505") {
        return jsonResponse({ ok: false, error: "A dispute already exists for this submission." }, 409);
      }
      return jsonResponse({ ok: false, error: "Failed to file dispute." }, 500);
    }

    if (parsedEvidence.length > 0) {
      const { error: evidenceError } = await supabase
        .from("dispute_evidence")
        .insert(
          parsedEvidence.map((entry) => ({
            id: nanoid(),
            dispute_id: disputeId,
            submitted_by: agent.id,
            party: "agent",
            artifact_type: entry.artifactType,
            content: entry.content,
            criterion_index: entry.criterionIndex,
            submitted_at: now,
          })),
        );

      if (evidenceError) {
        return jsonResponse({ ok: false, error: "Failed to file dispute." }, 500);
      }
    }

    if (bounty.status !== "disputed") {
      const { error: updateBountyError } = await supabase
        .from("bounties")
        .update({ status: "disputed", updated_at: now })
        .eq("id", bountyId);

      if (updateBountyError) {
        return jsonResponse({ ok: false, error: "Failed to file dispute." }, 500);
      }
    }

    const createdDispute = createdDisputeData as DisputeRow | null;
    if (!createdDispute) {
      return jsonResponse({ ok: false, error: "Failed to file dispute." }, 500);
    }

    return jsonResponse(
      {
        ok: true,
        data: mapDispute(createdDispute),
      },
      201,
    );
  } catch {
    return jsonResponse({ ok: false, error: "Failed to file dispute." }, 500);
  }
}
