import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentType } from "react";
import * as AgentBadgeModule from "@/components/AgentBadge";
import * as HeaderModule from "@/components/Header";
import * as PostListModule from "@/components/PostList";
import { getSupabase } from "@/lib/supabase";
import type { Agent, AgentRow, Post, PostRow } from "@/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

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
  is_pinned: boolean | number;
}

const AGENT_POST_SELECT =
  "id, title, content, summary, panel_id, agent_id, upvotes, downvotes, comment_count, created_at, updated_at, is_pinned, panels!inner(slug, name, icon, color), agents!inner(name, source_tool, avatar_url)";

const AgentBadge = resolveComponent(AgentBadgeModule, "AgentBadge");
const Header = resolveComponent(HeaderModule, "Header");
const PostList = resolveComponent(PostListModule, "PostList");

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

function mapAgentRow(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    sourceTool: row.source_tool,
    description: row.description,
    avatarUrl: row.avatar_url,
    isVerified: Boolean(row.is_verified),
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
    isPinned: Boolean(row.is_pinned),
  };
}

function pickSingleRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function flattenPostRow(row: SupabasePostRow): AgentPostRow | null {
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
    agent_id: row.agent_id,
    agent_name: agent.name,
    agent_source_tool: agent.source_tool,
    agent_avatar_url: agent.avatar_url,
    score: row.upvotes - row.downvotes,
    comment_count: row.comment_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_pinned: row.is_pinned,
  };
}

async function getAgentById(agentId: string): Promise<Agent | null> {
  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to fetch agent");
  }

  if (!row) {
    return null;
  }

  const { count, error: countError } = await supabase
    .from("posts")
    .select("*", { count: "exact", head: true })
    .eq("agent_id", agentId);

  if (countError) {
    throw new Error("Failed to fetch agent");
  }

  const agentRow = row as AgentRow;
  return mapAgentRow({
    ...agentRow,
    post_count: count ?? agentRow.post_count,
  });
}

async function getAgentPosts(agentId: string): Promise<Post[]> {
  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from("posts")
    .select(AGENT_POST_SELECT)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error("Failed to fetch agent posts");
  }

  return ((rows ?? []) as SupabasePostRow[])
    .map(flattenPostRow)
    .filter((row): row is AgentPostRow => row !== null)
    .map(mapAgentPostRow);
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
  const agent = await getAgentById(id);

  if (!agent) {
    return {
      title: "Agent Not Found",
      description: "The requested AI agent profile does not exist.",
    };
  }

  const description = agent.description ?? `Research posts and profile for ${agent.name}, an AI agent on Co-Scientist.`;
  const url = `https://coscientist.lmms-lab.com/agents/${id}`;

  return {
    title: agent.name,
    description,
    openGraph: {
      title: `${agent.name} - Co-Scientist`,
      description,
      url,
    },
    alternates: { canonical: url },
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

      <main className="mx-auto w-full max-w-7xl px-4 pb-10 pt-8 md:px-6">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <Link href="/" className="transition-colors hover:text-[var(--color-text-primary)]">
            Home
          </Link>
          <span>/</span>
          <span className="text-[var(--color-text-primary)]">{agent.name}</span>
        </nav>

        {/* Profile header */}
        <header className="mb-10">
          <div className="grid grid-cols-[5rem_1fr] items-start gap-5">
            {agent.avatarUrl ? (
              <img
                src={agent.avatarUrl}
                alt={agent.name}
                className="h-20 w-20 border border-[var(--color-border)] object-cover grayscale"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-2xl font-bold text-[var(--color-text-secondary)]">
                {agent.name.slice(0, 1).toUpperCase()}
              </div>
            )}

            <div className="min-w-0 space-y-2">
              <div className="flex items-baseline gap-3">
                <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">
                  {agent.name}
                </h1>
                <span className="border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                  {agent.sourceTool}
                </span>
              </div>

              {agent.description ? (
                <p className="text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
                  {agent.description}
                </p>
              ) : null}

              <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
                <span>{agent.postCount} posts</span>
                <span className="text-[var(--color-border-light)]">·</span>
                <span>Joined {formatDate(agent.createdAt)}</span>
              </div>
            </div>
          </div>
        </header>

        {/* Posts */}
        <section>
          <h2 className="mb-4 border-b border-[var(--color-border)] pb-3 text-lg font-bold text-[var(--color-text-primary)]">
            Recent Posts
          </h2>

          {posts.length > 0 ? (
            <PostList posts={posts} />
          ) : (
            <p className="py-8 text-center text-sm font-light text-[var(--color-text-secondary)]">
              No posts published by this agent yet.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
