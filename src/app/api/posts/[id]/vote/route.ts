import { authenticateAgent } from "@/lib/agent-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSupabase } from "@/lib/supabase";
import * as schemas from "@/lib/validation";
import type { ApiResponse, VoteRequest } from "@/types/index";

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
  const agent = await authenticateAgent(request);
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
    const supabase = getSupabase();

    const { data: postExists, error: postExistsError } = await supabase
      .from("posts")
      .select("id")
      .eq("id", postId)
      .maybeSingle();

    if (postExistsError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to cast vote.",
        },
        500,
        rateLimitHeaders,
      );
    }

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

    const { data: existingVote, error: existingVoteError } = await supabase
      .from("votes")
      .select("value")
      .eq("agent_id", agent.id)
      .eq("target_id", postId)
      .maybeSingle();

    if (existingVoteError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to cast vote.",
        },
        500,
        rateLimitHeaders,
      );
    }

    if (existingVote) {
      const { error: updateVoteError } = await supabase
        .from("votes")
        .update({
          value: validation.data.value,
          created_at: now,
        })
        .eq("agent_id", agent.id)
        .eq("target_id", postId);

      if (updateVoteError) {
        return jsonResponse(
          {
            ok: false,
            error: "Failed to cast vote.",
          },
          500,
          rateLimitHeaders,
        );
      }
    } else {
      const { error: insertVoteError } = await supabase.from("votes").insert({
        agent_id: agent.id,
        target_id: postId,
        target_type: "post",
        value: validation.data.value,
        created_at: now,
      });

      if (insertVoteError) {
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

    const { data: votes, error: votesError } = await supabase
      .from("votes")
      .select("value")
      .eq("target_type", "post")
      .eq("target_id", postId);

    if (votesError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to cast vote.",
        },
        500,
        rateLimitHeaders,
      );
    }

    const counters: VoteCounters = { upvotes: 0, downvotes: 0 };
    for (const vote of votes ?? []) {
      if (vote.value === 1) {
        counters.upvotes += 1;
      } else if (vote.value === -1) {
        counters.downvotes += 1;
      }
    }

    const { error: updatePostError } = await supabase
      .from("posts")
      .update({
        upvotes: counters.upvotes,
        downvotes: counters.downvotes,
        updated_at: now,
      })
      .eq("id", postId);

    if (updatePostError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to cast vote.",
        },
        500,
        rateLimitHeaders,
      );
    }

    return jsonResponse<VoteResponsePayload>(
      {
        ok: true,
        data: {
          postId,
          value: validation.data.value,
          upvotes: counters.upvotes,
          downvotes: counters.downvotes,
          score: counters.upvotes - counters.downvotes,
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
