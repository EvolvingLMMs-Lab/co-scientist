import { nanoid } from "nanoid";
import { isAdmin } from "@/lib/agent-auth";
import { getSupabase } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import type { AwardBountyRequest } from "@/types/bounty";
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
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
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

    type AwardBountyBody = AwardBountyRequest & {
      criteriaScores?: unknown[];
    };

    const payload = body as Partial<AwardBountyBody>;
    const submissionId = typeof payload.submissionId === "string" ? payload.submissionId.trim() : "";
    const qualityScore = payload.qualityScore;
    const reviewNotes = payload.reviewNotes;
    const criteriaScores = payload.criteriaScores;

    if (!submissionId) {
      return jsonResponse({ ok: false, error: "submissionId is required." }, 400);
    }

    if (
      typeof qualityScore !== "number" ||
      !Number.isInteger(qualityScore) ||
      qualityScore < 1 ||
      qualityScore > 5
    ) {
      return jsonResponse({ ok: false, error: "qualityScore must be an integer between 1 and 5." }, 400);
    }

    if (reviewNotes !== undefined && typeof reviewNotes !== "string") {
      return jsonResponse({ ok: false, error: "reviewNotes must be a string." }, 400);
    }

    if (criteriaScores !== undefined && !Array.isArray(criteriaScores)) {
      return jsonResponse({ ok: false, error: "criteriaScores must be an array." }, 400);
    }

    const supabase = getSupabase();

    const { data: bounty, error: bountyError } = await supabase
      .from("bounties")
      .select("id, creator_user_id, status, reward_amount")
      .eq("id", bountyId)
      .maybeSingle();

    if (bountyError) {
      return jsonResponse({ ok: false, error: "Failed to award bounty." }, 500);
    }

    if (!bounty) {
      return jsonResponse({ ok: false, error: "Bounty not found." }, 404);
    }

    const authSupabase = await createClient();
    const {
      data: { user },
    } = await authSupabase.auth.getUser();
    const userId = user?.id ?? null;

    if (!isAdmin(request) && userId !== bounty.creator_user_id) {
      return jsonResponse({ ok: false, error: "Only the bounty creator can award submissions." }, 403);
    }

    if (bounty.status !== "open") {
      return jsonResponse({ ok: false, error: "Bounty is not open." }, 400);
    }

    const { data: submission, error: submissionError } = await supabase
      .from("bounty_submissions")
      .select("id, bounty_id, agent_id, status")
      .eq("id", submissionId)
      .maybeSingle();

    if (submissionError) {
      return jsonResponse({ ok: false, error: "Failed to award bounty." }, 500);
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

    const { error: acceptError } = await supabase
      .from("bounty_submissions")
      .update({
        status: "accepted",
        quality_score: qualityScore,
        review_notes: reviewNotes ?? null,
        criteria_scores: criteriaScores ?? null,
        reviewed_at: now,
      })
      .eq("id", submissionId);

    if (acceptError) {
      return jsonResponse({ ok: false, error: "Failed to award bounty." }, 500);
    }

    const { error: rejectOthersError } = await supabase
      .from("bounty_submissions")
      .update({
        status: "rejected",
        reviewed_at: now,
      })
      .eq("bounty_id", bountyId)
      .neq("id", submissionId)
      .eq("status", "submitted");

    if (rejectOthersError) {
      return jsonResponse({ ok: false, error: "Failed to award bounty." }, 500);
    }

    const { error: updateBountyError } = await supabase
      .from("bounties")
      .update({
        status: "awarded",
        awarded_submission_id: submissionId,
        updated_at: now,
      })
      .eq("id", bountyId);

    if (updateBountyError) {
      return jsonResponse({ ok: false, error: "Failed to award bounty." }, 500);
    }

    const payoutAmount = Math.floor(bounty.reward_amount * 0.9);
    const platformFee = bounty.reward_amount - payoutAmount;

    const { error: payoutTxError } = await supabase.from("transactions").insert({
      id: nanoid(),
      user_id: null,
      agent_id: submission.agent_id,
      bounty_id: bountyId,
      amount: payoutAmount,
      type: "bounty_payout",
      description: "Bounty award payout",
      created_at: now,
    });

    if (payoutTxError) {
      return jsonResponse({ ok: false, error: "Failed to award bounty." }, 500);
    }

    const { error: platformFeeTxError } = await supabase.from("transactions").insert({
      id: nanoid(),
      user_id: null,
      agent_id: null,
      bounty_id: bountyId,
      amount: platformFee,
      type: "platform_fee",
      description: "Platform fee (10%)",
      created_at: now,
    });

    if (platformFeeTxError) {
      return jsonResponse({ ok: false, error: "Failed to award bounty." }, 500);
    }

    const { data: wallet, error: walletError } = await supabase
      .from("agent_wallets")
      .select("agent_id, balance, tasks_completed")
      .eq("agent_id", submission.agent_id)
      .maybeSingle();

    if (walletError) {
      return jsonResponse({ ok: false, error: "Failed to award bounty." }, 500);
    }

    if (wallet) {
      const { error: updateWalletError } = await supabase
        .from("agent_wallets")
        .update({
          balance: wallet.balance + payoutAmount,
          tasks_completed: wallet.tasks_completed + 1,
          updated_at: now,
        })
        .eq("agent_id", submission.agent_id);

      if (updateWalletError) {
        return jsonResponse({ ok: false, error: "Failed to award bounty." }, 500);
      }
    } else {
      const { error: insertWalletError } = await supabase.from("agent_wallets").insert({
        agent_id: submission.agent_id,
        balance: payoutAmount,
        tasks_completed: 1,
        tasks_submitted: 0,
        updated_at: now,
      });

      if (insertWalletError) {
        return jsonResponse({ ok: false, error: "Failed to award bounty." }, 500);
      }
    }

    return jsonResponse({
      ok: true,
      data: {
        bountyId,
        submissionId,
        agentId: submission.agent_id,
        payoutAmount,
        platformFee,
        status: "awarded",
      },
    });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to award bounty." }, 500);
  }
}
