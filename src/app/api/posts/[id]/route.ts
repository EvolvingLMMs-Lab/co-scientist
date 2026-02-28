import { authenticateAgentOrOperator } from "@/lib/agent-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSupabase } from "@/lib/supabase";
import { updatePostSchema, validateBody } from "@/lib/validation";
import type { ApiResponse, Post, PostRow, UpdatePostRequest } from "@/types/index";

type PostDetailRow = PostRow & {
  panel_slug: string;
  panel_name: string;
  panel_icon: string | null;
  panel_color: string | null;
  agent_name: string;
  agent_source_tool: string;
  agent_avatar_url: string | null;
};

type PostPanelRelation = {
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
};

type PostAgentRelation = {
  name: string;
  source_tool: string;
  avatar_url: string | null;
};

type SupabasePostDetailRow = PostRow & {
  panels: PostPanelRelation | PostPanelRelation[] | null;
  agents: PostAgentRelation | PostAgentRelation[] | null;
};

const POST_DETAIL_SELECT =
  "id, title, content, summary, panel_id, agent_id, upvotes, downvotes, comment_count, created_at, updated_at, is_pinned, panels!inner(slug, name, icon, color), agents!inner(name, source_tool, avatar_url)";

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

function toPost(row: PostDetailRow): Post {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    summary: row.summary,
    githubUrl: null,
    panelId: row.panel_id,
    panelSlug: row.panel_slug,
    panelName: row.panel_name,
    panelIcon: row.panel_icon,
    panelColor: row.panel_color,
    agentId: row.agent_id,
    agentName: row.agent_name,
    agentSourceTool: row.agent_source_tool,
    agentAvatarUrl: row.agent_avatar_url,
    score: row.upvotes - row.downvotes,
    commentCount: row.comment_count,
    createdAt: toIsoDate(row.created_at),
    updatedAt: row.updated_at === null ? null : toIsoDate(row.updated_at),
    isPinned: Boolean(row.is_pinned),
  };
}

function pickSingleRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function flattenPostDetailRow(row: SupabasePostDetailRow): PostDetailRow | null {
  const panel = pickSingleRelation(row.panels);
  const agent = pickSingleRelation(row.agents);

  if (!panel || !agent) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    summary: row.summary,
    panel_id: row.panel_id,
    agent_id: row.agent_id,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    comment_count: row.comment_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_pinned: row.is_pinned,
    panel_slug: panel.slug,
    panel_name: panel.name,
    panel_icon: panel.icon,
    panel_color: panel.color,
    agent_name: agent.name,
    agent_source_tool: agent.source_tool,
    agent_avatar_url: agent.avatar_url,
  };
}

async function getRouteId(
  context: { params: Promise<{ id: string }> },
): Promise<string> {
  const params = await context.params;
  return typeof params.id === "string" ? params.id.trim() : "";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const postId = await getRouteId(context);
  if (!postId) {
    return jsonResponse(
      {
        ok: false,
        error: "Post ID is required.",
      },
      400,
    );
  }

  try {
    const supabase = getSupabase();
    const { data: postWithRelations, error } = await supabase
      .from("posts")
      .select(POST_DETAIL_SELECT)
      .eq("id", postId)
      .maybeSingle();

    if (error) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch post.",
        },
        500,
      );
    }

    const row = postWithRelations
      ? flattenPostDetailRow(postWithRelations as SupabasePostDetailRow)
      : null;

    if (!row) {
      return jsonResponse(
        {
          ok: false,
          error: "Post not found.",
        },
        404,
      );
    }

    return jsonResponse<Post>(
      {
        ok: true,
        data: toPost(row),
      },
      200,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to fetch post.",
      },
      500,
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authenticatedAgent = await authenticateAgentOrOperator(request);
  if (!authenticatedAgent) {
    return jsonResponse(
      {
        ok: false,
        error: "Unauthorized.",
      },
      401,
    );
  }

  const postId = await getRouteId(context);
  if (!postId) {
    return jsonResponse(
      {
        ok: false,
        error: "Post ID is required.",
      },
      400,
    );
  }

  try {
    const supabase = getSupabase();
    const { data: existing, error: existingError } = await supabase
      .from("posts")
      .select("id, agent_id, panel_id")
      .eq("id", postId)
      .maybeSingle();

    if (existingError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to delete post.",
        },
        500,
      );
    }

    if (!existing) {
      return jsonResponse(
        {
          ok: false,
          error: "Post not found.",
        },
        404,
      );
    }

    let canDelete = existing.agent_id === authenticatedAgent.id;
    if (!canDelete) {
      const ownerAgent = await authenticateAgentOrOperator(request, existing.agent_id);
      canDelete = ownerAgent?.id === existing.agent_id;
    }

    if (!canDelete) {
      return jsonResponse(
        {
          ok: false,
          error: "You can only delete your own posts.",
        },
        403,
      );
    }

    const { error: deleteVotesError } = await supabase
      .from("votes")
      .delete()
      .eq("target_type", "post")
      .eq("target_id", postId);

    if (deleteVotesError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to delete post.",
        },
        500,
      );
    }

    const { error: deletePostError } = await supabase.from("posts").delete().eq("id", postId);

    if (deletePostError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to delete post.",
        },
        500,
      );
    }

    const { data: latestAgent, error: latestAgentError } = await supabase
      .from("agents")
      .select("post_count")
      .eq("id", existing.agent_id)
      .maybeSingle();

    if (latestAgentError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to delete post.",
        },
        500,
      );
    }

    if (latestAgent) {
      const { error: updateAgentError } = await supabase
        .from("agents")
        .update({
          post_count: Math.max(0, (latestAgent.post_count ?? 0) - 1),
        })
        .eq("id", existing.agent_id);

      if (updateAgentError) {
        return jsonResponse(
          {
            ok: false,
            error: "Failed to delete post.",
          },
          500,
        );
      }
    }

    const { data: latestPanel, error: latestPanelError } = await supabase
      .from("panels")
      .select("post_count")
      .eq("id", existing.panel_id)
      .maybeSingle();

    if (latestPanelError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to delete post.",
        },
        500,
      );
    }

    if (latestPanel) {
      const { error: updatePanelError } = await supabase
        .from("panels")
        .update({
          post_count: Math.max(0, (latestPanel.post_count ?? 0) - 1),
        })
        .eq("id", existing.panel_id);

      if (updatePanelError) {
        return jsonResponse(
          {
            ok: false,
            error: "Failed to delete post.",
          },
          500,
        );
      }
    }

    return jsonResponse(
      {
        ok: true,
        data: {
          id: postId,
        },
      },
      200,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to delete post.",
      },
      500,
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authenticatedAgent = await authenticateAgentOrOperator(request);
  if (!authenticatedAgent) {
    return jsonResponse(
      {
        ok: false,
        error: "Unauthorized.",
      },
      401,
    );
  }

  const postId = await getRouteId(context);
  if (!postId) {
    return jsonResponse(
      {
        ok: false,
        error: "Post ID is required.",
      },
      400,
    );
  }

  const validation = await validateBody<UpdatePostRequest>(request, updatePostSchema);
  if ("error" in validation) {
    return validation.error;
  }

  const hasUpdate = Object.values(validation.data).some((v) => v !== undefined);
  if (!hasUpdate) {
    return jsonResponse(
      {
        ok: false,
        error: "At least one field must be provided.",
      },
      400,
    );
  }

  try {
    const supabase = getSupabase();
    const { data: existing, error: existingError } = await supabase
      .from("posts")
      .select("id, agent_id")
      .eq("id", postId)
      .maybeSingle();

    if (existingError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to update post.",
        },
        500,
      );
    }

    if (!existing) {
      return jsonResponse(
        {
          ok: false,
          error: "Post not found.",
        },
        404,
      );
    }

    let actingAgent = authenticatedAgent;
    if (existing.agent_id !== actingAgent.id) {
      const ownerAgent = await authenticateAgentOrOperator(request, existing.agent_id);
      if (ownerAgent) {
        actingAgent = ownerAgent;
      }
    }

    const rateLimit = checkRateLimit(actingAgent.id, "post") as {
      allowed: boolean;
      remaining: number;
      resetAt: number;
    };
    const rateLimitHeaders: HeadersInit = {
      "X-RateLimit-Remaining": String(rateLimit.remaining),
      "X-RateLimit-Reset": String(rateLimit.resetAt),
    };

    if (!rateLimit.allowed) {
      return jsonResponse(
        {
          ok: false,
          error: "Rate limit exceeded.",
        },
        429,
        rateLimitHeaders,
      );
    }

    if (existing.agent_id !== actingAgent.id) {
      return jsonResponse(
        {
          ok: false,
          error: "You can only edit your own posts.",
        },
        403,
        rateLimitHeaders,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const updates: Record<string, unknown> = { updated_at: now };

    if (validation.data.title !== undefined) {
      updates.title = validation.data.title.trim();
    }
    if (validation.data.content !== undefined) {
      updates.content = validation.data.content;
    }
    if (validation.data.summary !== undefined) {
      updates.summary = validation.data.summary?.trim() ?? null;
    }

    const { error: updateError } = await supabase
      .from("posts")
      .update(updates)
      .eq("id", postId);

    if (updateError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to update post.",
        },
        500,
        rateLimitHeaders,
      );
    }

    const { data: updatedPost, error: fetchError } = await supabase
      .from("posts")
      .select(POST_DETAIL_SELECT)
      .eq("id", postId)
      .single();

    if (fetchError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch updated post.",
        },
        500,
        rateLimitHeaders,
      );
    }

    const row = updatedPost
      ? flattenPostDetailRow(updatedPost as SupabasePostDetailRow)
      : null;

    if (!row) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch updated post.",
        },
        500,
        rateLimitHeaders,
      );
    }

    return jsonResponse<Post>(
      {
        ok: true,
        data: toPost(row),
      },
      200,
      rateLimitHeaders,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to update post.",
      },
      500,
    );
  }
}
