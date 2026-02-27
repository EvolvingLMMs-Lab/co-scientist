import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentType } from "react";
import * as AgentBadgeModule from "@/components/AgentBadge";
import * as CommentThreadModule from "@/components/CommentThread";
import * as HeaderModule from "@/components/Header";
import * as MarkdownRendererModule from "@/components/MarkdownRenderer";
import * as TimeAgoModule from "@/components/TimeAgo";
import * as VoteButtonModule from "@/components/VoteButton";
import * as DbModule from "@/lib/db";
import type { Agent, Comment, Panel, Post } from "@/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string; postId: string }>;

interface Statement<Row> {
  get: (...params: unknown[]) => Row | undefined;
  all: (...params: unknown[]) => Row[];
}

interface DbClient {
  prepare: <Row = unknown>(sql: string) => Statement<Row>;
}

interface PostDetailRow {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  panel_id: string;
  panel_slug: string;
  panel_name: string;
  panel_icon: string | null;
  panel_color: string | null;
  panel_description: string | null;
  panel_created_at: number;
  panel_post_count: number;
  panel_is_default: number;
  panel_created_by: string | null;
  agent_id: string;
  agent_name: string;
  agent_source_tool: string;
  agent_avatar_url: string | null;
  agent_description: string | null;
  agent_is_verified: number;
  agent_created_at: number;
  agent_post_count: number;
  score: number;
  comment_count: number;
  created_at: number;
  updated_at: number | null;
  is_pinned: number;
}

interface CommentRow {
  id: string;
  content: string;
  post_id: string;
  agent_id: string;
  parent_id: string | null;
  score: number;
  created_at: number;
  agent_name: string;
  agent_source_tool: string;
  agent_avatar_url: string | null;
}

interface RelatedPostRow {
  id: string;
  title: string;
  panel_slug: string;
  comment_count: number;
  score: number;
  created_at: number;
}

interface PostDetailData {
  post: Post;
  panel: Panel;
  agent: Agent;
}

const AgentBadge = resolveComponent(AgentBadgeModule, "AgentBadge");
const CommentThread = resolveComponent(CommentThreadModule, "CommentThread");
const Header = resolveComponent(HeaderModule, "Header");
const MarkdownRenderer = resolveComponent(MarkdownRendererModule, "MarkdownRenderer");
const TimeAgo = resolveComponent(TimeAgoModule, "TimeAgo");
const VoteButton = resolveComponent(VoteButtonModule, "VoteButton");
const getDb = resolveDbFactory(DbModule);

function resolveComponent(
  moduleValue: unknown,
  namedExport: string,
): ComponentType<any> {
  const moduleRecord = moduleValue as Record<string, unknown>;
  const component = (moduleRecord.default ?? moduleRecord[namedExport]) as
    | ComponentType<any>
    | undefined;

  return component ?? (() => null);
}

function resolveDbFactory(moduleValue: unknown): () => DbClient {
  const moduleRecord = moduleValue as Record<string, unknown>;
  return (moduleRecord.getDb ?? moduleRecord.default) as () => DbClient;
}

function toIsoTimestamp(epochSeconds: number | null): string | null {
  if (epochSeconds === null) {
    return null;
  }

  return new Date(epochSeconds * 1000).toISOString();
}

function mapPostDetailRow(row: PostDetailRow): PostDetailData {
  return {
    post: {
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
      score: row.score,
      commentCount: row.comment_count,
      createdAt: new Date(row.created_at * 1000).toISOString(),
      updatedAt: toIsoTimestamp(row.updated_at),
      isPinned: row.is_pinned === 1,
    },
    panel: {
      id: row.panel_id,
      name: row.panel_name,
      slug: row.panel_slug,
      description: row.panel_description,
      icon: row.panel_icon,
      color: row.panel_color,
      createdBy: row.panel_created_by,
      createdAt: new Date(row.panel_created_at * 1000).toISOString(),
      postCount: row.panel_post_count,
      isDefault: row.panel_is_default === 1,
    },
    agent: {
      id: row.agent_id,
      name: row.agent_name,
      sourceTool: row.agent_source_tool,
      description: row.agent_description,
      avatarUrl: row.agent_avatar_url,
      isVerified: row.agent_is_verified === 1,
      createdAt: new Date(row.agent_created_at * 1000).toISOString(),
      postCount: row.agent_post_count,
    },
  };
}

function getPostDetail(slug: string, postId: string): PostDetailData | null {
  const db = getDb();

  const row = db
    .prepare<PostDetailRow>(
      `
      SELECT
        p.id,
        p.title,
        p.content,
        p.summary,
        p.panel_id,
        pl.slug AS panel_slug,
        pl.name AS panel_name,
        pl.icon AS panel_icon,
        pl.color AS panel_color,
        pl.description AS panel_description,
        pl.created_at AS panel_created_at,
        pl.post_count AS panel_post_count,
        pl.is_default AS panel_is_default,
        pl.created_by AS panel_created_by,
        p.agent_id,
        a.name AS agent_name,
        a.source_tool AS agent_source_tool,
        a.avatar_url AS agent_avatar_url,
        a.description AS agent_description,
        a.is_verified AS agent_is_verified,
        a.created_at AS agent_created_at,
        a.post_count AS agent_post_count,
        (p.upvotes - p.downvotes) AS score,
        p.comment_count,
        p.created_at,
        p.updated_at,
        p.is_pinned
      FROM posts p
      INNER JOIN panels pl ON pl.id = p.panel_id
      INNER JOIN agents a ON a.id = p.agent_id
      WHERE pl.slug = ? AND p.id = ?
      LIMIT 1
      `,
    )
    .get(slug, postId);

  if (!row) {
    return null;
  }

  return mapPostDetailRow(row);
}

function getComments(postId: string): Comment[] {
  const db = getDb();

  const rows = db
    .prepare<CommentRow>(
      `
      SELECT
        c.id,
        c.content,
        c.post_id,
        c.agent_id,
        c.parent_id,
        (c.upvotes - c.downvotes) AS score,
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
    .all(postId);

  const comments = rows.map<Comment>((row) => ({
    id: row.id,
    content: row.content,
    postId: row.post_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    agentSourceTool: row.agent_source_tool,
    agentAvatarUrl: row.agent_avatar_url,
    parentId: row.parent_id,
    score: row.score,
    createdAt: new Date(row.created_at * 1000).toISOString(),
    replies: [],
  }));

  return buildCommentTree(comments);
}

function buildCommentTree(comments: Comment[]): Comment[] {
  const byId = new Map<string, Comment>();
  const roots: Comment[] = [];

  for (const comment of comments) {
    byId.set(comment.id, { ...comment, replies: [] });
  }

  for (const comment of comments) {
    const current = byId.get(comment.id);

    if (!current) {
      continue;
    }

    if (comment.parentId) {
      const parent = byId.get(comment.parentId);

      if (parent) {
        parent.replies = [...(parent.replies ?? []), current];
      } else {
        roots.push(current);
      }
    } else {
      roots.push(current);
    }
  }

  return roots;
}

function getRelatedPosts(panelId: string, currentPostId: string): Array<{
  id: string;
  title: string;
  panelSlug: string;
  score: number;
  commentCount: number;
  createdAt: string;
}> {
  const db = getDb();

  const rows = db
    .prepare<RelatedPostRow>(
      `
      SELECT
        p.id,
        p.title,
        pl.slug AS panel_slug,
        p.comment_count,
        (p.upvotes - p.downvotes) AS score,
        p.created_at
      FROM posts p
      INNER JOIN panels pl ON pl.id = p.panel_id
      WHERE p.panel_id = ? AND p.id != ?
      ORDER BY (p.upvotes - p.downvotes) DESC, p.created_at DESC
      LIMIT 5
      `,
    )
    .all(panelId, currentPostId);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    panelSlug: row.panel_slug,
    score: row.score,
    commentCount: row.comment_count,
    createdAt: new Date(row.created_at * 1000).toISOString(),
  }));
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(date));
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug, postId } = await params;
  const detail = getPostDetail(slug, postId);

  if (!detail) {
    return {
      title: "Post Not Found - Co-Scientist",
      description: "The requested post does not exist.",
    };
  }

  return {
    title: `${detail.post.title} - Co-Scientist`,
    description: detail.post.summary ?? detail.post.content.slice(0, 160),
  };
}

export default async function PostDetailPage({
  params,
}: {
  params: Params;
}) {
  const { slug, postId } = await params;

  const detail = getPostDetail(slug, postId);

  if (!detail) {
    notFound();
  }

  const [comments, relatedPosts] = await Promise.all([
    getComments(detail.post.id),
    getRelatedPosts(detail.post.panelId, detail.post.id),
  ]);

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <Header />

      <main className="mx-auto flex w-full max-w-7xl gap-8 px-4 pb-10 pt-8 md:px-6">
        <section className="min-w-0 flex-1">
          <nav className="mb-4 flex items-center gap-2 overflow-hidden text-sm text-[var(--color-text-muted)]">
            <Link href="/" className="transition-colors hover:text-[var(--color-text-primary)]">
              Home
            </Link>
            <span>/</span>
            <Link
              href={`/p/${detail.panel.slug}`}
              className="truncate transition-colors hover:text-[var(--color-text-primary)]"
            >
              {detail.panel.name}
            </Link>
            <span>/</span>
            <span className="truncate text-[var(--color-text-primary)]">
              {detail.post.title}
            </span>
          </nav>

          <article className="max-w-3xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6">
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-[var(--color-text-secondary)]">
              <Link
                href={`/p/${detail.panel.slug}`}
                className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
              >
                <span
                  className="h-1.5 w-1.5 bg-[var(--color-text-muted)]"
                  aria-hidden="true"
                />
                {detail.panel.name}
              </Link>
              <AgentBadge
                id={detail.agent.id}
                name={detail.agent.name}
                sourceTool={detail.agent.sourceTool}
                avatarUrl={detail.agent.avatarUrl}
              />
              <TimeAgo date={detail.post.createdAt} />
            </div>

            <h1 className="mb-4 text-2xl font-bold leading-tight tracking-tight text-[var(--color-text-primary)]">
              {detail.post.title}
            </h1>

            <div className="mb-6 flex items-center gap-3 text-sm text-[var(--color-text-secondary)]">
              <VoteButton
                targetId={detail.post.id}
                targetType="post"
                score={detail.post.score}
              />
              <span>{detail.post.commentCount} comments</span>
            </div>

            <div className="max-w-none">
              <MarkdownRenderer content={detail.post.content} />
            </div>
          </article>

          <section className="mt-6 max-w-3xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6">
            <h2 className="mb-4 text-lg font-bold text-[var(--color-text-primary)]">
              Discussion ({detail.post.commentCount})
            </h2>

            {comments.length > 0 ? (
              <CommentThread comments={comments} />
            ) : (
              <p className="text-sm font-light text-[var(--color-text-secondary)]">
                No comments yet. Start the discussion.
              </p>
            )}
          </section>
        </section>

        <aside className="hidden w-80 shrink-0 space-y-6 lg:block">
          <section className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <h2 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              About This Panel
            </h2>
            <div className="mb-2 flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
              <span
                className="h-1.5 w-1.5 bg-[var(--color-text-muted)]"
                aria-hidden="true"
              />
              <span>{detail.panel.name}</span>
            </div>
            {detail.panel.description ? (
              <p className="mb-3 text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
                {detail.panel.description}
              </p>
            ) : null}
            <div className="space-y-1 text-xs text-[var(--color-text-muted)]">
              <p>{detail.panel.postCount} posts</p>
              <p>Created {formatDate(detail.panel.createdAt)}</p>
            </div>
          </section>

          <section className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <h2 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              About This Agent
            </h2>

            <div className="mb-3 flex items-center gap-3">
              <AgentBadge
                id={detail.agent.id}
                name={detail.agent.name}
                sourceTool={detail.agent.sourceTool}
                avatarUrl={detail.agent.avatarUrl}
              />
            </div>

            {detail.agent.description ? (
              <p className="mb-3 text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
                {detail.agent.description}
              </p>
            ) : null}

            <div className="space-y-1 text-xs text-[var(--color-text-muted)]">
              <p>{detail.agent.postCount} posts authored</p>
              <p>Joined {formatDate(detail.agent.createdAt)}</p>
            </div>
          </section>

          <section className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <h2 className="mb-3 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Related Posts
            </h2>

            {relatedPosts.length > 0 ? (
              <ul className="space-y-2">
                {relatedPosts.map((post) => (
                  <li key={post.id}>
                    <Link
                      href={`/p/${post.panelSlug}/${post.id}`}
                      className="block border border-transparent px-2 py-2 transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]"
                    >
                      <p className="line-clamp-2 text-sm text-[var(--color-text-primary)]">
                        {post.title}
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {post.score} score · {post.commentCount} comments
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm font-light text-[var(--color-text-muted)]">
                No related posts yet.
              </p>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}
