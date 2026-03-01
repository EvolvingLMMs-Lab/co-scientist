import { nanoid } from "nanoid";
import { isAdmin } from "@/lib/agent-auth";
import { canTransitionStatus } from "@/lib/bounty-logic";
import { canTransitionDispute, computeDisputePayout } from "@/lib/dispute-logic";
import { getSupabase } from "@/lib/supabase";
import type {
  BountyStatus,
  Dispute,
  DisputeGround,
  DisputeOutcome,
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
  creator_user_id: string;
}

interface SubmissionRow {
  id: string;
  bounty_id: string;
  agent_id: string;
  status: "submitted" | "accepted" | "rejected";
}

interface AgentWalletRow {
  agent_id: string;
  balance: number;
  tasks_completed: number;
  tasks_submitted: number;
}

interface UserWalletRow {
  user_id: string;
  balance: number;
}

interface PublisherReputationRow {
  publisher_id: string;
  disputes_lost: number;
}

const VALID_OUTCOMES: DisputeOutcome[] = [
  "resolved_agent_full",
  "resolved_split",
  "resolved_publisher",
];

function isDisputeOutcome(value: string): value is DisputeOutcome {
  return (VALID_OUTCOMES as readonly string[]).includes(value);
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
  if (!isAdmin(request)) {
    return jsonResponse({ ok: false, error: "Admin access required." }, 403);
  }

  try {
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
    const outcomeValue = payload.outcome;
    const resolutionNotes =
      typeof payload.resolutionNotes === "string"
        ? payload.resolutionNotes.trim()
        : "";
    const resolutionAmount = payload.resolutionAmount;
    const resolutionSplitBps = payload.resolutionSplitBps;

    if (typeof outcomeValue !== "string" || !isDisputeOutcome(outcomeValue)) {
      return jsonResponse({ ok: false, error: "outcome is invalid." }, 400);
    }

    if (!resolutionNotes) {
      return jsonResponse({ ok: false, error: "resolutionNotes is required." }, 400);
    }

    if (resolutionNotes.length > 10000) {
      return jsonResponse({ ok: false, error: "resolutionNotes must be at most 10000 characters." }, 400);
    }

    if (
      resolutionAmount !== undefined &&
      (typeof resolutionAmount !== "number" ||
        !Number.isInteger(resolutionAmount) ||
        resolutionAmount < 0)
    ) {
      return jsonResponse({ ok: false, error: "resolutionAmount must be a non-negative integer." }, 400);
    }

    if (
      resolutionSplitBps !== undefined &&
      (typeof resolutionSplitBps !== "number" ||
        !Number.isInteger(resolutionSplitBps) ||
        resolutionSplitBps < 1 ||
        resolutionSplitBps > 9999)
    ) {
      return jsonResponse({ ok: false, error: "resolutionSplitBps must be an integer between 1 and 9999." }, 400);
    }

    const outcome: DisputeOutcome = outcomeValue;
    const splitBps =
      outcome === "resolved_split"
        ? (typeof resolutionSplitBps === "number" ? resolutionSplitBps : 5000)
        : undefined;

    if (outcome === "resolved_split" && splitBps === undefined) {
      return jsonResponse({ ok: false, error: "resolutionSplitBps is required for resolved_split." }, 400);
    }

    const supabase = getSupabase();
    const now = Math.floor(Date.now() / 1000);

    const { data: disputeData, error: disputeError } = await supabase
      .from("disputes")
      .select("*")
      .eq("id", disputeId)
      .maybeSingle();

    if (disputeError) {
      return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
    }

    const dispute = disputeData as DisputeRow | null;
    if (!dispute) {
      return jsonResponse({ ok: false, error: "Dispute not found." }, 404);
    }

    const resolvableStatuses: DisputeStatus[] = ["filed", "responded", "under_review"];
    if (!resolvableStatuses.includes(dispute.status)) {
      return jsonResponse({ ok: false, error: "Dispute is not in a resolvable state." }, 400);
    }

    if (!canTransitionDispute(dispute.status, outcome)) {
      return jsonResponse({ ok: false, error: "Dispute cannot transition to the requested outcome." }, 400);
    }

    const { data: bountyData, error: bountyError } = await supabase
      .from("bounties")
      .select("id, status, reward_amount, creator_user_id")
      .eq("id", dispute.bounty_id)
      .maybeSingle();

    if (bountyError) {
      return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
    }

    const bounty = bountyData as BountyRow | null;
    if (!bounty) {
      return jsonResponse({ ok: false, error: "Bounty not found." }, 404);
    }

    const { data: submissionData, error: submissionError } = await supabase
      .from("bounty_submissions")
      .select("id, bounty_id, agent_id, status")
      .eq("id", dispute.submission_id)
      .maybeSingle();

    if (submissionError) {
      return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
    }

    const submission = submissionData as SubmissionRow | null;
    if (!submission) {
      return jsonResponse({ ok: false, error: "Submission not found." }, 404);
    }

    if (submission.bounty_id !== bounty.id || submission.agent_id !== dispute.agent_id) {
      return jsonResponse({ ok: false, error: "Dispute references invalid bounty or submission state." }, 400);
    }

    const nextBountyStatus: BountyStatus =
      outcome === "resolved_publisher" ? "cancelled" : "awarded";

    if (
      bounty.status !== nextBountyStatus &&
      !canTransitionStatus(bounty.status, nextBountyStatus)
    ) {
      return jsonResponse({ ok: false, error: "Bounty cannot transition to the resolved state." }, 400);
    }

    const payout = computeDisputePayout(bounty.reward_amount, outcome, splitBps);

    if (
      typeof resolutionAmount === "number" &&
      resolutionAmount !== payout.agentAmount
    ) {
      return jsonResponse(
        {
          ok: false,
          error: "resolutionAmount must match the computed payout for the selected outcome.",
        },
        400,
      );
    }

    const transactionRows: Array<{
      id: string;
      user_id: string | null;
      agent_id: string | null;
      bounty_id: string;
      dispute_id: string;
      amount: number;
      type: "dispute_payout" | "dispute_refund" | "platform_fee";
      description: string;
      created_at: number;
    }> = [];

    if (payout.agentAmount > 0) {
      transactionRows.push({
        id: nanoid(),
        user_id: null,
        agent_id: dispute.agent_id,
        bounty_id: dispute.bounty_id,
        dispute_id: dispute.id,
        amount: payout.agentAmount,
        type: "dispute_payout",
        description: "Dispute resolution payout",
        created_at: now,
      });
    }

    if (payout.publisherRefund > 0) {
      transactionRows.push({
        id: nanoid(),
        user_id: dispute.publisher_id,
        agent_id: null,
        bounty_id: dispute.bounty_id,
        dispute_id: dispute.id,
        amount: payout.publisherRefund,
        type: "dispute_refund",
        description: "Dispute resolution refund",
        created_at: now,
      });
    }

    if (payout.platformFee > 0) {
      transactionRows.push({
        id: nanoid(),
        user_id: null,
        agent_id: null,
        bounty_id: dispute.bounty_id,
        dispute_id: dispute.id,
        amount: payout.platformFee,
        type: "platform_fee",
        description: "Platform fee from dispute resolution",
        created_at: now,
      });
    }

    if (transactionRows.length > 0) {
      const { error: transactionError } = await supabase
        .from("transactions")
        .insert(transactionRows);

      if (transactionError) {
        return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
      }
    }

    if (payout.agentAmount > 0) {
      const { data: walletData, error: walletError } = await supabase
        .from("agent_wallets")
        .select("agent_id, balance, tasks_completed, tasks_submitted")
        .eq("agent_id", dispute.agent_id)
        .maybeSingle();

      if (walletError) {
        return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
      }

      const wallet = walletData as AgentWalletRow | null;
      if (wallet) {
        const { error: updateWalletError } = await supabase
          .from("agent_wallets")
          .update({
            balance: wallet.balance + payout.agentAmount,
            tasks_completed: wallet.tasks_completed + 1,
            updated_at: now,
          })
          .eq("agent_id", dispute.agent_id);

        if (updateWalletError) {
          return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
        }
      } else {
        const { error: insertWalletError } = await supabase
          .from("agent_wallets")
          .insert({
            agent_id: dispute.agent_id,
            balance: payout.agentAmount,
            tasks_completed: 1,
            tasks_submitted: 0,
            updated_at: now,
          });

        if (insertWalletError) {
          return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
        }
      }
    }

    if (payout.publisherRefund > 0) {
      const { data: userWalletData, error: userWalletError } = await supabase
        .from("user_wallets")
        .select("user_id, balance")
        .eq("user_id", dispute.publisher_id)
        .maybeSingle();

      if (userWalletError) {
        return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
      }

      const userWallet = userWalletData as UserWalletRow | null;
      if (userWallet) {
        const { error: updateUserWalletError } = await supabase
          .from("user_wallets")
          .update({
            balance: userWallet.balance + payout.publisherRefund,
            updated_at: now,
          })
          .eq("user_id", dispute.publisher_id);

        if (updateUserWalletError) {
          return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
        }
      } else {
        const { error: insertUserWalletError } = await supabase
          .from("user_wallets")
          .insert({
            user_id: dispute.publisher_id,
            balance: payout.publisherRefund,
            updated_at: now,
          });

        if (insertUserWalletError) {
          return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
        }
      }
    }

    if (outcome === "resolved_publisher") {
      const { error: rejectSubmissionError } = await supabase
        .from("bounty_submissions")
        .update({ status: "rejected", reviewed_at: now })
        .eq("id", dispute.submission_id);

      if (rejectSubmissionError) {
        return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
      }
    } else {
      const { error: acceptSubmissionError } = await supabase
        .from("bounty_submissions")
        .update({ status: "accepted", reviewed_at: now })
        .eq("id", dispute.submission_id);

      if (acceptSubmissionError) {
        return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
      }

      const { error: rejectOthersError } = await supabase
        .from("bounty_submissions")
        .update({ status: "rejected", reviewed_at: now })
        .eq("bounty_id", dispute.bounty_id)
        .neq("id", dispute.submission_id)
        .eq("status", "submitted");

      if (rejectOthersError) {
        return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
      }
    }

    const { error: updateBountyError } = await supabase
      .from("bounties")
      .update({
        status: nextBountyStatus,
        awarded_submission_id:
          nextBountyStatus === "awarded" ? dispute.submission_id : null,
        updated_at: now,
      })
      .eq("id", dispute.bounty_id);

    if (updateBountyError) {
      return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
    }

    const { data: updatedDisputeData, error: updateDisputeError } = await supabase
      .from("disputes")
      .update({
        status: outcome,
        resolution_amount: payout.agentAmount,
        resolution_split_bps:
          outcome === "resolved_split" ? splitBps ?? null : null,
        resolution_notes: resolutionNotes,
        resolved_by: "admin",
        resolved_at: now,
      })
      .eq("id", dispute.id)
      .select("*")
      .single();

    if (updateDisputeError) {
      return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
    }

    if (outcome === "resolved_agent_full" || outcome === "resolved_split") {
      const { data: publisherRepData, error: publisherRepError } = await supabase
        .from("publisher_reputation")
        .select("publisher_id, disputes_lost")
        .eq("publisher_id", dispute.publisher_id)
        .maybeSingle();

      if (publisherRepError) {
        return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
      }

      const publisherReputation = publisherRepData as PublisherReputationRow | null;

      if (publisherReputation) {
        const { error: updatePublisherRepError } = await supabase
          .from("publisher_reputation")
          .update({
            disputes_lost: publisherReputation.disputes_lost + 1,
            updated_at: now,
          })
          .eq("publisher_id", dispute.publisher_id);

        if (updatePublisherRepError) {
          return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
        }
      } else {
        const { error: insertPublisherRepError } = await supabase
          .from("publisher_reputation")
          .insert({
            publisher_id: dispute.publisher_id,
            disputes_lost: 1,
            updated_at: now,
          });

        if (insertPublisherRepError) {
          return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
        }
      }
    }

    const updatedDispute = updatedDisputeData as DisputeRow | null;
    if (!updatedDispute) {
      return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
    }

    return jsonResponse({
      ok: true,
      data: {
        dispute: mapDispute(updatedDispute),
        payout: {
          agentAmount: payout.agentAmount,
          publisherRefund: payout.publisherRefund,
          platformFee: payout.platformFee,
        },
      },
    });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to resolve dispute." }, 500);
  }
}
