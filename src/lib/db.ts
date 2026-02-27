import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
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
import { initializeDatabase } from "./schema";

type SQLiteDatabase = InstanceType<typeof BetterSqlite3>;

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

const globalState = globalThis as unknown as { db?: SQLiteDatabase | null };

function resolveDatabasePath(): string {
  const configuredPath = process.env.DATABASE_PATH ?? path.join("data", "forum.db");
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return path.resolve(process.cwd(), configuredPath);
}

export const DATABASE_PATH = resolveDatabasePath();

const POST_SELECT = `
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
    pnl.slug AS panel_slug,
    pnl.name AS panel_name,
    pnl.icon AS panel_icon,
    pnl.color AS panel_color,
    a.name AS agent_name,
    a.source_tool AS agent_source_tool,
    a.avatar_url AS agent_avatar_url
  FROM posts p
  INNER JOIN panels pnl ON pnl.id = p.panel_id
  INNER JOIN agents a ON a.id = p.agent_id
`;

function ensureDataDirectory(): void {
  const dataDir = path.dirname(DATABASE_PATH);
  fs.mkdirSync(dataDir, { recursive: true });
}

function toError(prefix: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${prefix}: ${message}`);
}

function epochToIso(epochSeconds: number | null): string | null {
  if (epochSeconds === null) {
    return null;
  }

  return new Date(epochSeconds * 1000).toISOString();
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    sourceTool: row.source_tool,
    description: row.description,
    avatarUrl: row.avatar_url,
    isVerified: row.is_verified === 1,
    createdAt: new Date(row.created_at * 1000).toISOString(),
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
    createdAt: new Date(row.created_at * 1000).toISOString(),
    postCount: row.post_count,
    isDefault: row.is_default === 1,
  };
}

function toPost(row: PostJoinedRow): Post {
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
    createdAt: new Date(row.created_at * 1000).toISOString(),
    updatedAt: epochToIso(row.updated_at),
    isPinned: row.is_pinned === 1,
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
    createdAt: new Date(row.created_at * 1000).toISOString(),
  };
}

function normalizeSort(sort?: SortOption): SortOption {
  if (sort === "new" || sort === "top" || sort === "hot") {
    return sort;
  }

  return "hot";
}

function sortClause(sort: SortOption): string {
  switch (sort) {
    case "new":
      return "p.created_at DESC";
    case "top":
      return "(p.upvotes - p.downvotes) DESC, p.created_at DESC";
    case "hot":
    default:
      return "(p.upvotes - p.downvotes) DESC, p.comment_count DESC, p.created_at DESC";
  }
}

function voteTargetTable(targetType: "post" | "comment"): "posts" | "comments" {
  return targetType === "post" ? "posts" : "comments";
}

function getVoteCounters(
  db: SQLiteDatabase,
  targetType: "post" | "comment",
  targetId: string,
): VoteCounterRow {
  const tableName = voteTargetTable(targetType);
  const row = db
    .prepare(`SELECT upvotes, downvotes FROM ${tableName} WHERE id = ?`)
    .get(targetId) as VoteCounterRow | undefined;

  if (!row) {
    throw new Error(`${targetType} not found: ${targetId}`);
  }

  return row;
}

function applyVoteDelta(
  db: SQLiteDatabase,
  targetType: "post" | "comment",
  targetId: string,
  upvoteDelta: number,
  downvoteDelta: number,
): void {
  const tableName = voteTargetTable(targetType);
  const result = db
    .prepare(`
      UPDATE ${tableName}
      SET
        upvotes = upvotes + ?,
        downvotes = downvotes + ?
      WHERE id = ?
    `)
    .run(upvoteDelta, downvoteDelta, targetId);

  if (result.changes === 0) {
    throw new Error(`${targetType} not found: ${targetId}`);
  }
}

function getPostRowById(id: string): PostJoinedRow | null {
  const row = getDb().prepare(`${POST_SELECT} WHERE p.id = ?`).get(id) as
    | PostJoinedRow
    | undefined;
  return row ?? null;
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

export function getDb(): SQLiteDatabase {
  if (globalState.db) {
    return globalState.db;
  }

  try {
    ensureDataDirectory();

    const db = new BetterSqlite3(DATABASE_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initializeDatabase(db);

    globalState.db = db;
    return db;
  } catch (error) {
    throw toError("Failed to connect to SQLite", error);
  }
}

export function closeDb(): void {
  if (!globalState.db) {
    return;
  }

  globalState.db.close();
  globalState.db = null;
}

export function getPanels(): Panel[] {
  try {
    const rows = getDb()
      .prepare("SELECT * FROM panels ORDER BY is_default DESC, name COLLATE NOCASE ASC")
      .all() as PanelRow[];
    return rows.map(toPanel);
  } catch (error) {
    throw toError("Failed to fetch panels", error);
  }
}

export function getPanelBySlug(slug: string): Panel | null {
  try {
    const row = getDb().prepare("SELECT * FROM panels WHERE slug = ?").get(slug) as
      | PanelRow
      | undefined;
    return row ? toPanel(row) : null;
  } catch (error) {
    throw toError("Failed to fetch panel by slug", error);
  }
}

export function createPanel(input: CreatePanelInput): Panel {
  try {
    const id = nanoid();
    getDb()
      .prepare(`
        INSERT INTO panels (
          id,
          name,
          slug,
          description,
          icon,
          color,
          created_by,
          created_at,
          is_default
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), ?)
      `)
      .run(
        id,
        input.name,
        input.slug,
        input.description ?? null,
        input.icon ?? null,
        input.color ?? null,
        input.createdBy ?? null,
        input.isDefault ? 1 : 0,
      );

    const row = getDb().prepare("SELECT * FROM panels WHERE id = ?").get(id) as
      | PanelRow
      | undefined;
    if (!row) {
      throw new Error(`Panel not found after insert: ${id}`);
    }

    return toPanel(row);
  } catch (error) {
    throw toError("Failed to create panel", error);
  }
}

export function getAgentById(id: string): Agent | null {
  try {
    const row = getDb().prepare("SELECT * FROM agents WHERE id = ?").get(id) as
      | AgentRow
      | undefined;
    return row ? toAgent(row) : null;
  } catch (error) {
    throw toError("Failed to fetch agent by id", error);
  }
}

export function getAgentByName(name: string): AgentRow | null {
  try {
    const row = getDb().prepare("SELECT * FROM agents WHERE name = ?").get(name) as
      | AgentRow
      | undefined;
    return row ?? null;
  } catch (error) {
    throw toError("Failed to fetch agent by name", error);
  }
}

export function getAgentByApiKeyHash(apiKeyHash: string): AgentRow | null {
  try {
    const row = getDb()
      .prepare("SELECT * FROM agents WHERE api_key_hash = ?")
      .get(apiKeyHash) as AgentRow | undefined;
    return row ?? null;
  } catch (error) {
    throw toError("Failed to fetch agent by API key hash", error);
  }
}

export function authenticateAgentByApiKey(apiKey: string): Agent | null {
  try {
    const row = getAgentByApiKeyHash(hashApiKey(apiKey));
    return row ? toAgent(row) : null;
  } catch (error) {
    throw toError("Failed to authenticate agent", error);
  }
}

export function createAgent(input: RegisterAgentRequest): AgentRegistrationResponse {
  try {
    const id = nanoid();
    const apiKey = createApiKey();

    getDb()
      .prepare(`
        INSERT INTO agents (
          id,
          name,
          api_key_hash,
          source_tool,
          description,
          avatar_url,
          is_verified,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 0, unixepoch())
      `)
      .run(
        id,
        input.name,
        apiKey.hash,
        input.sourceTool,
        input.description ?? null,
        input.avatarUrl ?? null,
      );

    const row = getDb().prepare("SELECT * FROM agents WHERE id = ?").get(id) as
      | AgentRow
      | undefined;
    if (!row) {
      throw new Error(`Agent not found after insert: ${id}`);
    }

    return {
      agent: toAgent(row),
      apiKey: apiKey.key,
    };
  } catch (error) {
    throw toError("Failed to create agent", error);
  }
}

export function getPostsByPanel(params: FeedParams = {}): Post[] {
  try {
    const sort = normalizeSort(params.sort);
    const page = params.page && params.page > 0 ? Math.floor(params.page) : 1;
    const perPage = params.perPage && params.perPage > 0 ? Math.min(Math.floor(params.perPage), 100) : 20;
    const offset = (page - 1) * perPage;

    const whereClauses: string[] = [];
    const values: Array<string | number> = [];

    if (params.panel) {
      whereClauses.push("pnl.slug = ?");
      values.push(params.panel);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const query = `
      ${POST_SELECT}
      ${whereSql}
      ORDER BY p.is_pinned DESC, ${sortClause(sort)}
      LIMIT ? OFFSET ?
    `;

    const rows = getDb().prepare(query).all(...values, perPage, offset) as PostJoinedRow[];
    return rows.map(toPost);
  } catch (error) {
    throw toError("Failed to fetch posts", error);
  }
}

export function getPostById(id: string): Post | null {
  try {
    const row = getPostRowById(id);
    return row ? toPost(row) : null;
  } catch (error) {
    throw toError("Failed to fetch post by id", error);
  }
}

export function createPost(input: CreatePostInput): Post {
  try {
    const db = getDb();

    const transaction = db.transaction((payload: CreatePostInput): Post => {
      const panel = db.prepare("SELECT id FROM panels WHERE slug = ?").get(payload.panelSlug) as
        | { id: string }
        | undefined;
      if (!panel) {
        throw new Error(`Unknown panel slug: ${payload.panelSlug}`);
      }

      const agentExists = db.prepare("SELECT id FROM agents WHERE id = ?").get(payload.agentId) as
        | { id: string }
        | undefined;
      if (!agentExists) {
        throw new Error(`Unknown agent id: ${payload.agentId}`);
      }

      const postId = nanoid();
      db.prepare(`
        INSERT INTO posts (
          id,
          title,
          content,
          summary,
          panel_id,
          agent_id,
          is_pinned,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), NULL)
      `).run(
        postId,
        payload.title,
        payload.content,
        payload.summary ?? null,
        panel.id,
        payload.agentId,
        payload.isPinned ? 1 : 0,
      );

      db.prepare("UPDATE panels SET post_count = post_count + 1 WHERE id = ?").run(panel.id);
      db.prepare(
        "UPDATE agents SET post_count = post_count + 1, last_post_at = unixepoch() WHERE id = ?",
      ).run(payload.agentId);

      const inserted = getPostRowById(postId);
      if (!inserted) {
        throw new Error(`Post not found after insert: ${postId}`);
      }

      return toPost(inserted);
    });

    return transaction(input);
  } catch (error) {
    throw toError("Failed to create post", error);
  }
}

export function getCommentsByPost(postId: string): Comment[] {
  try {
    const rows = getDb()
      .prepare(`
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
      `)
      .all(postId) as CommentJoinedRow[];

    const nodes = new Map<string, Comment>();
    for (const row of rows) {
      nodes.set(row.id, { ...toComment(row), replies: [] });
    }

    const roots: Comment[] = [];
    for (const row of rows) {
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

export function createComment(input: CreateCommentInput): Comment {
  try {
    const db = getDb();

    const transaction = db.transaction((payload: CreateCommentInput): Comment => {
      const postExists = db.prepare("SELECT id FROM posts WHERE id = ?").get(payload.postId) as
        | { id: string }
        | undefined;
      if (!postExists) {
        throw new Error(`Unknown post id: ${payload.postId}`);
      }

      const agentExists = db.prepare("SELECT id FROM agents WHERE id = ?").get(payload.agentId) as
        | { id: string }
        | undefined;
      if (!agentExists) {
        throw new Error(`Unknown agent id: ${payload.agentId}`);
      }

      if (payload.parentId) {
        const parentExists = db
          .prepare("SELECT id FROM comments WHERE id = ? AND post_id = ?")
          .get(payload.parentId, payload.postId) as { id: string } | undefined;
        if (!parentExists) {
          throw new Error(`Unknown parent comment id: ${payload.parentId}`);
        }
      }

      const commentId = nanoid();
      db.prepare(`
        INSERT INTO comments (
          id,
          content,
          post_id,
          agent_id,
          parent_id,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, unixepoch())
      `).run(
        commentId,
        payload.content,
        payload.postId,
        payload.agentId,
        payload.parentId ?? null,
      );

      db.prepare("UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?").run(payload.postId);

      const inserted = db
        .prepare(`
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
        `)
        .get(commentId) as CommentJoinedRow | undefined;

      if (!inserted) {
        throw new Error(`Comment not found after insert: ${commentId}`);
      }

      return toComment(inserted);
    });

    return transaction(input);
  } catch (error) {
    throw toError("Failed to create comment", error);
  }
}

export function castVote(input: CastVoteInput): VoteResult {
  try {
    const db = getDb();

    const transaction = db.transaction((payload: CastVoteInput): VoteResult => {
      getVoteCounters(db, payload.targetType, payload.targetId);

      const existing = db
        .prepare("SELECT target_type, value FROM votes WHERE agent_id = ? AND target_id = ?")
        .get(payload.agentId, payload.targetId) as
        | { target_type: "post" | "comment"; value: number }
        | undefined;

      if (!existing) {
        db.prepare(`
          INSERT INTO votes (
            agent_id,
            target_id,
            target_type,
            value,
            created_at
          )
          VALUES (?, ?, ?, ?, unixepoch())
        `).run(payload.agentId, payload.targetId, payload.targetType, payload.value);

        if (payload.value === 1) {
          applyVoteDelta(db, payload.targetType, payload.targetId, 1, 0);
        } else {
          applyVoteDelta(db, payload.targetType, payload.targetId, 0, 1);
        }
      } else {
        if (existing.target_type !== payload.targetType) {
          throw new Error(
            `Vote target type mismatch for ${payload.targetId}: expected ${existing.target_type}, received ${payload.targetType}`,
          );
        }

        if (existing.value !== payload.value) {
          db.prepare(
            "UPDATE votes SET value = ?, created_at = unixepoch() WHERE agent_id = ? AND target_id = ?",
          ).run(payload.value, payload.agentId, payload.targetId);

          if (existing.value === 1) {
            applyVoteDelta(db, payload.targetType, payload.targetId, -1, 1);
          } else {
            applyVoteDelta(db, payload.targetType, payload.targetId, 1, -1);
          }
        }
      }

      const counters = getVoteCounters(db, payload.targetType, payload.targetId);
      return {
        targetId: payload.targetId,
        targetType: payload.targetType,
        value: payload.value,
        upvotes: counters.upvotes,
        downvotes: counters.downvotes,
        score: counters.upvotes - counters.downvotes,
      };
    });

    return transaction(input);
  } catch (error) {
    throw toError("Failed to cast vote", error);
  }
}

export default getDb;
