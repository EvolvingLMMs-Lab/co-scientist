import { authenticateAgent } from "@/lib/agent-auth";
import { getSupabase } from "@/lib/supabase";
import type { ApiResponse } from "@/types/index";

type RouteContext = { params: Promise<{ id: string }> };

interface NotificationRow {
  id: string;
  agent_id: string;
  subscription_id: string | null;
  title: string;
  content: string;
  is_read: boolean;
  webhook_sent: boolean;
  webhook_sent_at: number | null;
  created_at: number;
}

interface NotificationResponse {
  id: string;
  agentId: string;
  subscriptionId: string | null;
  title: string;
  content: string;
  isRead: boolean;
  webhookSent: boolean;
  webhookSentAt: string | null;
  createdAt: string;
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

function toNotificationResponse(row: NotificationRow): NotificationResponse {
  return {
    id: row.id,
    agentId: row.agent_id,
    subscriptionId: row.subscription_id,
    title: row.title,
    content: row.content,
    isRead: row.is_read,
    webhookSent: row.webhook_sent,
    webhookSentAt: row.webhook_sent_at ? toIsoDate(row.webhook_sent_at) : null,
    createdAt: toIsoDate(row.created_at),
  };
}

export async function GET(
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

    // Agent can only read own notifications
    if (agent.id !== agentId) {
      return jsonResponse(
        {
          ok: false,
          error: "Forbidden. You can only read notifications for your own agent.",
        },
        403,
      );
    }

    const url = new URL(request.url);
    const unreadParam = url.searchParams.get("unread");
    const limitParam = url.searchParams.get("limit");

    const unread = unreadParam === "true";
    const limit = Math.min(
      Math.max(1, parseInt(limitParam || "50", 10)),
      100,
    );

    const supabase = getSupabase();

    let query = supabase
      .from("notifications")
      .select("*")
      .eq("agent_id", agentId);

    if (unread) {
      query = query.eq("is_read", false);
    }

    const { data: notifications, error: notificationsError } = await query
      .order("created_at", { ascending: false })
      .limit(limit);

    if (notificationsError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch notifications.",
        },
        500,
      );
    }

    const result = (notifications || []).map((row: NotificationRow) =>
      toNotificationResponse(row),
    );

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
        error: "Failed to fetch notifications.",
      },
      500,
    );
  }
}

export async function PATCH(
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

    // Agent can only update own notifications
    if (agent.id !== agentId) {
      return jsonResponse(
        {
          ok: false,
          error: "Forbidden. You can only update notifications for your own agent.",
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
    const notificationIds = Array.isArray(bodyObj.notificationIds)
      ? bodyObj.notificationIds.filter((id) => typeof id === "string")
      : [];

    if (notificationIds.length === 0) {
      return jsonResponse(
        {
          ok: false,
          error: "notificationIds must be a non-empty array of strings.",
        },
        400,
      );
    }

    const supabase = getSupabase();

    // Update is_read = true for those IDs where agent_id matches
    const { error: updateError, count } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .in("id", notificationIds)
      .eq("agent_id", agentId);

    if (updateError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to mark notifications as read.",
        },
        500,
      );
    }

    return jsonResponse(
      {
        ok: true,
        data: {
          updated: count || 0,
        },
      },
      200,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to mark notifications as read.",
      },
      500,
    );
  }
}
