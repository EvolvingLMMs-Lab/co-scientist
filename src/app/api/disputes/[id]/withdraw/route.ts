import { nanoid } from "nanoid";
import { authenticateAgent } from "@/lib/agent-auth";
import { canTransitionStatus } from "@/lib/bounty-logic";
import { isDisputeTerminal } from "@/lib/dispute-logic";
import { getSupabase } from "@/lib/supabase";
import type {
  BountyStatus,
  Dispute,
  DisputeGround,
  DisputeStatus,
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

interface BountyRow {
  id: string;
  status: BountyStatus;
  reward_amount: number;
}

interface UserWalletRow {
  user_id: string;
  balance: number;
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
    const agent = await authenticateAgent(request);
    if (!agent) {
      return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    }

    const { id: disputeId } = await params;
    const supabase = getSupabase();
    const now = Math.floor(Date.now() / 1000);

    const { data: disputeData, error: disputeError } = await supabase
      .from("disputes")
      .select("*")
      .eq("id", disputeId)
      .maybeSingle();

    if (disputeError) {
      return jsonResponse({ ok: false, error: "Failed to withdraw dispute." }, 500);
    }

    const dispute = disputeData as DisputeRow | null;
    if (!dispute) {
      return jsonResponse({ ok: false, error: "Dispute not found." }, 404);
    }

    if (dispute.agent_id !== agent.id) {
      return jsonResponse({ ok: false, error: "Only the dispute agent can withdraw this dispute." }, 403);
    }

    if (isDisputeTerminal(dispute.status)) {
      return jsonResponse({ ok: false, error: "Dispute is already in a terminal state." }, 400);
    }

    const { data: bountyData, error: bountyError } = await supabase
      .from("bounties")
      .select("id, status, reward_amount")
      .eq("id", dispute.bounty_id)
      .maybeSingle();

    if (bountyError) {
      return jsonResponse({ ok: false, error: "Failed to withdraw dispute." }, 500);
    }

    const bounty = bountyData as BountyRow | null;
    if (!bounty) {
      return jsonResponse({ ok: false, error: "Bounty not found." }, 404);
    }

    if (
      bounty.status !== "cancelled" &&
      !canTransitionStatus(bounty.status, "cancelled")
    ) {
      return jsonResponse({ ok: false, error: "Bounty cannot transition to cancelled status." }, 400);
    }

    const refundAmount = bounty.reward_amount;

    const { error: refundTransactionError } = await supabase
      .from("transactions")
      .insert({
        id: nanoid(),
        user_id: dispute.publisher_id,
        agent_id: null,
        bounty_id: dispute.bounty_id,
        dispute_id: dispute.id,
        amount: refundAmount,
        type: "dispute_refund",
        description: "Dispute withdrawn - refund to publisher",
        created_at: now,
      });

    if (refundTransactionError) {
      return jsonResponse({ ok: false, error: "Failed to withdraw dispute." }, 500);
    }

    const { data: userWalletData, error: userWalletError } = await supabase
      .from("user_wallets")
      .select("user_id, balance")
      .eq("user_id", dispute.publisher_id)
      .maybeSingle();

    if (userWalletError) {
      return jsonResponse({ ok: false, error: "Failed to withdraw dispute." }, 500);
    }

    const userWallet = userWalletData as UserWalletRow | null;
    if (userWallet) {
      const { error: updateUserWalletError } = await supabase
        .from("user_wallets")
        .update({
          balance: userWallet.balance + refundAmount,
          updated_at: now,
        })
        .eq("user_id", dispute.publisher_id);

      if (updateUserWalletError) {
        return jsonResponse({ ok: false, error: "Failed to withdraw dispute." }, 500);
      }
    } else {
      const { error: insertUserWalletError } = await supabase
        .from("user_wallets")
        .insert({
          user_id: dispute.publisher_id,
          balance: refundAmount,
          updated_at: now,
        });

      if (insertUserWalletError) {
        return jsonResponse({ ok: false, error: "Failed to withdraw dispute." }, 500);
      }
    }

    const { data: updatedDisputeData, error: updateDisputeError } = await supabase
      .from("disputes")
      .update({
        status: "withdrawn",
        resolution_amount: 0,
        resolution_split_bps: null,
        resolution_notes: "Dispute withdrawn by agent.",
        resolved_by: agent.id,
        resolved_at: now,
      })
      .eq("id", dispute.id)
      .select("*")
      .single();

    if (updateDisputeError) {
      return jsonResponse({ ok: false, error: "Failed to withdraw dispute." }, 500);
    }

    const { error: updateBountyError } = await supabase
      .from("bounties")
      .update({
        status: "cancelled",
        awarded_submission_id: null,
        updated_at: now,
      })
      .eq("id", dispute.bounty_id);

    if (updateBountyError) {
      return jsonResponse({ ok: false, error: "Failed to withdraw dispute." }, 500);
    }

    const updatedDispute = updatedDisputeData as DisputeRow | null;
    if (!updatedDispute) {
      return jsonResponse({ ok: false, error: "Failed to withdraw dispute." }, 500);
    }

    return jsonResponse({
      ok: true,
      data: {
        dispute: mapDispute(updatedDispute),
        refundAmount,
      },
    });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to withdraw dispute." }, 500);
  }
}
