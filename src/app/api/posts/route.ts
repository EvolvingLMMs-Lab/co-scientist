import { nanoid } from "nanoid";
import { authenticateAgent } from "../../../lib/agent-auth";
// @ts-ignore - LSP cannot resolve local db module path in this workspace
import { getDb } from "../../../lib/db";
import { checkRateLimit } from "../../../lib/rate-limit";
import * as schemas from "../../../lib/validation";
import type {
  AgentRow,
  ApiResponse,
  CreatePostRequest,
  PaginatedResponse,
  PanelRow,
  Post,
  PostRow,
  SortOption,
} from "../../../types/index";

type PostFeedRow = PostRow & {
  panel_slug: string;
  panel_name: string;
  panel_icon: string | null;
  panel_color: string | null;
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

const PANEL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function jsonResponse(
  body: ApiResponse<unknown> | PaginatedResponse<unknown>,
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

function toPost(row: PostFeedRow): Post {
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

function getRateLimitHeaders(state: RateLimitState): HeadersInit {
  return {
    "X-RateLimit-Remaining": String(state.remaining),
    "X-RateLimit-Reset": String(state.resetAt),
  };
}

function getSortOption(value: string | null): SortOption | null {
  if (value === null || value.length === 0) {
    return "hot";
  }

  if (value === "hot" || value === "new" || value === "top") {
    return value;
  }

  return null;
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function computeHotScore(row: PostRow, nowEpochSeconds: number): number {
  const score = row.upvotes - row.downvotes;
  const hoursSincePost = Math.max(0, (nowEpochSeconds - row.created_at) / 3600);
  return score / Math.pow(hoursSincePost + 2, 1.5);
}

function getCreatePostSchema(): SchemaLike<CreatePostRequest> | null {
  const schemaMap = schemas as unknown as Record<
    string,
    SchemaLike<CreatePostRequest> | undefined
  >;
  return (
    schemaMap.createPost ??
    schemaMap.createPostRequest ??
    schemaMap.createPostSchema ??
    null
  );
}

function validateCreatePostRequest(
  input: unknown,
): { ok: true; data: CreatePostRequest } | { ok: false; error: string } {
  const schema = getCreatePostSchema();
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

  const body = input as CreatePostRequest;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const panel = typeof body.panel === "string" ? body.panel.trim().toLowerCase() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : body.summary;

  if (title.length < 3 || title.length > 300) {
    return { ok: false, error: "title must be between 3 and 300 characters." };
  }

  if (content.length < 10 || content.length > 50_000) {
    return { ok: false, error: "content must be between 10 and 50000 characters." };
  }

  if (!PANEL_SLUG_PATTERN.test(panel)) {
    return {
      ok: false,
      error: "panel must be a valid panel slug.",
    };
  }

  if (summary !== undefined && typeof summary !== "string") {
    return { ok: false, error: "summary must be a string when provided." };
  }

  if (typeof summary === "string" && summary.length > 10_000) {
    return { ok: false, error: "summary must be at most 10000 characters." };
  }

  return {
    ok: true,
    data: {
      title,
      content,
      panel,
      summary,
    },
  };
}

function getPagination(page: number, perPage: number, total: number) {
  return {
    page,
    perPage,
    total,
    totalPages: Math.ceil(total / perPage),
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const panelSlug = url.searchParams.get("panel")?.trim().toLowerCase();
  const sort = getSortOption(url.searchParams.get("sort"));
  const page = parsePositiveInt(url.searchParams.get("page"), 1);
  const rawPerPage = parsePositiveInt(url.searchParams.get("perPage"), 20);
  const perPage = Math.min(Math.max(rawPerPage, 1), 50);

  if (!sort) {
    return jsonResponse(
      {
        ok: false,
        error: "sort must be one of: hot, new, top.",
      },
      400,
    );
  }

  if (panelSlug && !PANEL_SLUG_PATTERN.test(panelSlug)) {
    return jsonResponse(
      {
        ok: false,
        error: "panel must be a valid panel slug.",
      },
      400,
    );
  }

  try {
    const db = getDb();
    const filters: string[] = [];
    const filterParams: Array<string | number> = [];

    if (panelSlug) {
      filters.push("pn.slug = ?");
      filterParams.push(panelSlug);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const selectColumns = `
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
      ${whereClause}
    `;

    let total = 0;
    let rows: PostFeedRow[] = [];

    if (sort === "hot") {
      const allRows = db.prepare(selectColumns).all(...filterParams) as PostFeedRow[];
      total = allRows.length;

      const now = Math.floor(Date.now() / 1000);
      const rankedRows = allRows
        .map((row) => ({
          row,
          hotScore: computeHotScore(row, now),
        }))
        .sort((left, right) => {
          if (right.hotScore !== left.hotScore) {
            return right.hotScore - left.hotScore;
          }
          return right.row.created_at - left.row.created_at;
        })
        .map((entry) => entry.row);

      const offset = (page - 1) * perPage;
      rows = rankedRows.slice(offset, offset + perPage);
    } else {
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM posts p
        INNER JOIN panels pn ON pn.id = p.panel_id
        ${whereClause}
      `;
      const countResult = db.prepare(countQuery).get(...filterParams) as { total: number };
      total = countResult?.total ?? 0;

      const orderClause =
        sort === "new"
          ? "ORDER BY p.created_at DESC"
          : "ORDER BY (p.upvotes - p.downvotes) DESC, p.created_at DESC";
      const offset = (page - 1) * perPage;
      const pagedQuery = `${selectColumns} ${orderClause} LIMIT ? OFFSET ?`;
      rows = db.prepare(pagedQuery).all(...filterParams, perPage, offset) as PostFeedRow[];
    }

    const response: PaginatedResponse<Post> = {
      ok: true,
      data: rows.map(toPost),
      pagination: getPagination(page, perPage, total),
    };

    return jsonResponse(response, 200);
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to fetch posts.",
      },
      500,
    );
  }
}

export async function POST(request: Request): Promise<Response> {
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

  const rateLimit = checkRateLimit(agent.id, "post") as RateLimitState;
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

  const validation = validateCreatePostRequest(body);
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
  const postId = nanoid();

  try {
    const db = getDb();
    const panel = db
      .prepare(
        `
          SELECT
            id,
            name,
            slug,
            description,
            icon,
            color,
            created_by,
            created_at,
            post_count,
            is_default
          FROM panels
          WHERE slug = ?
          LIMIT 1
        `,
      )
      .get(validation.data.panel) as PanelRow | undefined;

    if (!panel) {
      return jsonResponse(
        {
          ok: false,
          error: "Panel not found.",
        },
        404,
        rateLimitHeaders,
      );
    }

    const createPostTx = db.transaction(() => {
      db.prepare(
        `
          INSERT INTO posts (
            id,
            title,
            content,
            summary,
            panel_id,
            agent_id,
            upvotes,
            downvotes,
            comment_count,
            created_at,
            updated_at,
            is_pinned
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        postId,
        validation.data.title.trim(),
        validation.data.content,
        validation.data.summary?.trim() ?? null,
        panel.id,
        agent.id,
        0,
        0,
        0,
        now,
        null,
        0,
      );

      db.prepare(
        `
          UPDATE agents
          SET
            post_count = post_count + 1,
            last_post_at = ?
          WHERE id = ?
        `,
      ).run(now, agent.id);

      db.prepare(
        `
          UPDATE panels
          SET post_count = post_count + 1
          WHERE id = ?
        `,
      ).run(panel.id);
    });

    createPostTx();

    const postRow = db
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
      .get(postId) as PostFeedRow | undefined;

    if (!postRow) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch newly created post.",
        },
        500,
        rateLimitHeaders,
      );
    }

    return jsonResponse(
      {
        ok: true,
        data: toPost(postRow),
      },
      201,
      rateLimitHeaders,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to create post.",
      },
      500,
      rateLimitHeaders,
    );
  }
}
