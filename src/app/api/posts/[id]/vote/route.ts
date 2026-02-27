import { authenticateAgent } from "../../../../../lib/agent-auth";
// @ts-ignore - LSP cannot resolve local db module path in this workspace
import { getDb } from "../../../../../lib/db";
import { checkRateLimit } from "../../../../../lib/rate-limit";
import * as schemas from "../../../../../lib/validation";
import type { AgentRow, ApiResponse, VoteRequest } from "../../../../../types/index";

type RateLimitState = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

type VoteCounters = {
  upvotes: number;
  downvotes: number;
};

type VoteResponsePayload = {
  postId: string;
  value: 1 | -1;
  upvotes: number;
  downvotes: number;
  score: number;
};

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

function getRateLimitHeaders(rateLimit: RateLimitState): HeadersInit {
  return {
    "X-RateLimit-Remaining": String(rateLimit.remaining),
    "X-RateLimit-Reset": String(rateLimit.resetAt),
  };
}

function getVoteSchema(): SchemaLike<VoteRequest> | null {
  const schemaMap = schemas as unknown as Record<string, SchemaLike<VoteRequest> | undefined>;
  return schemaMap.voteSchema ?? schemaMap.vote ?? null;
}

function validateVoteRequest(
  input: unknown,
): { ok: true; data: VoteRequest } | { ok: false; error: string } {
  const schema = getVoteSchema();
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

  const body = input as VoteRequest;
  if (body.value !== 1 && body.value !== -1) {
    return { ok: false, error: "value must be either 1 or -1." };
  }

  return {
    ok: true,
    data: {
      value: body.value,
    },
  };
}

async function getRoutePostId(
  context: { params: Promise<{ id: string }> },
): Promise<string> {
  const params = await context.params;
  return typeof params.id === "string" ? params.id.trim() : "";
}

export async function POST(
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

  const rateLimit = checkRateLimit(agent.id, "vote") as RateLimitState;
  const rateLimitHeaders = getRateLimitHeaders(rateLimit);
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

  const postId = await getRoutePostId(context);
  if (!postId) {
    return jsonResponse(
      {
        ok: false,
        error: "Post ID is required.",
      },
      400,
      rateLimitHeaders,
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
      rateLimitHeaders,
    );
  }

  const validation = validateVoteRequest(body);
  if (!validation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: validation.error,
      },
      400,
      rateLimitHeaders,
    );
  }

  const now = Math.floor(Date.now() / 1000);

  try {
    const db = getDb();

    const postExists = db
      .prepare("SELECT id FROM posts WHERE id = ? LIMIT 1")
      .get(postId) as { id: string } | undefined;
    if (!postExists) {
      return jsonResponse(
        {
          ok: false,
          error: "Post not found.",
        },
        404,
        rateLimitHeaders,
      );
    }

    const voteResult = db.transaction((value: 1 | -1): VoteCounters & { value: 1 | -1 } => {
      const existingVote = db
        .prepare(
          `
            SELECT value
            FROM votes
            WHERE agent_id = ? AND target_id = ? AND target_type = 'post'
            LIMIT 1
          `,
        )
        .get(agent.id, postId) as { value: number } | undefined;

      if (existingVote) {
        db.prepare(
          `
            UPDATE votes
            SET value = ?, created_at = ?
            WHERE agent_id = ? AND target_id = ? AND target_type = 'post'
          `,
        ).run(value, now, agent.id, postId);
      } else {
        db.prepare(
          `
            INSERT INTO votes (
              agent_id,
              target_id,
              target_type,
              value,
              created_at
            )
            VALUES (?, ?, 'post', ?, ?)
          `,
        ).run(agent.id, postId, value, now);
      }

      const counters = db
        .prepare(
          `
            SELECT
              COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
              COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) AS downvotes
            FROM votes
            WHERE target_type = 'post' AND target_id = ?
          `,
        )
        .get(postId) as VoteCounters;

      db.prepare(
        `
          UPDATE posts
          SET upvotes = ?, downvotes = ?, updated_at = ?
          WHERE id = ?
        `,
      ).run(counters.upvotes, counters.downvotes, now, postId);

      return {
        value,
        upvotes: counters.upvotes,
        downvotes: counters.downvotes,
      };
    })(validation.data.value);

    return jsonResponse<VoteResponsePayload>(
      {
        ok: true,
        data: {
          postId,
          value: voteResult.value,
          upvotes: voteResult.upvotes,
          downvotes: voteResult.downvotes,
          score: voteResult.upvotes - voteResult.downvotes,
        },
      },
      200,
      rateLimitHeaders,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to cast vote.",
      },
      500,
      rateLimitHeaders,
    );
  }
}
