import { isAdmin } from "@/lib/agent-auth";
import { getSupabase } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { DISPUTE_FILING_WINDOW } from "@/lib/dispute-logic";
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; subId: string }> },
): Promise<Response> {
  try {
    const { id: bountyId, subId: submissionId } = await params;

    // Parse body
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
    const rejectionReason = typeof payload.rejectionReason === "string"
      ? payload.rejectionReason.trim()
      : "";

    if (!rejectionReason) {
      return jsonResponse(
        { ok: false, error: "rejectionReason is required. Provide a clear explanation for the rejection." },
        400,
      );
    }

    if (rejectionReason.length < 10) {
      return jsonResponse(
        { ok: false, error: "rejectionReason must be at least 10 characters." },
        400,
      );
    }

    if (rejectionReason.length > 5000) {
      return jsonResponse(
        { ok: false, error: "rejectionReason must be at most 5000 characters." },
        400,
      );
    }

    const supabase = getSupabase();

    // Fetch bounty
    const { data: bounty, error: bountyError } = await supabase
      .from("bounties")
      .select("id, creator_user_id, status")
      .eq("id", bountyId)
      .maybeSingle();

    if (bountyError) {
      return jsonResponse({ ok: false, error: "Failed to reject submission." }, 500);
    }

    if (!bounty) {
      return jsonResponse({ ok: false, error: "Bounty not found." }, 404);
    }

    // Auth: only bounty creator or admin
    const authSupabase = await createClient();
    const {
      data: { user },
    } = await authSupabase.auth.getUser();
    const userId = user?.id ?? null;

    if (!isAdmin(request) && userId !== bounty.creator_user_id) {
      return jsonResponse({ ok: false, error: "Only the bounty creator can reject submissions." }, 403);
    }

    if (bounty.status !== "open") {
      return jsonResponse({ ok: false, error: "Bounty is not open." }, 400);
    }

    // Fetch submission
    const { data: submission, error: submissionError } = await supabase
      .from("bounty_submissions")
      .select("id, bounty_id, agent_id, status")
      .eq("id", submissionId)
      .maybeSingle();

    if (submissionError) {
      return jsonResponse({ ok: false, error: "Failed to reject submission." }, 500);
    }

    if (!submission) {
      return jsonResponse({ ok: false, error: "Submission not found." }, 404);
    }

    if (submission.bounty_id !== bountyId) {
      return jsonResponse({ ok: false, error: "Submission does not belong to this bounty." }, 400);
    }

    if (submission.status !== "submitted") {
      return jsonResponse({ ok: false, error: "Submission is not in submitted status." }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    const disputeDeadlineAt = now + DISPUTE_FILING_WINDOW;

    // Update submission to rejected
    const { error: rejectError } = await supabase
      .from("bounty_submissions")
      .update({
        status: "rejected",
        rejection_reason: rejectionReason,
        reviewed_at: now,
        dispute_deadline_at: disputeDeadlineAt,
      })
      .eq("id", submissionId);

    if (rejectError) {
      return jsonResponse({ ok: false, error: "Failed to reject submission." }, 500);
    }

    // Update publisher reputation signals
    const { data: existingRep } = await supabase
      .from("publisher_reputation")
      .select("publisher_id, total_rejections")
      .eq("publisher_id", bounty.creator_user_id)
      .maybeSingle();

    if (existingRep) {
      await supabase
        .from("publisher_reputation")
        .update({
          total_rejections: existingRep.total_rejections + 1,
          updated_at: now,
        })
        .eq("publisher_id", bounty.creator_user_id);
    } else {
      await supabase.from("publisher_reputation").insert({
        publisher_id: bounty.creator_user_id,
        total_rejections: 1,
        updated_at: now,
      });
    }

    return jsonResponse({
      ok: true,
      data: {
        bountyId,
        submissionId,
        agentId: submission.agent_id,
        status: "rejected",
        rejectionReason,
        disputeDeadlineAt: new Date(disputeDeadlineAt * 1000).toISOString(),
      },
    });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to reject submission." }, 500);
  }
}
