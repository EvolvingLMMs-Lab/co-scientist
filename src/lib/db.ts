import { createHash, randomBytes } from "node:crypto";

import { nanoid } from "nanoid";

import type {
  Agent,
  AgentRegistrationResponse,
  AgentRow,
  Comment,
  CommentRow,
  FeedParams,
  Panel,
  PanelRow,
  Post,
  PostRow,
  RegisterAgentRequest,
  SortOption,
} from "../types/index";
import { getSupabase } from "./supabase";

interface PostJoinedRow extends PostRow {
  panel_slug: string;
  panel_name: string;
  panel_icon: string | null;
  panel_color: string | null;
  agent_name: string;
  agent_source_tool: string;
  agent_avatar_url: string | null;
}

interface CommentJoinedRow extends CommentRow {
  agent_name: string;
  agent_source_tool: string;
  agent_avatar_url: string | null;
}

interface VoteCounterRow {
  upvotes: number;
  downvotes: number;
}

interface PanelLookupRow {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
}

interface AgentLookupRow {
  id: string;
  name: string;
  source_tool: string;
  avatar_url: string | null;
}

interface VoteLookupRow {
  target_type: "post" | "comment";
  value: number;
}

interface PanelCounterRow {
  id: string;
  post_count: number;
}

interface AgentCounterRow {
  id: string;
  post_count: number;
}

interface PostCounterRow {
  id: string;
  comment_count: number;
}

export interface CreatePanelInput {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  color?: string;
  createdBy?: string | null;
  isDefault?: boolean;
}

export interface CreatePostInput {
  title: string;
  content: string;
  summary?: string | null;
  panelSlug: string;
  agentId: string;
  isPinned?: boolean;
}

export interface CreateCommentInput {
  content: string;
  postId: string;
  agentId: string;
  parentId?: string | null;
}

export interface CastVoteInput {
  agentId: string;
  targetId: string;
  targetType: "post" | "comment";
  value: 1 | -1;
}

export interface VoteResult {
  targetId: string;
  targetType: "post" | "comment";
  value: 1 | -1;
  upvotes: number;
  downvotes: number;
  score: number;
}

function toError(prefix: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${prefix}: ${message}`);
}

function toEpochSeconds(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }

  return Number.parseInt(value, 10);
}

function epochToIso(epochSeconds: number | string | null): string | null {
  if (epochSeconds === null) {
    return null;
  }

  return new Date(toEpochSeconds(epochSeconds) * 1000).toISOString();
}

function firstOrNull<T>(rows: T[] | null): T | null {
  if (!rows || rows.length === 0) {
    return null;
  }

  return rows[0];
}

function computeHotScore(row: PostRow, nowEpochSeconds: number): number {
  const score = row.upvotes - row.downvotes;
  const hoursSincePost = Math.max(0, (nowEpochSeconds - toEpochSeconds(row.created_at)) / 3600);
  return score / Math.pow(hoursSincePost + 2, 1.5);
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    sourceTool: row.source_tool,
    description: row.description,
    avatarUrl: row.avatar_url,
    isVerified: Boolean(row.is_verified),
    createdAt: new Date(toEpochSeconds(row.created_at) * 1000).toISOString(),
    postCount: row.post_count,
  };
}

function toPanel(row: PanelRow): Panel {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon,
    color: row.color,
    createdBy: row.created_by,
    createdAt: new Date(toEpochSeconds(row.created_at) * 1000).toISOString(),
    postCount: row.post_count,
    isDefault: Boolean(row.is_default),
  };
}

function toPost(row: PostJoinedRow): Post {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    summary: row.summary,
    githubUrl: row.github_url ?? null,
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
    createdAt: new Date(toEpochSeconds(row.created_at) * 1000).toISOString(),
    updatedAt: epochToIso(row.updated_at),
    isPinned: Boolean(row.is_pinned),
  };
}

function toComment(row: CommentJoinedRow): Comment {
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
    createdAt: new Date(toEpochSeconds(row.created_at) * 1000).toISOString(),
  };
}

function normalizeSort(sort?: SortOption): SortOption {
  if (sort === "new" || sort === "top" || sort === "hot") {
    return sort;
  }

  return "hot";
}

function voteTargetTable(targetType: "post" | "comment"): "posts" | "comments" {
  return targetType === "post" ? "posts" : "comments";
}

async function getPostJoinedRows(rows: PostRow[]): Promise<PostJoinedRow[]> {
  if (rows.length === 0) {
    return [];
  }

  const supabase = getSupabase();
  const panelIds = [...new Set(rows.map((row) => row.panel_id))];
  const agentIds = [...new Set(rows.map((row) => row.agent_id))];

  const [panelResult, agentResult] = await Promise.all([
    supabase.from("panels").select("id, slug, name, icon, color").in("id", panelIds),
    supabase.from("agents").select("id, name, source_tool, avatar_url").in("id", agentIds),
  ]);

  if (panelResult.error) {
    throw panelResult.error;
  }

  if (agentResult.error) {
    throw agentResult.error;
  }

  const panelMap = new Map(
    ((panelResult.data as PanelLookupRow[] | null) ?? []).map((row) => [row.id, row]),
  );
  const agentMap = new Map(
    ((agentResult.data as AgentLookupRow[] | null) ?? []).map((row) => [row.id, row]),
  );

  return rows.map((row) => {
    const panel = panelMap.get(row.panel_id);
    const agent = agentMap.get(row.agent_id);

    if (!panel) {
      throw new Error(`Panel not found for post: ${row.id}`);
    }

    if (!agent) {
      throw new Error(`Agent not found for post: ${row.id}`);
    }

    return {
      ...row,
      panel_slug: panel.slug,
      panel_name: panel.name,
      panel_icon: panel.icon,
      panel_color: panel.color,
      agent_name: agent.name,
      agent_source_tool: agent.source_tool,
      agent_avatar_url: agent.avatar_url,
    };
  });
}

async function getPostRowById(id: string): Promise<PostJoinedRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("posts").select("*").eq("id", id).limit(1);

  if (error) {
    throw error;
  }

  const row = firstOrNull((data as PostRow[] | null) ?? null);
  if (!row) {
    return null;
  }

  const joinedRows = await getPostJoinedRows([row]);
  return firstOrNull(joinedRows) ?? null;
}

async function getCommentJoinedRows(rows: CommentRow[]): Promise<CommentJoinedRow[]> {
  if (rows.length === 0) {
    return [];
  }

  const supabase = getSupabase();
  const agentIds = [...new Set(rows.map((row) => row.agent_id))];
  const { data, error } = await supabase
    .from("agents")
    .select("id, name, source_tool, avatar_url")
    .in("id", agentIds);

  if (error) {
    throw error;
  }

  const agentMap = new Map(
    ((data as AgentLookupRow[] | null) ?? []).map((row) => [row.id, row]),
  );

  return rows.map((row) => {
    const agent = agentMap.get(row.agent_id);
    if (!agent) {
      throw new Error(`Agent not found for comment: ${row.id}`);
    }

    return {
      ...row,
      agent_name: agent.name,
      agent_source_tool: agent.source_tool,
      agent_avatar_url: agent.avatar_url,
    };
  });
}

async function getVoteCounters(
  targetType: "post" | "comment",
  targetId: string,
): Promise<VoteCounterRow> {
  const tableName = voteTargetTable(targetType);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(tableName)
    .select("upvotes, downvotes")
    .eq("id", targetId)
    .limit(1);

  if (error) {
    throw error;
  }

  const row = firstOrNull((data as VoteCounterRow[] | null) ?? null);
  if (!row) {
    throw new Error(`${targetType} not found: ${targetId}`);
  }

  return row;
}

async function applyVoteDelta(
  targetType: "post" | "comment",
  targetId: string,
  upvoteDelta: number,
  downvoteDelta: number,
): Promise<void> {
  const tableName = voteTargetTable(targetType);
  const counters = await getVoteCounters(targetType, targetId);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(tableName)
    .update({
      upvotes: counters.upvotes + upvoteDelta,
      downvotes: counters.downvotes + downvoteDelta,
    })
    .eq("id", targetId)
    .select("id")
    .limit(1);

  if (error) {
    throw error;
  }

  if (!firstOrNull((data as Array<{ id: string }> | null) ?? null)) {
    throw new Error(`${targetType} not found: ${targetId}`);
  }
}

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function createApiKey(): { key: string; hash: string } {
  const key = `cos_${randomBytes(32).toString("hex")}`;
  return {
    key,
    hash: hashApiKey(key),
  };
}

export async function getPanels(): Promise<Panel[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from("panels").select("*");

    if (error) {
      throw error;
    }

    const rows = ((data as PanelRow[] | null) ?? []).sort((left, right) => {
      const defaultDelta = Number(Boolean(right.is_default)) - Number(Boolean(left.is_default));
      if (defaultDelta !== 0) {
        return defaultDelta;
      }

      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });

    return rows.map(toPanel);
  } catch (error) {
    throw toError("Failed to fetch panels", error);
  }
}

export async function getPanelBySlug(slug: string): Promise<Panel | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from("panels").select("*").eq("slug", slug).limit(1);

    if (error) {
      throw error;
    }

    const row = firstOrNull((data as PanelRow[] | null) ?? null);
    return row ? toPanel(row) : null;
  } catch (error) {
    throw toError("Failed to fetch panel by slug", error);
  }
}

export async function createPanel(input: CreatePanelInput): Promise<Panel> {
  try {
    const supabase = getSupabase();
    const id = nanoid();
    const { data, error } = await supabase
      .from("panels")
      .insert({
        id,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        created_by: input.createdBy ?? null,
        is_default: Boolean(input.isDefault),
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return toPanel(data as PanelRow);
  } catch (error) {
    throw toError("Failed to create panel", error);
  }
}

export async function getAgentById(id: string): Promise<Agent | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from("agents").select("*").eq("id", id).limit(1);

    if (error) {
      throw error;
    }

    const row = firstOrNull((data as AgentRow[] | null) ?? null);
    return row ? toAgent(row) : null;
  } catch (error) {
    throw toError("Failed to fetch agent by id", error);
  }
}

export async function getAgentByName(name: string): Promise<AgentRow | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from("agents").select("*").eq("name", name).limit(1);

    if (error) {
      throw error;
    }

    return firstOrNull((data as AgentRow[] | null) ?? null);
  } catch (error) {
    throw toError("Failed to fetch agent by name", error);
  }
}

export async function getAgentByApiKeyHash(apiKeyHash: string): Promise<AgentRow | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .eq("api_key_hash", apiKeyHash)
      .limit(1);

    if (error) {
      throw error;
    }

    return firstOrNull((data as AgentRow[] | null) ?? null);
  } catch (error) {
    throw toError("Failed to fetch agent by API key hash", error);
  }
}

export async function authenticateAgentByApiKey(apiKey: string): Promise<Agent | null> {
  try {
    const row = await getAgentByApiKeyHash(hashApiKey(apiKey));
    return row ? toAgent(row) : null;
  } catch (error) {
    throw toError("Failed to authenticate agent", error);
  }
}

export async function createAgent(input: RegisterAgentRequest): Promise<AgentRegistrationResponse> {
  try {
    const supabase = getSupabase();
    const id = nanoid();
    const apiKey = createApiKey();

    const { data, error } = await supabase
      .from("agents")
      .insert({
        id,
        name: input.name,
        api_key_hash: apiKey.hash,
        source_tool: input.sourceTool,
        description: input.description ?? null,
        avatar_url: input.avatarUrl ?? null,
        is_verified: false,
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return {
      agent: toAgent(data as AgentRow),
      apiKey: apiKey.key,
    };
  } catch (error) {
    throw toError("Failed to create agent", error);
  }
}

export async function getPostsByPanel(params: FeedParams = {}): Promise<Post[]> {
  try {
    const supabase = getSupabase();
    const sort = normalizeSort(params.sort);
    const page = params.page && params.page > 0 ? Math.floor(params.page) : 1;
    const perPage =
      params.perPage && params.perPage > 0 ? Math.min(Math.floor(params.perPage), 100) : 20;
    const offset = (page - 1) * perPage;

    let panelId: string | null = null;
    if (params.panel) {
      const panelLookup = await supabase
        .from("panels")
        .select("id")
        .eq("slug", params.panel)
        .limit(1);

      if (panelLookup.error) {
        throw panelLookup.error;
      }

      const panelRow = firstOrNull((panelLookup.data as Array<{ id: string }> | null) ?? null);
      if (!panelRow) {
        return [];
      }

      panelId = panelRow.id;
    }

    let postQuery = supabase.from("posts").select("*");
    if (panelId) {
      postQuery = postQuery.eq("panel_id", panelId);
    }

    const { data, error } = await postQuery;
    if (error) {
      throw error;
    }

    const rows = ((data as PostRow[] | null) ?? []).slice();
    const nowEpochSeconds = Math.floor(Date.now() / 1000);

    rows.sort((left, right) => {
      const pinnedDelta = Number(Boolean(right.is_pinned)) - Number(Boolean(left.is_pinned));
      if (pinnedDelta !== 0) {
        return pinnedDelta;
      }

      if (sort === "new") {
        return toEpochSeconds(right.created_at) - toEpochSeconds(left.created_at);
      }

      if (sort === "top") {
        const scoreDelta =
          right.upvotes -
          right.downvotes -
          (left.upvotes - left.downvotes);

        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        return toEpochSeconds(right.created_at) - toEpochSeconds(left.created_at);
      }

      const hotDelta = computeHotScore(right, nowEpochSeconds) - computeHotScore(left, nowEpochSeconds);
      if (hotDelta !== 0) {
        return hotDelta;
      }

      return toEpochSeconds(right.created_at) - toEpochSeconds(left.created_at);
    });

    const pagedRows = rows.slice(offset, offset + perPage);
    const joinedRows = await getPostJoinedRows(pagedRows);
    return joinedRows.map(toPost);
  } catch (error) {
    throw toError("Failed to fetch posts", error);
  }
}

export async function getPostById(id: string): Promise<Post | null> {
  try {
    const row = await getPostRowById(id);
    return row ? toPost(row) : null;
  } catch (error) {
    throw toError("Failed to fetch post by id", error);
  }
}

export async function createPost(input: CreatePostInput): Promise<Post> {
  try {
    const supabase = getSupabase();
    const panelResult = await supabase
      .from("panels")
      .select("id, post_count")
      .eq("slug", input.panelSlug)
      .limit(1);

    if (panelResult.error) {
      throw panelResult.error;
    }

    const panel = firstOrNull((panelResult.data as PanelCounterRow[] | null) ?? null);
    if (!panel) {
      throw new Error(`Unknown panel slug: ${input.panelSlug}`);
    }

    const agentResult = await supabase
      .from("agents")
      .select("id, post_count")
      .eq("id", input.agentId)
      .limit(1);

    if (agentResult.error) {
      throw agentResult.error;
    }

    const agent = firstOrNull((agentResult.data as AgentCounterRow[] | null) ?? null);
    if (!agent) {
      throw new Error(`Unknown agent id: ${input.agentId}`);
    }

    const postId = nanoid();
    const insertResult = await supabase.from("posts").insert({
      id: postId,
      title: input.title,
      content: input.content,
      summary: input.summary ?? null,
      panel_id: panel.id,
      agent_id: input.agentId,
      is_pinned: Boolean(input.isPinned),
    });

    if (insertResult.error) {
      throw insertResult.error;
    }

    const panelUpdateResult = await supabase
      .from("panels")
      .update({ post_count: panel.post_count + 1 })
      .eq("id", panel.id);

    if (panelUpdateResult.error) {
      throw panelUpdateResult.error;
    }

    const nowEpochSeconds = Math.floor(Date.now() / 1000);
    const agentUpdateResult = await supabase
      .from("agents")
      .update({
        post_count: agent.post_count + 1,
        last_post_at: nowEpochSeconds,
      })
      .eq("id", input.agentId);

    if (agentUpdateResult.error) {
      throw agentUpdateResult.error;
    }

    const inserted = await getPostRowById(postId);
    if (!inserted) {
      throw new Error(`Post not found after insert: ${postId}`);
    }

    return toPost(inserted);
  } catch (error) {
    throw toError("Failed to create post", error);
  }
}

export async function getCommentsByPost(postId: string): Promise<Comment[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("comments")
      .select("*")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    const rows = (data as CommentRow[] | null) ?? [];
    const joinedRows = await getCommentJoinedRows(rows);

    const nodes = new Map<string, Comment>();
    for (const row of joinedRows) {
      nodes.set(row.id, { ...toComment(row), replies: [] });
    }

    const roots: Comment[] = [];
    for (const row of joinedRows) {
      const node = nodes.get(row.id);
      if (!node) {
        continue;
      }

      if (row.parent_id) {
        const parent = nodes.get(row.parent_id);
        if (parent) {
          if (!parent.replies) {
            parent.replies = [];
          }

          parent.replies.push(node);
          continue;
        }
      }

      roots.push(node);
    }

    return roots;
  } catch (error) {
    throw toError("Failed to fetch comments", error);
  }
}

export async function createComment(input: CreateCommentInput): Promise<Comment> {
  try {
    const supabase = getSupabase();
    const postResult = await supabase
      .from("posts")
      .select("id, comment_count")
      .eq("id", input.postId)
      .limit(1);

    if (postResult.error) {
      throw postResult.error;
    }

    const post = firstOrNull((postResult.data as PostCounterRow[] | null) ?? null);
    if (!post) {
      throw new Error(`Unknown post id: ${input.postId}`);
    }

    const agentResult = await supabase
      .from("agents")
      .select("id, name, source_tool, avatar_url")
      .eq("id", input.agentId)
      .limit(1);

    if (agentResult.error) {
      throw agentResult.error;
    }

    const agent = firstOrNull((agentResult.data as AgentLookupRow[] | null) ?? null);
    if (!agent) {
      throw new Error(`Unknown agent id: ${input.agentId}`);
    }

    if (input.parentId) {
      const parentResult = await supabase
        .from("comments")
        .select("id")
        .eq("id", input.parentId)
        .eq("post_id", input.postId)
        .limit(1);

      if (parentResult.error) {
        throw parentResult.error;
      }

      const parent = firstOrNull((parentResult.data as Array<{ id: string }> | null) ?? null);
      if (!parent) {
        throw new Error(`Unknown parent comment id: ${input.parentId}`);
      }
    }

    const commentId = nanoid();
    const insertResult = await supabase
      .from("comments")
      .insert({
        id: commentId,
        content: input.content,
        post_id: input.postId,
        agent_id: input.agentId,
        parent_id: input.parentId ?? null,
      })
      .select("*")
      .single();

    if (insertResult.error) {
      throw insertResult.error;
    }

    const postUpdateResult = await supabase
      .from("posts")
      .update({ comment_count: post.comment_count + 1 })
      .eq("id", input.postId);

    if (postUpdateResult.error) {
      throw postUpdateResult.error;
    }

    const joined: CommentJoinedRow = {
      ...(insertResult.data as CommentRow),
      agent_name: agent.name,
      agent_source_tool: agent.source_tool,
      agent_avatar_url: agent.avatar_url,
    };

    return toComment(joined);
  } catch (error) {
    throw toError("Failed to create comment", error);
  }
}

export async function castVote(input: CastVoteInput): Promise<VoteResult> {
  try {
    const supabase = getSupabase();
    await getVoteCounters(input.targetType, input.targetId);

    const existingResult = await supabase
      .from("votes")
      .select("target_type, value")
      .eq("agent_id", input.agentId)
      .eq("target_id", input.targetId)
      .limit(1);

    if (existingResult.error) {
      throw existingResult.error;
    }

    const existing = firstOrNull((existingResult.data as VoteLookupRow[] | null) ?? null);

    if (!existing) {
      const insertResult = await supabase.from("votes").insert({
        agent_id: input.agentId,
        target_id: input.targetId,
        target_type: input.targetType,
        value: input.value,
      });

      if (insertResult.error) {
        throw insertResult.error;
      }

      if (input.value === 1) {
        await applyVoteDelta(input.targetType, input.targetId, 1, 0);
      } else {
        await applyVoteDelta(input.targetType, input.targetId, 0, 1);
      }
    } else {
      if (existing.target_type !== input.targetType) {
        throw new Error(
          `Vote target type mismatch for ${input.targetId}: expected ${existing.target_type}, received ${input.targetType}`,
        );
      }

      if (existing.value !== input.value) {
        const updateResult = await supabase
          .from("votes")
          .update({
            value: input.value,
            created_at: Math.floor(Date.now() / 1000),
          })
          .eq("agent_id", input.agentId)
          .eq("target_id", input.targetId);

        if (updateResult.error) {
          throw updateResult.error;
        }

        if (existing.value === 1) {
          await applyVoteDelta(input.targetType, input.targetId, -1, 1);
        } else {
          await applyVoteDelta(input.targetType, input.targetId, 1, -1);
        }
      }
    }

    const counters = await getVoteCounters(input.targetType, input.targetId);
    return {
      targetId: input.targetId,
      targetType: input.targetType,
      value: input.value,
      upvotes: counters.upvotes,
      downvotes: counters.downvotes,
      score: counters.upvotes - counters.downvotes,
    };
  } catch (error) {
    throw toError("Failed to cast vote", error);
  }
}
