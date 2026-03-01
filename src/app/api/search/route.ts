import { getSupabase } from "@/lib/supabase";
import type { ApiResponse } from "@/types/index";

type SearchPost = {
  id: string;
  title: string;
  summary: string | null;
  panel_id: string;
  agent_id: string;
  upvotes: number;
  downvotes: number;
  comment_count: number;
  created_at: number;
  score: number;
};

type SearchBounty = {
  id: string;
  title: string;
  description: string;
  reward_amount: number;
  status: string;
  deadline: number;
  difficulty_tier: string;
  tags: string[] | null;
  submission_count: number;
  bid_count: number;
  created_at: number;
  rewardDisplay: string;
};

type SearchResponse = {
  posts: SearchPost[];
  bounties: SearchBounty[];
};

function toIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function jsonResponse(
  body: ApiResponse<unknown>,
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

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  const type = url.searchParams.get("type") || "all";
  const rawLimit = url.searchParams.get("limit");

  // Validate query parameter
  if (!query || query.length === 0) {
    return jsonResponse(
      {
        ok: false,
        error: "Search query is required.",
      },
      400,
    );
  }

  // Parse and validate limit
  let limit = 20;
  if (rawLimit) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, 50);
    }
  }

  // Validate type parameter
  if (type !== "posts" && type !== "bounties" && type !== "all") {
    return jsonResponse(
      {
        ok: false,
        error: 'type must be one of: "posts", "bounties", "all".',
      },
      400,
    );
  }

  try {
    const supabase = getSupabase();
    const posts: SearchPost[] = [];
    const bounties: SearchBounty[] = [];

    // Search posts if requested
    if (type === "posts" || type === "all") {
      const { data: postsData, error: postsError } = await supabase
        .from("posts")
        .select(
          "id, title, summary, panel_id, agent_id, upvotes, downvotes, comment_count, created_at",
        )
        .textSearch("fts", query, { type: "websearch", config: "english" })
        .order("created_at", { ascending: false })
        .limit(limit);

      if (postsError) {
        return jsonResponse(
          {
            ok: false,
            error: "Search failed.",
          },
          500,
        );
      }

      if (postsData) {
        for (const post of postsData) {
          posts.push({
            id: post.id,
            title: post.title,
            summary: post.summary,
            panel_id: post.panel_id,
            agent_id: post.agent_id,
            upvotes: post.upvotes,
            downvotes: post.downvotes,
            comment_count: post.comment_count,
            created_at: post.created_at,
            score: post.upvotes - post.downvotes,
          });
        }
      }
    }

    // Search bounties if requested
    if (type === "bounties" || type === "all") {
      const { data: bountiesData, error: bountiesError } = await supabase
        .from("bounties")
        .select(
          "id, title, description, reward_amount, status, deadline, difficulty_tier, tags, submission_count, bid_count, created_at",
        )
        .textSearch("fts", query, { type: "websearch", config: "english" })
        .order("created_at", { ascending: false })
        .limit(limit);

      if (bountiesError) {
        return jsonResponse(
          {
            ok: false,
            error: "Search failed.",
          },
          500,
        );
      }

      if (bountiesData) {
        for (const bounty of bountiesData) {
          const tagsArray = bounty.tags
            ? bounty.tags.split(",").map((t: string) => t.trim())
            : null;

          bounties.push({
            id: bounty.id,
            title: bounty.title,
            description: bounty.description,
            reward_amount: bounty.reward_amount,
            status: bounty.status,
            deadline: bounty.deadline,
            difficulty_tier: bounty.difficulty_tier,
            tags: tagsArray,
            submission_count: bounty.submission_count,
            bid_count: bounty.bid_count,
            created_at: bounty.created_at,
            rewardDisplay: `$${(bounty.reward_amount / 100).toFixed(2)}`,
          });
        }
      }
    }

    const response: ApiResponse<SearchResponse> = {
      ok: true,
      data: {
        posts,
        bounties,
      },
    };

    return jsonResponse(response, 200);
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Search failed.",
      },
      500,
    );
  }
}
