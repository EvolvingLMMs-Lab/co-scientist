import { nanoid } from "nanoid";
import { authenticateAgent } from "@/lib/agent-auth";
import { getSupabase } from "@/lib/supabase";
import type { ApiResponse } from "@/types/index";

type RouteContext = { params: Promise<{ id: string }> };

interface SubscriptionRow {
  id: string;
  agent_id: string;
  panel_id: string | null;
  difficulty_tier: string | null;
  min_reward: number | null;
  tags: string | null;
  webhook_url: string | null;
  created_at: number;
}

interface SubscriptionResponse {
  id: string;
  agentId: string;
  panelId: string | null;
  panelSlug?: string;
  panelName?: string;
  difficultyTier: string | null;
  minReward: number | null;
  tags: string[];
  webhookUrl: string | null;
  createdAt: string;
}

interface PanelInfo {
  id: string;
  slug: string;
  name: string;
}

function jsonResponse<T>(
  body: ApiResponse<T>,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function toIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function toSubscriptionResponse(
  row: SubscriptionRow,
  panelInfo?: PanelInfo,
): SubscriptionResponse {
  return {
    id: row.id,
    agentId: row.agent_id,
    panelId: row.panel_id,
    panelSlug: panelInfo?.slug,
    panelName: panelInfo?.name,
    difficultyTier: row.difficulty_tier,
    minReward: row.min_reward,
    tags: row.tags ? row.tags.split(",").map((t) => t.trim()) : [],
    webhookUrl: row.webhook_url,
    createdAt: toIsoDate(row.created_at),
  };
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { id: agentId } = await context.params;

    const supabase = getSupabase();

    // Get subscriptions with panel info
    const { data: subscriptions, error: subscriptionsError } = await supabase
      .from("subscriptions")
      .select("*, panels(id, slug, name)")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false });

    if (subscriptionsError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch subscriptions.",
        },
        500,
      );
    }

    const result = (subscriptions || []).map((sub: any) => {
      const row: SubscriptionRow = {
        id: sub.id,
        agent_id: sub.agent_id,
        panel_id: sub.panel_id,
        difficulty_tier: sub.difficulty_tier,
        min_reward: sub.min_reward,
        tags: sub.tags,
        webhook_url: sub.webhook_url,
        created_at: sub.created_at,
      };

      const panelInfo = sub.panels
        ? {
            id: sub.panels.id,
            slug: sub.panels.slug,
            name: sub.panels.name,
          }
        : undefined;

      return toSubscriptionResponse(row, panelInfo);
    });

    return jsonResponse(
      {
        ok: true,
        data: result,
      },
      200,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to fetch subscriptions.",
      },
      500,
    );
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { id: agentId } = await context.params;

    // Authenticate agent
    const agent = await authenticateAgent(request);
    if (!agent) {
      return jsonResponse(
        {
          ok: false,
          error: "Unauthorized. Missing or invalid API key.",
        },
        401,
      );
    }

    // Check agent can only create subscriptions for themselves
    if (agent.id !== agentId) {
      return jsonResponse(
        {
          ok: false,
          error: "Forbidden. You can only create subscriptions for your own agent.",
        },
        403,
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid JSON body.",
        },
        400,
      );
    }

    const bodyObj = body as Record<string, unknown>;
    const panelSlug = typeof bodyObj.panelSlug === "string" ? bodyObj.panelSlug.trim() : undefined;
    const difficultyTier = typeof bodyObj.difficultyTier === "string" ? bodyObj.difficultyTier.trim() : null;
    const minReward = typeof bodyObj.minReward === "number" ? bodyObj.minReward : null;
    const tags = Array.isArray(bodyObj.tags) ? bodyObj.tags : [];
    const webhookUrl = typeof bodyObj.webhookUrl === "string" ? bodyObj.webhookUrl.trim() : null;

    // Validate webhook URL if provided
    if (webhookUrl) {
      try {
        new URL(webhookUrl);
      } catch {
        return jsonResponse(
          {
            ok: false,
            error: "Invalid webhookUrl. Must be a valid URL.",
          },
          400,
        );
      }
    }

    const supabase = getSupabase();
    let panelId: string | null = null;

    // Look up panel by slug if provided
    if (panelSlug) {
      const { data: panel, error: panelError } = await supabase
        .from("panels")
        .select("id")
        .eq("slug", panelSlug)
        .maybeSingle();

      if (panelError) {
        return jsonResponse(
          {
            ok: false,
            error: "Failed to look up panel.",
          },
          500,
        );
      }

      if (!panel) {
        return jsonResponse(
          {
            ok: false,
            error: `Panel with slug "${panelSlug}" not found.`,
          },
          404,
        );
      }

      panelId = panel.id;
    }

    const subscriptionId = nanoid();
    const now = Math.floor(Date.now() / 1000);
    const tagsString = tags.length > 0 ? tags.join(",") : null;

    const { data: subscription, error: insertError } = await supabase
      .from("subscriptions")
      .insert({
        id: subscriptionId,
        agent_id: agentId,
        panel_id: panelId,
        difficulty_tier: difficultyTier,
        min_reward: minReward,
        tags: tagsString,
        webhook_url: webhookUrl,
        created_at: now,
      })
      .select("*, panels(id, slug, name)")
      .single();

    if (insertError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to create subscription.",
        },
        500,
      );
    }

    if (!subscription) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch newly created subscription.",
        },
        500,
      );
    }

    const row: SubscriptionRow = {
      id: subscription.id,
      agent_id: subscription.agent_id,
      panel_id: subscription.panel_id,
      difficulty_tier: subscription.difficulty_tier,
      min_reward: subscription.min_reward,
      tags: subscription.tags,
      webhook_url: subscription.webhook_url,
      created_at: subscription.created_at,
    };

    const panelInfo = subscription.panels
      ? {
          id: subscription.panels.id,
          slug: subscription.panels.slug,
          name: subscription.panels.name,
        }
      : undefined;

    return jsonResponse(
      {
        ok: true,
        data: toSubscriptionResponse(row, panelInfo),
      },
      201,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to create subscription.",
      },
      500,
    );
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { id: agentId } = await context.params;

    // Authenticate agent
    const agent = await authenticateAgent(request);
    if (!agent) {
      return jsonResponse(
        {
          ok: false,
          error: "Unauthorized. Missing or invalid API key.",
        },
        401,
      );
    }

    // Check agent can only delete own subscriptions
    if (agent.id !== agentId) {
      return jsonResponse(
        {
          ok: false,
          error: "Forbidden. You can only delete subscriptions for your own agent.",
        },
        403,
      );
    }

    const url = new URL(request.url);
    const subscriptionId = url.searchParams.get("subscriptionId");

    if (!subscriptionId) {
      return jsonResponse(
        {
          ok: false,
          error: "Missing subscriptionId query parameter.",
        },
        400,
      );
    }

    const supabase = getSupabase();

    // Check subscription belongs to agent
    const { data: subscription, error: checkError } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("id", subscriptionId)
      .eq("agent_id", agentId)
      .maybeSingle();

    if (checkError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to verify subscription ownership.",
        },
        500,
      );
    }

    if (!subscription) {
      return jsonResponse(
        {
          ok: false,
          error: "Subscription not found or does not belong to this agent.",
        },
        404,
      );
    }

    // Delete subscription
    const { error: deleteError } = await supabase
      .from("subscriptions")
      .delete()
      .eq("id", subscriptionId);

    if (deleteError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to delete subscription.",
        },
        500,
      );
    }

    return jsonResponse(
      {
        ok: true,
        data: { deleted: true },
      },
      200,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to delete subscription.",
      },
      500,
    );
  }
}
