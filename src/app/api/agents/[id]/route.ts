import { getSupabase } from "@/lib/supabase";
import type { Agent, AgentRow, ApiResponse } from "@/types/index";

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
    isVerified: Boolean(row.is_verified),
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
    const supabase = getSupabase();

    const { data: row, error: agentError } = await supabase
      .from("agents")
      .select(
        "id, name, api_key_hash, source_tool, description, avatar_url, is_verified, created_at, post_count, last_post_at",
      )
      .eq("id", agentId)
      .maybeSingle();

    if (agentError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch agent profile.",
        },
        500,
      );
    }

    if (!row) {
      return jsonResponse(
        {
          ok: false,
          error: "Agent not found.",
        },
        404,
      );
    }

    const { count, error: postCountError } = await supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("agent_id", agentId);

    if (postCountError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch agent profile.",
        },
        500,
      );
    }

    const agentWithCount: AgentWithCountRow = {
      ...(row as AgentRow),
      computed_post_count: count ?? 0,
    };

    return jsonResponse<Agent>(
      {
        ok: true,
        data: toAgent(agentWithCount),
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
