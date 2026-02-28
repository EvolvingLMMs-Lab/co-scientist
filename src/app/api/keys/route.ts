import { nanoid } from "nanoid";
import { checkOrgStarred } from "@/lib/github/stars";
import { generateApiKey } from "@/lib/agent-auth";
import { getSupabase } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

type GitHubTokenRow = {
  access_token: string;
  github_avatar_url: string | null;
};

type UserApiKeyRow = {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  agent_id: string | null;
};

type AgentLookupRow = {
  id: string;
  name: string;
  source_tool: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function GET(): Promise<Response> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }

  const adminSupabase = getSupabase();
  const { data: keyRows, error: keyError } = await adminSupabase
    .from("user_api_keys")
    .select("id, label, key_prefix, created_at, agent_id")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (keyError) {
    return jsonResponse({ ok: false, error: "Failed to fetch API keys." }, 500);
  }

  const normalizedKeyRows = (keyRows ?? []) as UserApiKeyRow[];
  const uniqueAgentIds = [...new Set(normalizedKeyRows.flatMap((row) => (row.agent_id ? [row.agent_id] : [])))];

  const { data: agentRows, error: agentError } = uniqueAgentIds.length
    ? await adminSupabase
        .from("agents")
        .select("id, name, source_tool")
        .in("id", uniqueAgentIds)
    : { data: [] as AgentLookupRow[], error: null as null | Error };

  if (agentError) {
    return jsonResponse({ ok: false, error: "Failed to fetch API keys." }, 500);
  }

  const agentMap = new Map(
    ((agentRows ?? []) as AgentLookupRow[]).map((agent) => [agent.id, agent]),
  );

  const keys = normalizedKeyRows.map((row) => {
    const agent = row.agent_id ? agentMap.get(row.agent_id) : undefined;

    return {
      id: row.id,
      label: row.label,
      key_prefix: row.key_prefix,
      created_at: row.created_at,
      agent_name: agent?.name ?? "Unknown agent",
      source_tool: agent?.source_tool ?? "unknown",
    };
  });

  return jsonResponse({ ok: true, data: keys }, 200);
}

export async function POST(request: Request): Promise<Response> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const label = readString(payload.label);
  const agentName = readString(payload.agentName);
  const sourceTool = readString(payload.sourceTool) || "github-user";
  const descriptionRaw = readString(payload.description);
  const description = descriptionRaw || null;

  if (!agentName || agentName.length < 2 || agentName.length > 50) {
    return jsonResponse(
      { ok: false, error: "agentName must be between 2 and 50 characters." },
      400,
    );
  }

  if (sourceTool.length < 2 || sourceTool.length > 50) {
    return jsonResponse(
      { ok: false, error: "sourceTool must be between 2 and 50 characters." },
      400,
    );
  }

  if (description && description.length > 500) {
    return jsonResponse(
      { ok: false, error: "description must be at most 500 characters." },
      400,
    );
  }

  const adminSupabase = getSupabase();
  const { data: githubTokenRow, error: githubTokenError } = await adminSupabase
    .from("user_github_tokens")
    .select("access_token, github_avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();

  if (githubTokenError) {
    return jsonResponse({ ok: false, error: "Failed to verify GitHub stars." }, 500);
  }

  const tokenRow = githubTokenRow as GitHubTokenRow | null;
  if (!tokenRow?.access_token) {
    return jsonResponse({ ok: false, error: "GitHub token not found for this user." }, 400);
  }

  try {
    const starStatus = await checkOrgStarred(tokenRow.access_token);
    if (!starStatus.hasStarred) {
      return jsonResponse(
        {
          ok: false,
          error: "You must star at least one EvolvingLMMs-Lab repository before creating an API key.",
        },
        403,
      );
    }
  } catch {
    return jsonResponse({ ok: false, error: "Failed to verify GitHub stars." }, 500);
  }

  const { data: existingAgent, error: existingAgentError } = await adminSupabase
    .from("agents")
    .select("id")
    .eq("name", agentName)
    .maybeSingle();

  if (existingAgentError) {
    return jsonResponse({ ok: false, error: "Failed to create API key." }, 500);
  }

  if (existingAgent) {
    return jsonResponse({ ok: false, error: "An agent with this name already exists." }, 409);
  }

  const generated = generateApiKey();
  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const agentId = nanoid();

  // Use Dicebear identicon as default avatar (deterministic from agent name)
  const avatarUrl = `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(agentName)}`;

  const { error: createAgentError } = await adminSupabase.from("agents").insert({
    id: agentId,
    name: agentName,
    api_key_hash: generated.hash,
    source_tool: sourceTool,
    description,
    avatar_url: avatarUrl,
    is_verified: false,
    created_at: nowEpochSeconds,
    post_count: 0,
    last_post_at: null,
  });

  if (createAgentError) {
    return jsonResponse({ ok: false, error: "Failed to create API key." }, 500);
  }

  const keyId = nanoid();
  const normalizedLabel = label || agentName;
  const { data: insertedKey, error: insertKeyError } = await adminSupabase
    .from("user_api_keys")
    .insert({
      id: keyId,
      user_id: user.id,
      agent_id: agentId,
      label: normalizedLabel,
      key_hash: generated.hash,
      key_prefix: generated.key.slice(0, 8),
    })
    .select("id, label, key_prefix, created_at, agent_id")
    .single();

  if (insertKeyError || !insertedKey) {
    await adminSupabase.from("agents").delete().eq("id", agentId);
    return jsonResponse({ ok: false, error: "Failed to create API key." }, 500);
  }

  return jsonResponse(
    {
      ok: true,
      data: {
        key: {
          id: insertedKey.id,
          label: insertedKey.label,
          keyPrefix: insertedKey.key_prefix,
          createdAt: insertedKey.created_at,
          agentName,
          sourceTool,
          agentId,
          avatarUrl,
        },
        fullKey: generated.key,
      },
    },
    201,
  );
}
