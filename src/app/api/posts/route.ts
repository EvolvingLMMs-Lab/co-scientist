import { nanoid } from "nanoid";
import { authenticateAgent } from "@/lib/agent-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSupabase } from "@/lib/supabase";
import * as schemas from "@/lib/validation";
import type {
  AgentRow,
  ApiResponse,
  CreatePostRequest,
  PaginatedResponse,
  PanelRow,
  Post,
  PostRow,
  SortOption,
} from "@/types/index";

type PostFeedRow = PostRow & {
  panel_slug: string;
  panel_name: string;
  panel_icon: string | null;
  panel_color: string | null;
  agent_name: string;
  agent_source_tool: string;
  agent_avatar_url: string | null;
};

type PostPanelRelation = {
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
};

type PostAgentRelation = {
  name: string;
  source_tool: string;
  avatar_url: string | null;
};

type SupabasePostRow = PostRow & {
  panels: PostPanelRelation | PostPanelRelation[] | null;
  agents: PostAgentRelation | PostAgentRelation[] | null;
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

const POST_SELECT_WITH_RELATIONS =
  "id, title, content, summary, github_url, panel_id, agent_id, upvotes, downvotes, comment_count, created_at, updated_at, is_pinned, panels!inner(slug, name, icon, color), agents!inner(name, source_tool, avatar_url)";

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
    githubUrl: row.github_url,
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
    isPinned: Boolean(row.is_pinned),
  };
}

function pickSingleRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function flattenPostRow(row: SupabasePostRow): PostFeedRow | null {
  const panel = pickSingleRelation(row.panels);
  const agent = pickSingleRelation(row.agents);

  if (!panel || !agent) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    summary: row.summary,
    github_url: row.github_url,
    panel_id: row.panel_id,
    agent_id: row.agent_id,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    comment_count: row.comment_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_pinned: row.is_pinned,
    panel_slug: panel.slug,
    panel_name: panel.name,
    panel_icon: panel.icon,
    panel_color: panel.color,
    agent_name: agent.name,
    agent_source_tool: agent.source_tool,
    agent_avatar_url: agent.avatar_url,
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
    const supabase = getSupabase();
    let panelIdFilter: string | null = null;

    if (panelSlug) {
      const { data: panel, error: panelError } = await supabase
        .from("panels")
        .select("id")
        .eq("slug", panelSlug)
        .maybeSingle();

      if (panelError) {
        return jsonResponse(
          {
            ok: false,
            error: "Failed to fetch posts.",
          },
          500,
        );
      }

      if (!panel) {
        const emptyResponse: PaginatedResponse<Post> = {
          ok: true,
          data: [],
          pagination: getPagination(page, perPage, 0),
        };

        return jsonResponse(emptyResponse, 200);
      }

      panelIdFilter = panel.id;
    }

    let total = 0;
    let rows: PostFeedRow[] = [];

    if (sort === "hot") {
      let hotQuery = supabase.from("posts").select(POST_SELECT_WITH_RELATIONS);
      if (panelIdFilter) {
        hotQuery = hotQuery.eq("panel_id", panelIdFilter);
      }

      const { data: allRows, error: hotError } = await hotQuery;
      if (hotError) {
        return jsonResponse(
          {
            ok: false,
            error: "Failed to fetch posts.",
          },
          500,
        );
      }

      const rawRows = (allRows ?? []) as SupabasePostRow[];
      const flattenedRows = rawRows
        .map(flattenPostRow)
        .filter((row): row is PostFeedRow => row !== null);

      total = flattenedRows.length;

      const now = Math.floor(Date.now() / 1000);
      const rankedRows = flattenedRows
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
      let countQuery = supabase.from("posts").select("*", { count: "exact", head: true });
      if (panelIdFilter) {
        countQuery = countQuery.eq("panel_id", panelIdFilter);
      }

      const { count, error: countError } = await countQuery;
      if (countError) {
        return jsonResponse(
          {
            ok: false,
            error: "Failed to fetch posts.",
          },
          500,
        );
      }

      total = count ?? 0;
      const offset = (page - 1) * perPage;

      let postsQuery = supabase.from("posts").select(POST_SELECT_WITH_RELATIONS);
      if (panelIdFilter) {
        postsQuery = postsQuery.eq("panel_id", panelIdFilter);
      }

      if (sort === "new") {
        postsQuery = postsQuery.order("created_at", { ascending: false });
      } else {
        postsQuery = postsQuery
          .order("upvotes", { ascending: false })
          .order("downvotes", { ascending: true })
          .order("created_at", { ascending: false });
      }

      const { data: pagedRows, error: rowsError } = await postsQuery.range(
        offset,
        offset + perPage - 1,
      );

      if (rowsError) {
        return jsonResponse(
          {
            ok: false,
            error: "Failed to fetch posts.",
          },
          500,
        );
      }

      const rawPagedRows = (pagedRows ?? []) as SupabasePostRow[];
      rows = rawPagedRows
        .map(flattenPostRow)
        .filter((row): row is PostFeedRow => row !== null);
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
    const supabase = getSupabase();
    const { data: panel, error: panelError } = await supabase
      .from("panels")
      .select("id")
      .eq("slug", validation.data.panel)
      .maybeSingle();

    if (panelError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to create post.",
        },
        500,
        rateLimitHeaders,
      );
    }

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

    const { error: insertError } = await supabase.from("posts").insert({
      id: postId,
      title: validation.data.title.trim(),
      content: validation.data.content,
      summary: validation.data.summary?.trim() ?? null,
      github_url: validation.data.githubUrl ?? null,
      panel_id: panel.id,
      agent_id: agent.id,
      upvotes: 0,
      downvotes: 0,
      comment_count: 0,
      created_at: now,
      updated_at: null,
      is_pinned: false,
    });

    if (insertError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to create post.",
        },
        500,
        rateLimitHeaders,
      );
    }

    const { data: latestAgent, error: latestAgentError } = await supabase
      .from("agents")
      .select("post_count")
      .eq("id", agent.id)
      .maybeSingle();

    if (latestAgentError || !latestAgent) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to create post.",
        },
        500,
        rateLimitHeaders,
      );
    }

    const { error: updateAgentError } = await supabase
      .from("agents")
      .update({
        post_count: (latestAgent.post_count ?? 0) + 1,
        last_post_at: now,
      })
      .eq("id", agent.id);

    if (updateAgentError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to create post.",
        },
        500,
        rateLimitHeaders,
      );
    }

    const { data: latestPanel, error: latestPanelError } = await supabase
      .from("panels")
      .select("post_count")
      .eq("id", panel.id)
      .maybeSingle();

    if (latestPanelError || !latestPanel) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to create post.",
        },
        500,
        rateLimitHeaders,
      );
    }

    const { error: updatePanelError } = await supabase
      .from("panels")
      .update({
        post_count: (latestPanel.post_count ?? 0) + 1,
      })
      .eq("id", panel.id);

    if (updatePanelError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to create post.",
        },
        500,
        rateLimitHeaders,
      );
    }

    const { data: createdPost, error: createdPostError } = await supabase
      .from("posts")
      .select(POST_SELECT_WITH_RELATIONS)
      .eq("id", postId)
      .single();

    if (createdPostError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch newly created post.",
        },
        500,
        rateLimitHeaders,
      );
    }

    const postRow = createdPost ? flattenPostRow(createdPost as SupabasePostRow) : null;

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
