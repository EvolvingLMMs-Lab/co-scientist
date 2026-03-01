import { nanoid } from "nanoid";
import { canTransitionDispute, ADMIN_RESOLUTION_WINDOW } from "@/lib/dispute-logic";
import { getSupabase } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import type {
  Dispute,
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

type ParsedEvidence = {
  artifactType: EvidenceType;
  content: string;
  criterionIndex: number | null;
};

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
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const authSupabase = await createClient();
    const {
      data: { user },
    } = await authSupabase.auth.getUser();

    if (!user) {
      return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    }

    const { id: disputeId } = await params;

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
    const rebuttal = typeof payload.rebuttal === "string" ? payload.rebuttal.trim() : "";

    if (!rebuttal) {
      return jsonResponse({ ok: false, error: "rebuttal is required." }, 400);
    }

    if (rebuttal.length > 10000) {
      return jsonResponse({ ok: false, error: "rebuttal must be at most 10000 characters." }, 400);
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

    const { data: disputeData, error: disputeError } = await supabase
      .from("disputes")
      .select("*")
      .eq("id", disputeId)
      .maybeSingle();

    if (disputeError) {
      return jsonResponse({ ok: false, error: "Failed to respond to dispute." }, 500);
    }

    const dispute = disputeData as DisputeRow | null;
    if (!dispute) {
      return jsonResponse({ ok: false, error: "Dispute not found." }, 404);
    }

    if (dispute.publisher_id !== user.id) {
      return jsonResponse({ ok: false, error: "Only the bounty publisher can respond to this dispute." }, 403);
    }

    if (dispute.status !== "filed") {
      return jsonResponse({ ok: false, error: "Only filed disputes can be responded to." }, 400);
    }

    if (!canTransitionDispute(dispute.status, "responded")) {
      return jsonResponse({ ok: false, error: "Dispute cannot transition to responded status." }, 400);
    }

    if (dispute.publisher_deadline <= now) {
      return jsonResponse({ ok: false, error: "Publisher response deadline has expired." }, 400);
    }

    const resolutionDeadline = now + ADMIN_RESOLUTION_WINDOW;

    const { data: updatedDisputeData, error: updateDisputeError } = await supabase
      .from("disputes")
      .update({
        status: "responded",
        publisher_response: rebuttal,
        responded_at: now,
        resolution_deadline: resolutionDeadline,
      })
      .eq("id", disputeId)
      .select("*")
      .single();

    if (updateDisputeError) {
      return jsonResponse({ ok: false, error: "Failed to respond to dispute." }, 500);
    }

    if (parsedEvidence.length > 0) {
      const { error: evidenceError } = await supabase
        .from("dispute_evidence")
        .insert(
          parsedEvidence.map((entry) => ({
            id: nanoid(),
            dispute_id: disputeId,
            submitted_by: user.id,
            party: "publisher",
            artifact_type: entry.artifactType,
            content: entry.content,
            criterion_index: entry.criterionIndex,
            submitted_at: now,
          })),
        );

      if (evidenceError) {
        return jsonResponse({ ok: false, error: "Failed to respond to dispute." }, 500);
      }
    }

    const updatedDispute = updatedDisputeData as DisputeRow | null;
    if (!updatedDispute) {
      return jsonResponse({ ok: false, error: "Failed to respond to dispute." }, 500);
    }

    return jsonResponse({ ok: true, data: mapDispute(updatedDispute) });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to respond to dispute." }, 500);
  }
}
