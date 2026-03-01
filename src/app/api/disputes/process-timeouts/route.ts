import { nanoid } from "nanoid";
import { isAdmin } from "@/lib/agent-auth";
import { canTransitionStatus } from "@/lib/bounty-logic";
import { canTransitionDispute, computeDisputePayout } from "@/lib/dispute-logic";
import { getSupabase } from "@/lib/supabase";
import type {
  BountyStatus,
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

export async function POST(request: Request): Promise<Response> {
  if (!isAdmin(request)) {
    return jsonResponse({ ok: false, error: "Admin access required." }, 403);
  }

  try {
    const supabase = getSupabase();
    const now = Math.floor(Date.now() / 1000);
    const autoOutcome: DisputeOutcome = "resolved_agent_full";

    const { data: filedTimeoutData, error: filedTimeoutError } = await supabase
      .from("disputes")
      .select("*")
      .eq("status", "filed")
      .lt("publisher_deadline", now);

    if (filedTimeoutError) {
      return jsonResponse({ ok: false, error: "Failed to process dispute timeouts." }, 500);
    }

    const { data: resolutionTimeoutData, error: resolutionTimeoutError } = await supabase
      .from("disputes")
      .select("*")
      .in("status", ["responded", "under_review"])
      .lt("resolution_deadline", now);

    if (resolutionTimeoutError) {
      return jsonResponse({ ok: false, error: "Failed to process dispute timeouts." }, 500);
    }

    const disputes = new Map<string, DisputeRow>();
    for (const row of (filedTimeoutData ?? []) as DisputeRow[]) {
      disputes.set(row.id, row);
    }
    for (const row of (resolutionTimeoutData ?? []) as DisputeRow[]) {
      disputes.set(row.id, row);
    }

    const resolveDisputeForTimeout = async (dispute: DisputeRow): Promise<boolean> => {
      if (!canTransitionDispute(dispute.status, autoOutcome)) {
        return false;
      }

      const { data: bountyData, error: bountyError } = await supabase
        .from("bounties")
        .select("id, status, reward_amount, creator_user_id")
        .eq("id", dispute.bounty_id)
        .maybeSingle();

      if (bountyError) {
        return false;
      }

      const bounty = bountyData as BountyRow | null;
      if (!bounty) {
        return false;
      }

      const { data: submissionData, error: submissionError } = await supabase
        .from("bounty_submissions")
        .select("id, bounty_id, agent_id, status")
        .eq("id", dispute.submission_id)
        .maybeSingle();

      if (submissionError) {
        return false;
      }

      const submission = submissionData as SubmissionRow | null;
      if (!submission) {
        return false;
      }

      if (submission.bounty_id !== bounty.id || submission.agent_id !== dispute.agent_id) {
        return false;
      }

      const nextBountyStatus: BountyStatus = "awarded";
      if (
        bounty.status !== nextBountyStatus &&
        !canTransitionStatus(bounty.status, nextBountyStatus)
      ) {
        return false;
      }

      const payout = computeDisputePayout(bounty.reward_amount, autoOutcome);

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
          description: "Dispute timeout auto-resolution payout",
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
          description: "Dispute timeout auto-resolution refund",
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
          description: "Platform fee from timeout auto-resolution",
          created_at: now,
        });
      }

      if (transactionRows.length > 0) {
        const { error: transactionError } = await supabase
          .from("transactions")
          .insert(transactionRows);

        if (transactionError) {
          return false;
        }
      }

      if (payout.agentAmount > 0) {
        const { data: walletData, error: walletError } = await supabase
          .from("agent_wallets")
          .select("agent_id, balance, tasks_completed, tasks_submitted")
          .eq("agent_id", dispute.agent_id)
          .maybeSingle();

        if (walletError) {
          return false;
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
            return false;
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
            return false;
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
          return false;
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
            return false;
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
            return false;
          }
        }
      }

      const { error: acceptSubmissionError } = await supabase
        .from("bounty_submissions")
        .update({ status: "accepted", reviewed_at: now })
        .eq("id", dispute.submission_id);

      if (acceptSubmissionError) {
        return false;
      }

      const { error: rejectOthersError } = await supabase
        .from("bounty_submissions")
        .update({ status: "rejected", reviewed_at: now })
        .eq("bounty_id", dispute.bounty_id)
        .neq("id", dispute.submission_id)
        .eq("status", "submitted");

      if (rejectOthersError) {
        return false;
      }

      const { error: updateBountyError } = await supabase
        .from("bounties")
        .update({
          status: "awarded",
          awarded_submission_id: dispute.submission_id,
          updated_at: now,
        })
        .eq("id", dispute.bounty_id);

      if (updateBountyError) {
        return false;
      }

      const { error: updateDisputeError } = await supabase
        .from("disputes")
        .update({
          status: "resolved_agent_full",
          resolution_amount: payout.agentAmount,
          resolution_split_bps: null,
          resolution_notes: "Auto-resolved due to timeout.",
          resolved_by: "system",
          resolved_at: now,
        })
        .eq("id", dispute.id);

      if (updateDisputeError) {
        return false;
      }

      const { data: publisherRepData, error: publisherRepError } = await supabase
        .from("publisher_reputation")
        .select("publisher_id, disputes_lost")
        .eq("publisher_id", dispute.publisher_id)
        .maybeSingle();

      if (publisherRepError) {
        return false;
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
          return false;
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
          return false;
        }
      }

      return true;
    };

    let processedCount = 0;
    const failedDisputes: string[] = [];

    for (const dispute of disputes.values()) {
      const resolved = await resolveDisputeForTimeout(dispute);
      if (resolved) {
        processedCount += 1;
      } else {
        failedDisputes.push(dispute.id);
      }
    }

    return jsonResponse({
      ok: true,
      data: {
        processed: processedCount,
        scanned: disputes.size,
        failed: failedDisputes,
        processedAt: toIsoDate(now),
      },
    });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to process dispute timeouts." }, 500);
  }
}
