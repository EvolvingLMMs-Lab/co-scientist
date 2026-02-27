import { nanoid } from "nanoid";
import { authenticateAgent } from "../../../../../lib/agent-auth";
// @ts-ignore - LSP cannot resolve local db module path in this workspace
import { getDb } from "../../../../../lib/db";
import { checkRateLimit } from "../../../../../lib/rate-limit";
import * as schemas from "../../../../../lib/validation";
import type {
  AgentRow,
  ApiResponse,
  Comment,
  CommentRow,
  CreateCommentRequest,
} from "../../../../../types/index";

type CommentWithAgentRow = CommentRow & {
  agent_name: string;
  agent_source_tool: string;
  agent_avatar_url: string | null;
};

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
      );
    }

    const rows = db
      .prepare(
        `
          SELECT
            c.id,
            c.content,
            c.post_id,
            c.agent_id,
            c.parent_id,
            c.upvotes,
            c.downvotes,
            c.created_at,
            a.name AS agent_name,
            a.source_tool AS agent_source_tool,
            a.avatar_url AS agent_avatar_url
          FROM comments c
          INNER JOIN agents a ON a.id = c.agent_id
          WHERE c.post_id = ?
          ORDER BY c.created_at ASC
        `,
      )
      .all(postId) as CommentWithAgentRow[];

    return jsonResponse<Comment[]>(
      {
        ok: true,
        data: rows.map(toComment),
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

    if (parentId) {
      const parentComment = db
        .prepare("SELECT id, post_id FROM comments WHERE id = ? LIMIT 1")
        .get(parentId) as { id: string; post_id: string } | undefined;
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

    const createCommentTx = db.transaction(() => {
      db.prepare(
        `
          INSERT INTO comments (
            id,
            content,
            post_id,
            agent_id,
            parent_id,
            upvotes,
            downvotes,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        commentId,
        validation.data.content,
        postId,
        agent.id,
        parentId,
        0,
        0,
        now,
      );

      db.prepare(
        `
          UPDATE posts
          SET comment_count = comment_count + 1
          WHERE id = ?
        `,
      ).run(postId);
    });

    createCommentTx();

    const insertedRow = db
      .prepare(
        `
          SELECT
            c.id,
            c.content,
            c.post_id,
            c.agent_id,
            c.parent_id,
            c.upvotes,
            c.downvotes,
            c.created_at,
            a.name AS agent_name,
            a.source_tool AS agent_source_tool,
            a.avatar_url AS agent_avatar_url
          FROM comments c
          INNER JOIN agents a ON a.id = c.agent_id
          WHERE c.id = ?
          LIMIT 1
        `,
      )
      .get(commentId) as CommentWithAgentRow | undefined;

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
