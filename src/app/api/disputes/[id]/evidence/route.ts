import { nanoid } from "nanoid";
import { authenticateAgent } from "@/lib/agent-auth";
import { isDisputeTerminal } from "@/lib/dispute-logic";
import { getSupabase } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import type { DisputeEvidence, DisputeStatus, EvidenceType } from "@/types/bounty";
import type { ApiResponse } from "@/types/index";

interface DisputeRow {
  id: string;
  agent_id: string;
  publisher_id: string;
  status: DisputeStatus;
  publisher_deadline: number;
  resolution_deadline: number | null;
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

const VALID_EVIDENCE_TYPES: EvidenceType[] = [
  "text",
  "url",
  "github_commit",
  "verification_result",
  "criterion_response",
];

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: disputeId } = await params;
    const now = Math.floor(Date.now() / 1000);

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
    const artifactType = payload.artifactType;
    const content = typeof payload.content === "string" ? payload.content.trim() : "";
    const criterionIndex = payload.criterionIndex;

    if (typeof artifactType !== "string" || !isEvidenceType(artifactType)) {
      return jsonResponse({ ok: false, error: "artifactType is invalid." }, 400);
    }

    if (!content) {
      return jsonResponse({ ok: false, error: "content is required." }, 400);
    }

    if (content.length > 20000) {
      return jsonResponse({ ok: false, error: "content must be at most 20000 characters." }, 400);
    }

    if (
      criterionIndex !== undefined &&
      (typeof criterionIndex !== "number" ||
        !Number.isInteger(criterionIndex) ||
        criterionIndex < 0)
    ) {
      return jsonResponse({ ok: false, error: "criterionIndex must be a non-negative integer." }, 400);
    }

    const agent = await authenticateAgent(request);

    let submittedBy: string;
    let party: "agent" | "publisher";

    if (agent) {
      submittedBy = agent.id;
      party = "agent";
    } else {
      const authSupabase = await createClient();
      const {
        data: { user },
      } = await authSupabase.auth.getUser();

      if (!user) {
        return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
      }

      submittedBy = user.id;
      party = "publisher";
    }

    const supabase = getSupabase();
    const { data: disputeData, error: disputeError } = await supabase
      .from("disputes")
      .select("id, agent_id, publisher_id, status, publisher_deadline, resolution_deadline, resolved_at")
      .eq("id", disputeId)
      .maybeSingle();

    if (disputeError) {
      return jsonResponse({ ok: false, error: "Failed to submit evidence." }, 500);
    }

    const dispute = disputeData as DisputeRow | null;
    if (!dispute) {
      return jsonResponse({ ok: false, error: "Dispute not found." }, 404);
    }

    if (party === "agent" && dispute.agent_id !== submittedBy) {
      return jsonResponse({ ok: false, error: "Only the dispute agent can submit agent evidence." }, 403);
    }

    if (party === "publisher" && dispute.publisher_id !== submittedBy) {
      return jsonResponse({ ok: false, error: "Only the dispute publisher can submit publisher evidence." }, 403);
    }

    if (isDisputeTerminal(dispute.status)) {
      return jsonResponse({ ok: false, error: "Dispute is in a terminal state." }, 400);
    }

    const evidenceLocked =
      dispute.resolved_at !== null ||
      (dispute.status === "filed" && dispute.publisher_deadline <= now) ||
      (dispute.resolution_deadline !== null && dispute.resolution_deadline <= now);

    if (evidenceLocked) {
      return jsonResponse({ ok: false, error: "Evidence submission is locked for this dispute." }, 400);
    }

    const { data: insertedEvidenceData, error: insertEvidenceError } = await supabase
      .from("dispute_evidence")
      .insert({
        id: nanoid(),
        dispute_id: disputeId,
        submitted_by: submittedBy,
        party,
        artifact_type: artifactType,
        content,
        criterion_index: typeof criterionIndex === "number" ? criterionIndex : null,
        submitted_at: now,
      })
      .select("*")
      .single();

    if (insertEvidenceError) {
      return jsonResponse({ ok: false, error: "Failed to submit evidence." }, 500);
    }

    const insertedEvidence = insertedEvidenceData as DisputeEvidenceRow | null;
    if (!insertedEvidence) {
      return jsonResponse({ ok: false, error: "Failed to submit evidence." }, 500);
    }

    return jsonResponse({ ok: true, data: mapEvidence(insertedEvidence) }, 201);
  } catch {
    return jsonResponse({ ok: false, error: "Failed to submit evidence." }, 500);
  }
}
