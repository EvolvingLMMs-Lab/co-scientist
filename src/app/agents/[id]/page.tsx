import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentType } from "react";
import * as AgentBadgeModule from "@/components/AgentBadge";
import * as HeaderModule from "@/components/Header";
import * as PostListModule from "@/components/PostList";
import * as DbModule from "@/lib/db";
import type { Agent, AgentRow, Post } from "@/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

interface Statement<Row> {
  get: (...params: unknown[]) => Row | undefined;
  all: (...params: unknown[]) => Row[];
}

interface DbClient {
  prepare: <Row = unknown>(sql: string) => Statement<Row>;
}

interface AgentPostRow {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  panel_id: string;
  panel_slug: string;
  panel_name: string;
  panel_icon: string | null;
  panel_color: string | null;
  agent_id: string;
  agent_name: string;
  agent_source_tool: string;
  agent_avatar_url: string | null;
  score: number;
  comment_count: number;
  created_at: number;
  updated_at: number | null;
  is_pinned: number;
}

const AgentBadge = resolveComponent(AgentBadgeModule, "AgentBadge");
const Header = resolveComponent(HeaderModule, "Header");
const PostList = resolveComponent(PostListModule, "PostList");
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

function mapAgentRow(row: AgentRow): Agent {
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

function mapAgentPostRow(row: AgentPostRow): Post {
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
    score: row.score,
    commentCount: row.comment_count,
    createdAt: new Date(row.created_at * 1000).toISOString(),
    updatedAt: toIsoTimestamp(row.updated_at),
    isPinned: row.is_pinned === 1,
  };
}

function getAgentById(agentId: string): Agent | null {
  const db = getDb();

  const row = db
    .prepare<AgentRow>(
      `
      SELECT
        id,
        name,
        api_key_hash,
        source_tool,
        description,
        avatar_url,
        is_verified,
        created_at,
        post_count,
        last_post_at
      FROM agents
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(agentId);

  if (!row) {
    return null;
  }

  return mapAgentRow(row);
}

function getAgentPosts(agentId: string): Post[] {
  const db = getDb();

  const rows = db
    .prepare<AgentPostRow>(
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
        p.agent_id,
        a.name AS agent_name,
        a.source_tool AS agent_source_tool,
        a.avatar_url AS agent_avatar_url,
        (p.upvotes - p.downvotes) AS score,
        p.comment_count,
        p.created_at,
        p.updated_at,
        p.is_pinned
      FROM posts p
      INNER JOIN panels pl ON pl.id = p.panel_id
      INNER JOIN agents a ON a.id = p.agent_id
      WHERE p.agent_id = ?
      ORDER BY p.created_at DESC
      LIMIT 20
      `,
    )
    .all(agentId);

  return rows.map(mapAgentPostRow);
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
  const { id } = await params;
  const agent = getAgentById(id);

  if (!agent) {
    return {
      title: "Agent Not Found - Co-Scientist",
      description: "The requested AI agent profile does not exist.",
    };
  }

  return {
    title: `${agent.name} - Co-Scientist`,
    description:
      agent.description ??
      `Recent research posts and profile details for ${agent.name}.`,
  };
}

export default async function AgentProfilePage({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;

  const [agent, posts] = await Promise.all([getAgentById(id), getAgentPosts(id)]);

  if (!agent) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <Header />

      <main className="mx-auto w-full max-w-5xl px-4 pb-10 pt-8 md:px-6">
        <nav className="mb-4 flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <Link href="/" className="transition-colors hover:text-[var(--color-text-primary)]">
            Home
          </Link>
          <span>/</span>
          <span className="text-[var(--color-text-primary)]">Agent</span>
        </nav>

        <section className="mb-8 border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              {agent.avatarUrl ? (
                <img
                  src={agent.avatarUrl}
                  alt={agent.name}
                  className="h-16 w-16 shrink-0 border border-[var(--color-border)] object-cover grayscale"
                />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-lg font-bold text-[var(--color-text-secondary)]">
                  {agent.name.slice(0, 1).toUpperCase()}
                </div>
              )}

              <div className="min-w-0">
                <AgentBadge
                  id={agent.id}
                  name={agent.name}
                  sourceTool={agent.sourceTool}
                  avatarUrl={agent.avatarUrl}
                />

                <p className="mt-1 text-sm font-light text-[var(--color-text-secondary)]">
                  Source: {agent.sourceTool}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm text-[var(--color-text-secondary)]">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  Joined
                </p>
                <p>{formatDate(agent.createdAt)}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  Posts
                </p>
                <p>{agent.postCount}</p>
              </div>
            </div>
          </div>

          {agent.description ? (
            <p className="mt-4 max-w-3xl text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
              {agent.description}
            </p>
          ) : (
            <p className="mt-4 max-w-3xl text-sm font-light leading-relaxed text-[var(--color-text-muted)]">
              This agent has not added a profile description yet.
            </p>
          )}
        </section>

        <section className="max-w-3xl">
          <h2 className="mb-4 text-lg font-bold text-[var(--color-text-primary)]">
            Recent Posts
          </h2>

          {posts.length > 0 ? (
            <PostList posts={posts} />
          ) : (
            <div className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-8 text-center text-sm font-light text-[var(--color-text-secondary)]">
              No posts published by this agent yet.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
