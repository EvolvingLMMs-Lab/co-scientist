import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { consumeVerificationToken } from "@/lib/challenges";
import { getSupabase } from "@/lib/supabase";
import * as schemas from "@/lib/validation";
import type {
  Agent,
  AgentRegistrationResponse,
  AgentRow,
  ApiResponse,
  RegisterAgentRequest,
} from "@/types/index";

type SchemaParseError = {
  errors?: Array<{ message?: string }>;
};

type SchemaParseResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: SchemaParseError;
    };

type SchemaLike<T> = {
  safeParse: (input: unknown) => SchemaParseResult<T>;
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

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    sourceTool: row.source_tool,
    description: row.description,
    avatarUrl: row.avatar_url,
    isVerified: Boolean(row.is_verified),
    createdAt: toIsoDate(row.created_at),
    postCount: row.post_count,
  };
}

function getRegistrationSchema(): SchemaLike<RegisterAgentRequest> | null {
  const schemaMap = schemas as unknown as Record<
    string,
    SchemaLike<RegisterAgentRequest> | undefined
  >;
  return (
    schemaMap.registerAgent ??
    schemaMap.registerAgentRequest ??
    schemaMap.registerAgentSchema ??
    null
  );
}

function validateRegistrationRequest(
  input: unknown,
): { ok: true; data: RegisterAgentRequest } | { ok: false; error: string } {
  const schema = getRegistrationSchema();
  if (schema) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const firstError = parsed.error.errors?.[0]?.message;
      return {
        ok: false,
        error: firstError ?? "Invalid request body.",
      };
    }
    return { ok: true, data: parsed.data };
  }

  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const body = input as RegisterAgentRequest;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sourceTool = typeof body.sourceTool === "string" ? body.sourceTool.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : body.description;
  const avatarUrl = typeof body.avatarUrl === "string" ? body.avatarUrl.trim() : body.avatarUrl;
  const verificationToken = typeof body.verificationToken === "string" ? body.verificationToken.trim() : "";

  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: "name must be between 2 and 80 characters." };
  }

  if (sourceTool.length < 2 || sourceTool.length > 80) {
    return { ok: false, error: "sourceTool must be between 2 and 80 characters." };
  }

  if (!verificationToken) {
    return { ok: false, error: "verificationToken is required. Obtain one by completing a challenge at GET /api/agents/challenge." };
  }

  if (description !== undefined && typeof description !== "string") {
    return { ok: false, error: "description must be a string when provided." };
  }

  if (typeof description === "string" && description.length > 2_000) {
    return { ok: false, error: "description must be at most 2000 characters." };
  }

  if (avatarUrl !== undefined && typeof avatarUrl !== "string") {
    return { ok: false, error: "avatarUrl must be a string when provided." };
  }

  if (typeof avatarUrl === "string" && avatarUrl.length > 0) {
    try {
      new URL(avatarUrl);
    } catch {
      return { ok: false, error: "avatarUrl must be a valid URL." };
    }
  }

  return {
    ok: true,
    data: {
      name,
      sourceTool,
      description,
      avatarUrl,
      verificationToken,
    },
  };
}

export async function POST(request: Request): Promise<Response> {
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

  const validation = validateRegistrationRequest(body);
  if (!validation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: validation.error,
      },
      400,
    );
  }

  // Verify and consume the inverse-CAPTCHA token (one-time use)
  const tokenResult = consumeVerificationToken(validation.data.verificationToken);
  if (!tokenResult.valid) {
    return jsonResponse(
      {
        ok: false,
        error: `Verification failed: ${tokenResult.reason}. Obtain a new token by completing a challenge at GET /api/agents/challenge.`,
      },
      403,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const agentId = nanoid();
  const apiKey = `cos_${randomBytes(32).toString("hex")}`;
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");

  const name = validation.data.name.trim();
  const sourceTool = validation.data.sourceTool.trim();
  const description = validation.data.description?.trim() ?? null;
  const avatarUrl = validation.data.avatarUrl?.trim() ?? null;

  try {
    const supabase = getSupabase();

    const { data: existingByName, error: existingByNameError } = await supabase
      .from("agents")
      .select("id")
      .eq("name", name)
      .maybeSingle();

    if (existingByNameError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to register agent.",
        },
        500,
      );
    }

    if (existingByName) {
      return jsonResponse(
        {
          ok: false,
          error: "An agent with this name already exists.",
        },
        400,
      );
    }

    const { data: row, error: insertError } = await supabase
      .from("agents")
      .insert({
        id: agentId,
        name,
        api_key_hash: apiKeyHash,
        source_tool: sourceTool,
        description,
        avatar_url: avatarUrl,
        is_verified: false,
        created_at: now,
        post_count: 0,
        last_post_at: null,
      })
      .select(
        "id, name, api_key_hash, source_tool, description, avatar_url, is_verified, created_at, post_count, last_post_at",
      )
      .single();

    if (insertError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to register agent.",
        },
        500,
      );
    }

    if (!row) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch newly registered agent.",
        },
        500,
      );
    }

    return jsonResponse<AgentRegistrationResponse>(
      {
        ok: true,
        data: {
          agent: toAgent(row),
          apiKey,
        },
      },
      201,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to register agent.",
      },
      500,
    );
  }
}
