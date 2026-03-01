import { getSupabase } from "@/lib/supabase";
import type { ApiResponse } from "@/types/index";

interface NotificationRow {
  id: string;
  agent_id: string;
  event_type: string;
  bounty_id: string | null;
  related_id: string | null;
  subscription_id: string | null;
  message: string;
  is_read: boolean;
  webhook_sent: boolean;
  webhook_sent_at: number | null;
  created_at: number;
}

interface SubscriptionRow {
  id: string;
  webhook_url: string;
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

export async function POST(request: Request): Promise<Response> {
  try {
    // Check for ADMIN_API_KEY in X-API-Key header
    const apiKey = request.headers.get("x-api-key");
    const adminApiKey = process.env.ADMIN_API_KEY;

    if (!apiKey || !adminApiKey || apiKey !== adminApiKey) {
      return jsonResponse(
        {
          ok: false,
          error: "Unauthorized. Invalid or missing admin API key.",
        },
        401,
      );
    }

    const supabase = getSupabase();

    // Query notifications where webhook_sent = false and has matching subscription with webhook_url
    const { data: notifications, error: notificationsError } = await supabase
      .from("notifications")
      .select("*, subscriptions!subscription_id(id, webhook_url)")
      .eq("webhook_sent", false)
      .not("subscription_id", "is", null);

    if (notificationsError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch pending notifications.",
        },
        500,
      );
    }

    let processedCount = 0;

    // Process each notification
    for (const notification of notifications || []) {
      const notif = notification as NotificationRow & {
        subscriptions: SubscriptionRow | null;
      };

      // Extract webhook URL from subscription
      const webhookUrl = notif.subscriptions?.webhook_url ?? null;

      if (!webhookUrl) {
        continue;
      }

      // Attempt webhook delivery with 5s timeout
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const payload = {
          id: notif.id,
          agentId: notif.agent_id,
          eventType: notif.event_type,
          bountyId: notif.bounty_id,
          subscriptionId: notif.subscription_id,
          message: notif.message,
          isRead: notif.is_read,
          createdAt: toIsoDate(notif.created_at),
        };

        await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
      } catch {
        // Fire-and-forget: ignore delivery errors
      }

      // Mark webhook_sent = true and webhook_sent_at = now regardless of success
      const now = Math.floor(Date.now() / 1000);
      const { error: updateError } = await supabase
        .from("notifications")
        .update({
          webhook_sent: true,
          webhook_sent_at: now,
        })
        .eq("id", notif.id);

      if (!updateError) {
        processedCount++;
      }
    }

    return jsonResponse(
      {
        ok: true,
        data: {
          processed: processedCount,
        },
      },
      200,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to process webhook deliveries.",
      },
      500,
    );
  }
}
