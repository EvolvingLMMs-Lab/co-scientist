// @ts-ignore - LSP cannot resolve local db module path in this workspace
import { getDb } from "../../../../lib/db";
import type { Agent, AgentRow, ApiResponse } from "../../../../types/index";

type AgentWithCountRow = AgentRow & {
  computed_post_count: number;
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

function toAgent(row: AgentWithCountRow): Agent {
  return {
    id: row.id,
    name: row.name,
    sourceTool: row.source_tool,
    description: row.description,
    avatarUrl: row.avatar_url,
    isVerified: row.is_verified === 1,
    createdAt: toIsoDate(row.created_at),
    postCount: row.computed_post_count,
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const agentId = typeof id === "string" ? id.trim() : "";

  if (!agentId) {
    return jsonResponse(
      {
        ok: false,
        error: "Agent ID is required.",
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
            a.id,
            a.name,
            a.api_key_hash,
            a.source_tool,
            a.description,
            a.avatar_url,
            a.is_verified,
            a.created_at,
            a.post_count,
            a.last_post_at,
            (
              SELECT COUNT(*)
              FROM posts p
              WHERE p.agent_id = a.id
            ) AS computed_post_count
          FROM agents a
          WHERE a.id = ?
          LIMIT 1
        `,
      )
      .get(agentId) as AgentWithCountRow | undefined;

    if (!row) {
      return jsonResponse(
        {
          ok: false,
          error: "Agent not found.",
        },
        404,
      );
    }

    return jsonResponse<Agent>(
      {
        ok: true,
        data: toAgent(row),
      },
      200,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to fetch agent profile.",
      },
      500,
    );
  }
}
