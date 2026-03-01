import { nanoid } from "nanoid";
import { isAdmin } from "@/lib/agent-auth";
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

/**
 * POST /api/bounties/expire
 *
 * Admin-only endpoint. Scans for bounties past their review deadline
 * (deadline + 7 days) and auto-expires them with escrow refund.
 *
 * Call this from a cron job or manually.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAdmin(request)) {
    return jsonResponse({ ok: false, error: "Admin access required." }, 403);
  }

  try {
    const supabase = getSupabase();
    const now = Math.floor(Date.now() / 1000);

    // Find bounties that are open and past their review deadline
    // review_deadline = deadline + 7 days (set during creation)
    // Fallback: if review_deadline is null, use deadline + 7*86400
    const { data: expiredBounties, error: fetchError } = await supabase
      .from("bounties")
      .select("id, creator_user_id, reward_amount, deadline, review_deadline")
      .eq("status", "open")
      .or(`review_deadline.lte.${now},and(review_deadline.is.null,deadline.lte.${now - 7 * 86400})`);

    if (fetchError) {
      return jsonResponse({ ok: false, error: "Failed to scan for expired bounties." }, 500);
    }

    const results: Array<{ bountyId: string; action: string }> = [];

    for (const bounty of expiredBounties ?? []) {
      // Mark bounty as expired
      const { error: updateError } = await supabase
        .from("bounties")
        .update({ status: "expired", updated_at: now })
        .eq("id", bounty.id)
        .eq("status", "open"); // Prevent race conditions

      if (updateError) {
        results.push({ bountyId: bounty.id, action: "update_failed" });
        continue;
      }

      // Reject all pending submissions
      await supabase
        .from("bounty_submissions")
        .update({ status: "rejected", reviewed_at: now })
        .eq("bounty_id", bounty.id)
        .eq("status", "submitted");

      // Reject all pending bids
      await supabase
        .from("bids")
        .update({ status: "rejected", updated_at: now })
        .eq("bounty_id", bounty.id)
        .eq("status", "pending");

      // Refund escrow to publisher
      const { error: refundError } = await supabase.from("transactions").insert({
        id: nanoid(),
        user_id: bounty.creator_user_id,
        agent_id: null,
        bounty_id: bounty.id,
        amount: bounty.reward_amount,
        type: "bounty_refund",
        description: "Automatic refund - bounty expired without review",
        created_at: now,
      });

      if (refundError) {
        results.push({ bountyId: bounty.id, action: "expired_refund_failed" });
        continue;
      }

      // Update user wallet
      const { data: wallet } = await supabase
        .from("user_wallets")
        .select("balance")
        .eq("user_id", bounty.creator_user_id)
        .maybeSingle();

      if (wallet) {
        await supabase
          .from("user_wallets")
          .update({
            balance: wallet.balance + bounty.reward_amount,
            updated_at: now,
          })
          .eq("user_id", bounty.creator_user_id);
      }

      results.push({ bountyId: bounty.id, action: "expired_and_refunded" });
    }

    return jsonResponse({
      ok: true,
      data: {
        scannedAt: new Date(now * 1000).toISOString(),
        processed: results.length,
        results,
      },
    });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to process expired bounties." }, 500);
  }
}
