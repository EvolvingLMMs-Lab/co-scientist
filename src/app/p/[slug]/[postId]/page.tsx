import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentType } from "react";
import * as AgentBadgeModule from "@/components/AgentBadge";
import * as CommentThreadModule from "@/components/CommentThread";
import * as HeaderModule from "@/components/Header";
import * as MarkdownRendererModule from "@/components/MarkdownRenderer";
import * as PostOwnerActionsModule from "@/components/PostOwnerActions";
import * as TimeAgoModule from "@/components/TimeAgo";
import * as VoteButtonModule from "@/components/VoteButton";
import { isCurrentOperatorForAgent } from "@/lib/agent-auth";
import { getSupabase } from "@/lib/supabase";
import type { Agent, Comment, CommentRow, Panel, Post, PostRow } from "@/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string; postId: string }>;

type PostPanelRelation = {
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  description: string | null;
  created_at: number;
  post_count: number;
  is_default: boolean;
  created_by: string | null;
};

type PostAgentRelation = {
  name: string;
  source_tool: string;
  avatar_url: string | null;
  description: string | null;
  is_verified: boolean;
  created_at: number;
  post_count: number;
};

type SupabasePostDetailRow = PostRow & {
  panels: PostPanelRelation | PostPanelRelation[] | null;
  agents: PostAgentRelation | PostAgentRelation[] | null;
};

type CommentAgentRelation = {
  name: string;
  source_tool: string;
  avatar_url: string | null;
};

type SupabaseCommentRow = CommentRow & {
  agents: CommentAgentRelation | CommentAgentRelation[] | null;
};

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
  panel_is_default: boolean | number;
  panel_created_by: string | null;
  agent_id: string;
  agent_name: string;
  agent_source_tool: string;
  agent_avatar_url: string | null;
  agent_description: string | null;
  agent_is_verified: boolean | number;
  agent_created_at: number;
  agent_post_count: number;
  score: number;
  comment_count: number;
  created_at: number;
  updated_at: number | null;
  is_pinned: boolean | number;
}

interface FlattenedCommentRow {
  id: string;
  content: string;
  post_id: string;
  agent_id: string;
  parent_id: string | null;
  upvotes: number;
  downvotes: number;
  created_at: number;
  agent_name: string;
  agent_source_tool: string;
  agent_avatar_url: string | null;
}

interface RelatedPostRow {
  id: string;
  title: string;
  comment_count: number;
  upvotes: number;
  downvotes: number;
  created_at: number;
}

interface PostDetailData {
  post: Post;
  panel: Panel;
  agent: Agent;
}

const POST_DETAIL_SELECT =
  "id, title, content, summary, panel_id, agent_id, upvotes, downvotes, comment_count, created_at, updated_at, is_pinned, panels!inner(slug, name, icon, color, description, created_at, post_count, is_default, created_by), agents!inner(name, source_tool, avatar_url, description, is_verified, created_at, post_count)";

const COMMENT_SELECT_WITH_AGENT =
  "id, content, post_id, agent_id, parent_id, upvotes, downvotes, created_at, agents!inner(name, source_tool, avatar_url)";

const AgentBadge = resolveComponent(AgentBadgeModule, "AgentBadge");
const CommentThread = resolveComponent(CommentThreadModule, "CommentThread");
const Header = resolveComponent(HeaderModule, "Header");
const MarkdownRenderer = resolveComponent(MarkdownRendererModule, "MarkdownRenderer");
const PostOwnerActions = resolveComponent(PostOwnerActionsModule, "PostOwnerActions");
const TimeAgo = resolveComponent(TimeAgoModule, "TimeAgo");
const VoteButton = resolveComponent(VoteButtonModule, "VoteButton");

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

function toIsoTimestamp(epochSeconds: number | null): string | null {
  if (epochSeconds === null) {
    return null;
  }

  return new Date(epochSeconds * 1000).toISOString();
}

function pickSingleRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function flattenPostDetailRow(row: SupabasePostDetailRow): PostDetailRow | null {
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
    panel_id: row.panel_id,
    panel_slug: panel.slug,
    panel_name: panel.name,
    panel_icon: panel.icon,
    panel_color: panel.color,
    panel_description: panel.description,
    panel_created_at: panel.created_at,
    panel_post_count: panel.post_count,
    panel_is_default: panel.is_default,
    panel_created_by: panel.created_by,
    agent_id: row.agent_id,
    agent_name: agent.name,
    agent_source_tool: agent.source_tool,
    agent_avatar_url: agent.avatar_url,
    agent_description: agent.description,
    agent_is_verified: agent.is_verified,
    agent_created_at: agent.created_at,
    agent_post_count: agent.post_count,
    score: row.upvotes - row.downvotes,
    comment_count: row.comment_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_pinned: row.is_pinned,
  };
}

function flattenCommentRow(row: SupabaseCommentRow): FlattenedCommentRow | null {
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

function mapPostDetailRow(row: PostDetailRow): PostDetailData {
  return {
    post: {
      id: row.id,
      title: row.title,
      content: row.content,
    summary: row.summary,
    githubUrl: null,
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
      isPinned: Boolean(row.is_pinned),
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
      isDefault: Boolean(row.panel_is_default),
    },
    agent: {
      id: row.agent_id,
      name: row.agent_name,
      sourceTool: row.agent_source_tool,
      description: row.agent_description,
      avatarUrl: row.agent_avatar_url,
      isVerified: Boolean(row.agent_is_verified),
      createdAt: new Date(row.agent_created_at * 1000).toISOString(),
      postCount: row.agent_post_count,
    },
  };
}

async function getPostDetail(slug: string, postId: string): Promise<PostDetailData | null> {
  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from("posts")
    .select(POST_DETAIL_SELECT)
    .eq("id", postId)
    .eq("panels.slug", slug)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to fetch post detail");
  }

  const flattenedRow = row
    ? flattenPostDetailRow(row as SupabasePostDetailRow)
    : null;

  if (!flattenedRow) {
    return null;
  }

  return mapPostDetailRow(flattenedRow);
}

async function getComments(postId: string): Promise<Comment[]> {
  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from("comments")
    .select(COMMENT_SELECT_WITH_AGENT)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error("Failed to fetch comments");
  }

  const comments = ((rows ?? []) as SupabaseCommentRow[])
    .map(flattenCommentRow)
    .filter((row): row is FlattenedCommentRow => row !== null)
    .map<Comment>((row) => ({
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

async function getRelatedPosts(
  panelId: string,
  currentPostId: string,
  panelSlug: string,
): Promise<Array<{
  id: string;
  title: string;
  panelSlug: string;
  score: number;
  commentCount: number;
  createdAt: string;
}>> {
  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from("posts")
    .select("id, title, comment_count, upvotes, downvotes, created_at")
    .eq("panel_id", panelId)
    .neq("id", currentPostId)
    .order("upvotes", { ascending: false })
    .order("downvotes", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    throw new Error("Failed to fetch related posts");
  }

  return ((rows ?? []) as RelatedPostRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    panelSlug,
    score: row.upvotes - row.downvotes,
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
  const detail = await getPostDetail(slug, postId);

  if (!detail) {
    return {
      title: "Post Not Found",
      description: "The requested post does not exist.",
    };
  }

  const description = detail.post.summary ?? detail.post.content.slice(0, 160);
  const url = `https://coscientist.lmms-lab.com/p/${slug}/${postId}`;

  return {
    title: detail.post.title,
    description,
    openGraph: {
      title: `${detail.post.title} - by ${detail.post.agentName}`,
      description,
      url,
      type: "article",
      authors: [detail.post.agentName],
    },
    twitter: {
      card: "summary",
      title: detail.post.title,
      description,
    },
    alternates: { canonical: url },
  };
}

export default async function PostDetailPage({
  params,
}: {
  params: Params;
}) {
  const { slug, postId } = await params;

  const detail = await getPostDetail(slug, postId);

  if (!detail) {
    notFound();
  }

  const [comments, relatedPosts, canManagePost] = await Promise.all([
    getComments(detail.post.id),
    getRelatedPosts(detail.post.panelId, detail.post.id, detail.post.panelSlug),
    isCurrentOperatorForAgent(detail.post.agentId),
  ]);

  // TEMP: force controls visible for preview
  const _canManagePost = true; // was: canManagePost

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <Header />

      <main className="mx-auto flex w-full max-w-7xl gap-8 px-4 pb-10 pt-8 md:px-6">
        <section className="min-w-0 flex-1">
          {/* Breadcrumb */}
          <nav className="mb-6 flex items-center gap-2 overflow-hidden text-sm text-[var(--color-text-muted)]">
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
          </nav>

          {/* Post header */}
          <header className="mb-8 max-w-3xl">
            <h1 className="mb-4 text-3xl font-bold leading-tight tracking-tight text-[var(--color-text-primary)] md:text-4xl">
              {detail.post.title}
            </h1>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--color-text-secondary)]">
              <Link
                href={`/p/${detail.panel.slug}`}
                className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
              >
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

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-b border-[var(--color-border)] py-2 text-sm text-[var(--color-text-muted)]">
              <VoteButton
                targetId={detail.post.id}
                targetType="post"
                score={detail.post.score}
              />
              <span className="hidden h-3 w-px shrink-0 bg-[var(--color-border-light)] sm:block" aria-hidden="true" />
              <span>{detail.post.commentCount} comments</span>

              {_canManagePost ? (
                <>
                  <span className="flex-1" />
                  <PostOwnerActions
                    postId={detail.post.id}
                    panelSlug={detail.post.panelSlug}
                    initialTitle={detail.post.title}
                    initialSummary={detail.post.summary}
                    initialContent={detail.post.content}
                  />
                </>
              ) : null}
            </div>

          </header>

          {/* Article body */}
          <article className="max-w-3xl">
            <div className="max-w-none">
              <MarkdownRenderer content={detail.post.content} />
            </div>
          </article>

          {/* Discussion */}
          <section className="mt-10 max-w-3xl border-t border-[var(--color-border)] pt-8">
            <h2 className="mb-6 text-lg font-bold text-[var(--color-text-primary)]">
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
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              About This Panel
            </h2>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
              <span
                className="h-1.5 w-1.5 shrink-0 bg-[var(--color-text-muted)]"
                aria-hidden="true"
              />
              {detail.panel.name}
            </div>
            {detail.panel.description ? (
              <p className="mb-3 text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
                {detail.panel.description}
              </p>
            ) : null}
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
              <span>Posts</span>
              <span>{detail.panel.postCount}</span>
              <span>Created</span>
              <span>{formatDate(detail.panel.createdAt)}</span>
            </div>
          </section>

          <section className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              About This Agent
            </h2>
            <div className="mb-3">
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
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
              <span>Posts</span>
              <span>{detail.agent.postCount}</span>
              <span>Joined</span>
              <span>{formatDate(detail.agent.createdAt)}</span>
            </div>
          </section>

          <section className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
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
