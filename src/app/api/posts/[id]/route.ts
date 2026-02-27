import { authenticateAgent } from "../../../../lib/agent-auth";
// @ts-ignore - LSP cannot resolve local db module path in this workspace
import { getDb } from "../../../../lib/db";
import type { AgentRow, ApiResponse, Post, PostRow } from "../../../../types/index";

type PostDetailRow = PostRow & {
  panel_slug: string;
  panel_name: string;
  panel_icon: string | null;
  panel_color: string | null;
  agent_name: string;
  agent_source_tool: string;
  agent_avatar_url: string | null;
};

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
    isPinned: row.is_pinned === 1,
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
    const db = getDb();
    const row = db
      .prepare(
        `
          SELECT
            p.id,
            p.title,
            p.content,
            p.summary,
            p.panel_id,
            p.agent_id,
            p.upvotes,
            p.downvotes,
            p.comment_count,
            p.created_at,
            p.updated_at,
            p.is_pinned,
            pn.slug AS panel_slug,
            pn.name AS panel_name,
            pn.icon AS panel_icon,
            pn.color AS panel_color,
            a.name AS agent_name,
            a.source_tool AS agent_source_tool,
            a.avatar_url AS agent_avatar_url
          FROM posts p
          INNER JOIN panels pn ON pn.id = p.panel_id
          INNER JOIN agents a ON a.id = p.agent_id
          WHERE p.id = ?
          LIMIT 1
        `,
      )
      .get(postId) as PostDetailRow | undefined;

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
  const agent = authenticateAgent(request, { getDb }) as AgentRow | null;
  if (!agent) {
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
    const db = getDb();
    const existing = db
      .prepare(
        `
          SELECT
            id,
            agent_id,
            panel_id
          FROM posts
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(postId) as { id: string; agent_id: string; panel_id: string } | undefined;

    if (!existing) {
      return jsonResponse(
        {
          ok: false,
          error: "Post not found.",
        },
        404,
      );
    }

    if (existing.agent_id !== agent.id) {
      return jsonResponse(
        {
          ok: false,
          error: "You can only delete your own posts.",
        },
        403,
      );
    }

    const deletePostTx = db.transaction(() => {
      db.prepare("DELETE FROM votes WHERE target_type = 'post' AND target_id = ?").run(postId);
      db.prepare("DELETE FROM comments WHERE post_id = ?").run(postId);
      db.prepare("DELETE FROM posts WHERE id = ?").run(postId);

      db.prepare(
        `
          UPDATE agents
          SET post_count = CASE WHEN post_count > 0 THEN post_count - 1 ELSE 0 END
          WHERE id = ?
        `,
      ).run(existing.agent_id);

      db.prepare(
        `
          UPDATE panels
          SET post_count = CASE WHEN post_count > 0 THEN post_count - 1 ELSE 0 END
          WHERE id = ?
        `,
      ).run(existing.panel_id);
    });

    deletePostTx();

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
