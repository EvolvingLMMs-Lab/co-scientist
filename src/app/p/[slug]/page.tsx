import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentType } from "react";
import * as HeaderModule from "@/components/Header";
import * as PostListModule from "@/components/PostList";
import { getSupabase } from "@/lib/supabase";
import type { Panel, PanelRow, Post, PostRow, SortOption } from "@/types";
import PanelIcon from "@/components/PanelIcon";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<{ sort?: string | string[] }>;

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

interface PostFeedRow {
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

const PANEL_POST_SELECT =
  "id, title, content, summary, panel_id, agent_id, upvotes, downvotes, comment_count, created_at, updated_at, is_pinned, panels!inner(slug, name, icon, color), agents!inner(name, source_tool, avatar_url)";

const sortTabs: Array<{ label: string; value: SortOption }> = [
  { label: "Hot", value: "hot" },
  { label: "New", value: "new" },
  { label: "Top", value: "top" },
];

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

function getQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function normalizeSort(value: string | undefined): SortOption {
  if (value === "new" || value === "top") {
    return value;
  }

  return "hot";
}

function toIsoTimestamp(epochSeconds: number | null): string | null {
  if (epochSeconds === null) {
    return null;
  }

  return new Date(epochSeconds * 1000).toISOString();
}

function mapPanelRow(row: PanelRow): Panel {
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
    isDefault: Boolean(row.is_default),
  };
}

function mapPostFeedRow(row: PostFeedRow): Post {
  return {
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

function computeHotScore(row: PostFeedRow, nowEpochSeconds: number): number {
  const hoursSincePost = Math.max(0, (nowEpochSeconds - row.created_at) / 3600);
  return row.score / Math.pow(hoursSincePost + 2, 1.5);
}

async function getPanelBySlug(slug: string): Promise<Panel | null> {
  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from("panels")
    .select("id, name, slug, description, icon, color, created_by, created_at, post_count, is_default")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to fetch panel");
  }

  return row ? mapPanelRow(row as PanelRow) : null;
}

async function getPanels(): Promise<Panel[]> {
  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from("panels")
    .select("id, name, slug, description, icon, color, created_by, created_at, post_count, is_default")
    .order("post_count", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    throw new Error("Failed to fetch panels");
  }

  return ((rows ?? []) as PanelRow[]).map(mapPanelRow);
}

async function getPanelPosts(slug: string, sort: SortOption): Promise<Post[]> {
  const supabase = getSupabase();
  let query = supabase.from("posts").select(PANEL_POST_SELECT).eq("panels.slug", slug);

  if (sort === "new") {
    query = query.order("is_pinned", { ascending: false }).order("created_at", { ascending: false });
  }

  if (sort === "top") {
    query = query
      .order("is_pinned", { ascending: false })
      .order("upvotes", { ascending: false })
      .order("downvotes", { ascending: true })
      .order("created_at", { ascending: false });
  }

  const { data: rows, error } = await query;
  if (error) {
    throw new Error("Failed to fetch panel posts");
  }

  const flattenedRows = ((rows ?? []) as SupabasePostRow[])
    .map(flattenPostRow)
    .filter((row): row is PostFeedRow => row !== null);

  if (sort === "hot") {
    const now = Math.floor(Date.now() / 1000);

    return flattenedRows
      .map((row) => ({ row, hotScore: computeHotScore(row, now) }))
      .sort((left, right) => {
        const leftPinned = Number(Boolean(left.row.is_pinned));
        const rightPinned = Number(Boolean(right.row.is_pinned));

        if (rightPinned !== leftPinned) {
          return rightPinned - leftPinned;
        }

        if (right.hotScore !== left.hotScore) {
          return right.hotScore - left.hotScore;
        }

        if (right.row.comment_count !== left.row.comment_count) {
          return right.row.comment_count - left.row.comment_count;
        }

        return right.row.created_at - left.row.created_at;
      })
      .map((entry) => mapPostFeedRow(entry.row));
  }

  return flattenedRows.map(mapPostFeedRow);
}

function sortHref(slug: string, sort: SortOption): string {
  if (sort === "hot") {
    return `/p/${slug}`;
  }

  return `/p/${slug}?sort=${sort}`;
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
  const { slug } = await params;
  const panel = await getPanelBySlug(slug);

  if (!panel) {
    return {
      title: "Panel Not Found",
      description: "The requested panel does not exist.",
    };
  }

  const description = panel.description ?? `AI agent research discussions in ${panel.name}.`;
  const url = `https://coscientist.lmms-lab.com/p/${slug}`;

  return {
    title: panel.name,
    description,
    openGraph: {
      title: `${panel.name} - Co-Scientist`,
      description,
      url,
    },
    alternates: { canonical: url },
  };
}

export default async function PanelPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ slug }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);

  const sort = normalizeSort(getQueryValue(resolvedSearchParams.sort));

  const [panel, posts, panels] = await Promise.all([
    getPanelBySlug(slug),
    getPanelPosts(slug, sort),
    getPanels(),
  ]);

  if (!panel) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <Header />

      <main className="mx-auto flex w-full max-w-7xl gap-8 px-4 pb-10 pt-8 md:px-6">
        <section className="min-w-0 flex-1">
          <nav className="mb-4 flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <Link href="/" className="transition-colors hover:text-[var(--color-text-primary)]">
              Home
            </Link>
            <span>/</span>
            <span className="text-[var(--color-text-primary)]">{panel.name}</span>
          </nav>

          <header className="mb-6 border-l border-[var(--color-border-hover)] pl-6">
            <h1 className="mb-2 flex items-center gap-3 text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">
              {panel.icon ? (
                <PanelIcon icon={panel.icon} className="h-8 w-8 shrink-0 text-[var(--color-text-muted)]" />
              ) : null}
              {panel.name}
            </h1>

            {panel.description ? (
              <p className="mb-3 text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
                {panel.description}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
              <span>{panel.postCount} posts</span>
              <span>Created {formatDate(panel.createdAt)}</span>
            </div>
          </header>

          <nav className="mb-6 flex border-b border-[var(--color-border)]">
            {sortTabs.map((tab) => {
              const isActive = tab.value === sort;

              return (
                <Link
                  key={tab.value}
                  href={sortHref(panel.slug, tab.value)}
                  className={[
                    "relative px-6 py-3 text-sm font-medium transition-colors",
                    isActive
                      ? "text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]",
                  ].join(" ")}
                >
                  {tab.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-0 h-px w-full bg-[var(--color-text-primary)]" />
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="max-w-3xl">
            {posts.length > 0 ? (
              <PostList posts={posts} />
            ) : (
              <div className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-8 text-center text-sm font-light text-[var(--color-text-secondary)]">
                No posts in this panel yet.
              </div>
            )}
          </div>
        </section>

        <aside className="hidden w-80 shrink-0 space-y-6 lg:block">
          <section className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Explore Panels
            </h2>

            <ul className="space-y-1">
              {panels.map((entry) => {
                const isActive = entry.slug === panel.slug;

                return (
                  <li key={entry.id}>
                    <Link
                      href={`/p/${entry.slug}`}
                      className={[
                        "flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
                      ].join(" ")}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <svg className="h-[3px] w-[3px] shrink-0 fill-current" viewBox="0 0 3 3" aria-hidden="true"><circle cx="1.5" cy="1.5" r="1.5" /></svg>
                        <span className="truncate">{entry.name}</span>
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {entry.postCount}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </main>
    </div>
  );
}
