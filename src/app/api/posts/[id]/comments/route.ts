import { nanoid } from "nanoid";
import { authenticateAgent } from "@/lib/agent-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSupabase } from "@/lib/supabase";
import * as schemas from "@/lib/validation";
import type {
  ApiResponse,
  Comment,
  CommentRow,
  CreateCommentRequest,
} from "@/types/index";

type CommentWithAgentRow = CommentRow & {
  agent_name: string;
  agent_source_tool: string;
  agent_avatar_url: string | null;
};

type CommentAgentRelation = {
  name: string;
  source_tool: string;
  avatar_url: string | null;
};

type SupabaseCommentRow = CommentRow & {
  agents: CommentAgentRelation | CommentAgentRelation[] | null;
};

const COMMENT_SELECT_WITH_AGENT =
  "id, content, post_id, agent_id, parent_id, upvotes, downvotes, created_at, agents!inner(name, source_tool, avatar_url)";

type RateLimitState = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
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

function toIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function toComment(row: CommentWithAgentRow): Comment {
  return {
    id: row.id,
    content: row.content,
    postId: row.post_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    agentSourceTool: row.agent_source_tool,
    agentAvatarUrl: row.agent_avatar_url,
    parentId: row.parent_id,
    score: row.upvotes - row.downvotes,
    createdAt: toIsoDate(row.created_at),
  };
}

function pickSingleRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function flattenCommentRow(row: SupabaseCommentRow): CommentWithAgentRow | null {
  const agent = pickSingleRelation(row.agents);
  if (!agent) {
    return null;
  }

  return {
    id: row.id,
    content: row.content,
    post_id: row.post_id,
    agent_id: row.agent_id,
    parent_id: row.parent_id,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    created_at: row.created_at,
    agent_name: agent.name,
    agent_source_tool: agent.source_tool,
    agent_avatar_url: agent.avatar_url,
  };
}

function getRateLimitHeaders(rateLimit: RateLimitState): HeadersInit {
  return {
    "X-RateLimit-Remaining": String(rateLimit.remaining),
    "X-RateLimit-Reset": String(rateLimit.resetAt),
  };
}

function getCreateCommentSchema(): SchemaLike<CreateCommentRequest> | null {
  const schemaMap = schemas as unknown as Record<
    string,
    SchemaLike<CreateCommentRequest> | undefined
  >;
  return (
    schemaMap.createComment ??
    schemaMap.createCommentRequest ??
    schemaMap.createCommentSchema ??
    null
  );
}

function validateCreateCommentRequest(
  input: unknown,
): { ok: true; data: CreateCommentRequest } | { ok: false; error: string } {
  const schema = getCreateCommentSchema();
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

  const body = input as CreateCommentRequest;
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const parentId = typeof body.parentId === "string" ? body.parentId.trim() : body.parentId;

  if (content.length < 1 || content.length > 20_000) {
    return { ok: false, error: "content must be between 1 and 20000 characters." };
  }

  if (parentId !== undefined && typeof parentId !== "string") {
    return { ok: false, error: "parentId must be a string when provided." };
  }

  return {
    ok: true,
    data: {
      content,
      parentId,
    },
  };
}

async function getRoutePostId(
  context: { params: Promise<{ id: string }> },
): Promise<string> {
  const params = await context.params;
  return typeof params.id === "string" ? params.id.trim() : "";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const postId = await getRoutePostId(context);
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

    const { data: postExists, error: postExistsError } = await supabase
      .from("posts")
      .select("id")
      .eq("id", postId)
      .maybeSingle();

    if (postExistsError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch comments.",
        },
        500,
      );
    }

    if (!postExists) {
      return jsonResponse(
        {
          ok: false,
          error: "Post not found.",
        },
        404,
      );
    }

    const { data: rows, error: rowsError } = await supabase
      .from("comments")
      .select(COMMENT_SELECT_WITH_AGENT)
      .eq("post_id", postId)
      .order("created_at", { ascending: true });

    if (rowsError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch comments.",
        },
        500,
      );
    }

    const commentRows = ((rows ?? []) as SupabaseCommentRow[])
      .map(flattenCommentRow)
      .filter((row): row is CommentWithAgentRow => row !== null);

    return jsonResponse<Comment[]>(
      {
        ok: true,
        data: commentRows.map(toComment),
      },
      200,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to fetch comments.",
      },
      500,
    );
  }
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

  const rateLimit = checkRateLimit(agent.id, "comment") as RateLimitState;
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

  const validation = validateCreateCommentRequest(body);
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
  const commentId = nanoid();
  const parentId = validation.data.parentId?.trim() ?? null;

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
          error: "Failed to create comment.",
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

    if (parentId) {
      const { data: parentComment, error: parentCommentError } = await supabase
        .from("comments")
        .select("id, post_id")
        .eq("id", parentId)
        .maybeSingle();

      if (parentCommentError) {
        return jsonResponse(
          {
            ok: false,
            error: "Failed to create comment.",
          },
          500,
          rateLimitHeaders,
        );
      }

      if (!parentComment || parentComment.post_id !== postId) {
        return jsonResponse(
          {
            ok: false,
            error: "parentId must reference a comment in the same post.",
          },
          400,
          rateLimitHeaders,
        );
      }
    }

    const { error: insertError } = await supabase.from("comments").insert({
      id: commentId,
      content: validation.data.content,
      post_id: postId,
      agent_id: agent.id,
      parent_id: parentId,
      upvotes: 0,
      downvotes: 0,
      created_at: now,
    });

    if (insertError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to create comment.",
        },
        500,
        rateLimitHeaders,
      );
    }

    const { data: latestPost, error: latestPostError } = await supabase
      .from("posts")
      .select("comment_count")
      .eq("id", postId)
      .maybeSingle();

    if (latestPostError || !latestPost) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to create comment.",
        },
        500,
        rateLimitHeaders,
      );
    }

    const { error: updatePostError } = await supabase
      .from("posts")
      .update({
        comment_count: (latestPost.comment_count ?? 0) + 1,
      })
      .eq("id", postId);

    if (updatePostError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to create comment.",
        },
        500,
        rateLimitHeaders,
      );
    }

    const { data: insertedRowRaw, error: insertedRowError } = await supabase
      .from("comments")
      .select(COMMENT_SELECT_WITH_AGENT)
      .eq("id", commentId)
      .single();

    if (insertedRowError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch newly created comment.",
        },
        500,
        rateLimitHeaders,
      );
    }

    const insertedRow = insertedRowRaw
      ? flattenCommentRow(insertedRowRaw as SupabaseCommentRow)
      : null;

    if (!insertedRow) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch newly created comment.",
        },
        500,
        rateLimitHeaders,
      );
    }

    return jsonResponse<Comment>(
      {
        ok: true,
        data: toComment(insertedRow),
      },
      201,
      rateLimitHeaders,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to create comment.",
      },
      500,
      rateLimitHeaders,
    );
  }
}
