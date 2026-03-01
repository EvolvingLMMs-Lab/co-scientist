import { nanoid } from "nanoid";
import { authenticateAgent } from "@/lib/agent-auth";
import { getSupabase } from "@/lib/supabase";
import type { ApiResponse } from "@/types/index";

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("bounty_submissions")
      .select("*")
      .eq("bounty_id", id)
      .order("submitted_at", { ascending: false });

    if (error) {
      return jsonResponse({ ok: false, error: "Failed to fetch submissions." }, 500);
    }

    return jsonResponse({ ok: true, data: data ?? [] });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to fetch submissions." }, 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) {
      return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    }

    const { id: bountyId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
    }

    if (typeof body !== "object" || body === null) {
      return jsonResponse({ ok: false, error: "Request body must be a JSON object." }, 400);
    }

    const { content, approachSummary } = body as Record<string, unknown>;
    const trimmedContent = typeof content === "string" ? content.trim() : "";

    if (trimmedContent.length < 10 || trimmedContent.length > 50000) {
      return jsonResponse({ ok: false, error: "content must be between 10 and 50000 characters." }, 400);
    }

    if (
      approachSummary !== undefined &&
      (typeof approachSummary !== "string" || approachSummary.trim().length > 500)
    ) {
      return jsonResponse({ ok: false, error: "approachSummary must be at most 500 characters." }, 400);
    }

    const supabase = getSupabase();

    const { data: bounty, error: bountyError } = await supabase
      .from("bounties")
      .select("id, status, max_submissions, submission_count")
      .eq("id", bountyId)
      .maybeSingle();

    if (bountyError) {
      return jsonResponse({ ok: false, error: "Failed to create submission." }, 500);
    }

    if (!bounty) {
      return jsonResponse({ ok: false, error: "Bounty not found." }, 404);
    }

    if (bounty.status !== "open") {
      return jsonResponse({ ok: false, error: "Bounty is not open for submissions." }, 400);
    }

    if (bounty.submission_count >= bounty.max_submissions) {
      return jsonResponse({ ok: false, error: "Maximum submissions reached." }, 400);
    }

    const { data: existingSubmission, error: existingSubmissionError } = await supabase
      .from("bounty_submissions")
      .select("id")
      .eq("bounty_id", bountyId)
      .eq("agent_id", agent.id)
      .maybeSingle();

    if (existingSubmissionError) {
      return jsonResponse({ ok: false, error: "Failed to create submission." }, 500);
    }

    if (existingSubmission) {
      return jsonResponse({ ok: false, error: "You have already submitted to this bounty." }, 409);
    }

    const submissionId = nanoid();
    const submittedAt = Math.floor(Date.now() / 1000);
    const trimmedApproachSummary = typeof approachSummary === "string" ? approachSummary.trim() : null;

    const { error: insertError } = await supabase.from("bounty_submissions").insert({
      id: submissionId,
      bounty_id: bountyId,
      agent_id: agent.id,
      content: trimmedContent,
      approach_summary: trimmedApproachSummary || null,
      status: "submitted",
      quality_score: null,
      review_notes: null,
      criteria_scores: null,
      submitted_at: submittedAt,
      reviewed_at: null,
    });

    if (insertError) {
      return jsonResponse({ ok: false, error: "Failed to create submission." }, 500);
    }

    const { error: incrementError } = await supabase
      .from("bounties")
      .update({ submission_count: bounty.submission_count + 1 })
      .eq("id", bountyId);

    if (incrementError) {
      return jsonResponse({ ok: false, error: "Failed to create submission." }, 500);
    }

    return jsonResponse(
      {
        ok: true,
        data: {
          id: submissionId,
          bountyId,
          agentId: agent.id,
          content: trimmedContent,
          approachSummary: trimmedApproachSummary,
          status: "submitted",
          qualityScore: null,
          reviewNotes: null,
          submittedAt: toIsoDate(submittedAt),
          reviewedAt: null,
        },
      },
      201,
    );
  } catch {
    return jsonResponse({ ok: false, error: "Failed to create submission." }, 500);
  }
}
