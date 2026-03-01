import { nanoid } from "nanoid";
import { getSupabase } from "@/lib/supabase";

interface MatchParams {
  bountyId: string;
  panelId: string | null;
  difficultyTier: string;
  rewardAmount: number;
  tags: string[];
  title: string;
}

interface SubscriptionRow {
  id: string;
  agent_id: string;
  panel_id: string | null;
  difficulty_tier: string | null;
  min_reward: number | null;
  tags: string | null;
  webhook_url: string | null;
}

interface NotificationInsert {
  id: string;
  agent_id: string;
  event_type: string;
  bounty_id: string;
  related_id: string | null;
  subscription_id: string;
  message: string;
  is_read: boolean;
  webhook_sent: boolean;
  webhook_sent_at: number | null;
  created_at: number;
}

export async function notifyMatchingSubscribers(params: MatchParams): Promise<void> {
  try {
    const supabase = getSupabase();

    const { data: subscriptions, error } = await supabase
      .from("subscriptions")
      .select("id, agent_id, panel_id, difficulty_tier, min_reward, tags, webhook_url")
      .eq("is_active", true);

    if (error || !subscriptions || subscriptions.length === 0) {
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const bountyTagSet = new Set(params.tags.map((tag) => tag.toLowerCase()));
    const notifications: NotificationInsert[] = [];

    for (const sub of subscriptions as SubscriptionRow[]) {
      if (sub.panel_id && sub.panel_id !== params.panelId) {
        continue;
      }

      if (sub.difficulty_tier && sub.difficulty_tier !== params.difficultyTier) {
        continue;
      }

      if (typeof sub.min_reward === "number" && params.rewardAmount < sub.min_reward) {
        continue;
      }

      if (sub.tags) {
        const subscriptionTags = sub.tags
          .split(",")
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0);

        if (subscriptionTags.length > 0) {
          const hasOverlap = subscriptionTags.some((tag) => bountyTagSet.has(tag));
          if (!hasOverlap) {
            continue;
          }
        }
      }

      notifications.push({
        id: nanoid(),
        agent_id: sub.agent_id,
        event_type: "new_bounty",
        bounty_id: params.bountyId,
        related_id: null,
        subscription_id: sub.id,
        message: `New bounty matching your subscription: "${params.title}" - ${(params.rewardAmount / 100).toFixed(2)} credits`,
        is_read: false,
        webhook_sent: false,
        webhook_sent_at: null,
        created_at: now,
      });
    }

    if (notifications.length === 0) {
      return;
    }

    await supabase.from("notifications").insert(notifications);
  } catch {
    return;
  }
}
