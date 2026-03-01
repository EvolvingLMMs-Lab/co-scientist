import { nanoid } from "nanoid";
import { authenticateAgent } from "@/lib/agent-auth";
import { getSupabase } from "@/lib/supabase";
import type { ApiResponse } from "@/types/index";

type RouteContext = { params: Promise<{ id: string }> };

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
  _request: Request,
  { params }: RouteContext,
): Promise<Response> {
  try {
    const { id: bountyId } = await params;
    const supabase = getSupabase();

    const { data: bids, error } = await supabase
      .from("bids")
      .select("*, agents!inner(name, source_tool, avatar_url)")
      .eq("bounty_id", bountyId)
      .order("proposed_amount", { ascending: true });

    if (error) {
      return jsonResponse({ ok: false, error: "Failed to fetch bids." }, 500);
    }

    type BidAgentRelation = { name: string; source_tool: string; avatar_url: string | null };
    type BidWithAgent = {
      id: string;
      bounty_id: string;
      agent_id: string;
      proposed_amount: number;
      estimated_hours: number | null;
      approach_summary: string;
      status: string;
      created_at: number;
      updated_at: number | null;
      agents: BidAgentRelation | BidAgentRelation[];
    };

    const transformedBids = ((bids ?? []) as BidWithAgent[]).map((bid) => {
      const agent = Array.isArray(bid.agents) ? bid.agents[0] : bid.agents;
      return {
        id: bid.id,
        bountyId: bid.bounty_id,
        agentId: bid.agent_id,
        agentName: agent?.name ?? "Unknown",
        agentSourceTool: agent?.source_tool ?? "unknown",
        agentAvatarUrl: agent?.avatar_url ?? null,
        proposedAmount: bid.proposed_amount,
        proposedDisplay: `$${(bid.proposed_amount / 100).toFixed(2)}`,
        estimatedHours: bid.estimated_hours,
        approachSummary: bid.approach_summary,
        status: bid.status,
        createdAt: toIsoDate(bid.created_at),
        updatedAt: bid.updated_at ? toIsoDate(bid.updated_at) : null,
      };
    });

    return jsonResponse({ ok: true, data: transformedBids });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to fetch bids." }, 500);
  }
}

export async function POST(
  request: Request,
  { params }: RouteContext,
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

    const { proposedAmount, approachSummary, estimatedHours } = body as Record<string, unknown>;

    if (typeof proposedAmount !== "number" || proposedAmount <= 0 || !Number.isFinite(proposedAmount)) {
      return jsonResponse({ ok: false, error: "proposedAmount must be a positive number." }, 400);
    }

    if (
      typeof approachSummary !== "string" ||
      approachSummary.trim().length < 10 ||
      approachSummary.trim().length > 5000
    ) {
      return jsonResponse(
        { ok: false, error: "approachSummary must be between 10 and 5000 characters." },
        400,
      );
    }

    if (
      estimatedHours !== undefined &&
      estimatedHours !== null &&
      (typeof estimatedHours !== "number" || estimatedHours <= 0 || !Number.isInteger(estimatedHours))
    ) {
      return jsonResponse({ ok: false, error: "estimatedHours must be a positive integer." }, 400);
    }

    const supabase = getSupabase();

    const { data: bounty, error: bountyError } = await supabase
      .from("bounties")
      .select("id, status, creator_user_id")
      .eq("id", bountyId)
      .maybeSingle();

    if (bountyError) {
      return jsonResponse({ ok: false, error: "Failed to create bid." }, 500);
    }

    if (!bounty) {
      return jsonResponse({ ok: false, error: "Bounty not found." }, 404);
    }

    if (bounty.status !== "open") {
      return jsonResponse({ ok: false, error: "Bounty is not open for bids." }, 400);
    }

    const { data: existingBid, error: existingBidError } = await supabase
      .from("bids")
      .select("id")
      .eq("bounty_id", bountyId)
      .eq("agent_id", agent.id)
      .maybeSingle();

    if (existingBidError) {
      return jsonResponse({ ok: false, error: "Failed to create bid." }, 500);
    }

    if (existingBid) {
      return jsonResponse({ ok: false, error: "You have already bid on this bounty." }, 409);
    }

    const bidId = nanoid();
    const now = Math.floor(Date.now() / 1000);

    const { error: insertError } = await supabase.from("bids").insert({
      id: bidId,
      bounty_id: bountyId,
      agent_id: agent.id,
      proposed_amount: proposedAmount,
      estimated_hours: (estimatedHours as number | null) ?? null,
      approach_summary: (approachSummary as string).trim(),
      status: "pending",
      created_at: now,
      updated_at: null,
    });

    if (insertError) {
      return jsonResponse({ ok: false, error: "Failed to create bid." }, 500);
    }

    const { data: currentBounty, error: countError } = await supabase
      .from("bounties")
      .select("bid_count")
      .eq("id", bountyId)
      .single();

    if (!countError && currentBounty) {
      await supabase
        .from("bounties")
        .update({ bid_count: (currentBounty.bid_count ?? 0) + 1 })
        .eq("id", bountyId);
    }

    return jsonResponse(
      {
        ok: true,
        data: {
          id: bidId,
          bountyId,
          agentId: agent.id,
          proposedAmount,
          proposedDisplay: `$${(proposedAmount / 100).toFixed(2)}`,
          estimatedHours: (estimatedHours as number | null) ?? null,
          approachSummary: (approachSummary as string).trim(),
          status: "pending",
          createdAt: toIsoDate(now),
          updatedAt: null,
        },
      },
      201,
    );
  } catch {
    return jsonResponse({ ok: false, error: "Failed to create bid." }, 500);
  }
}
