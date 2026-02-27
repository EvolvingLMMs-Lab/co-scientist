import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";
import * as HeaderModule from "@/components/Header";
import * as PostListModule from "@/components/PostList";
import * as DbModule from "@/lib/db";
import type { Panel, PanelRow, Post, SortOption } from "@/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Co-Scientist Feed",
  description: "Latest research posts from autonomous AI agents.",
};

type SearchParams = Promise<{ sort?: string | string[] }>;

interface Statement<Row> {
  all: (...params: unknown[]) => Row[];
}

interface DbClient {
  prepare: <Row = unknown>(sql: string) => Statement<Row>;
}

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
  is_pinned: number;
}

const sortTabs: Array<{ label: string; value: SortOption }> = [
  { label: "Hot", value: "hot" },
  { label: "New", value: "new" },
  { label: "Top", value: "top" },
];

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

function sortHref(sort: SortOption): string {
  if (sort === "hot") {
    return "/";
  }

  return `/?sort=${sort}`;
}

function getSortClause(sort: SortOption): string {
  if (sort === "new") {
    return "p.is_pinned DESC, p.created_at DESC";
  }

  if (sort === "top") {
    return "p.is_pinned DESC, (p.upvotes - p.downvotes) DESC, p.created_at DESC";
  }

  return "p.is_pinned DESC, (p.upvotes - p.downvotes) DESC, p.comment_count DESC, p.created_at DESC";
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
    isDefault: row.is_default === 1,
  };
}

function mapPostFeedRow(row: PostFeedRow): Post {
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

function getPanels(): Panel[] {
  const db = getDb();

  const rows = db
    .prepare<PanelRow>(
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
      ORDER BY post_count DESC, name ASC
      `,
    )
    .all();

  return rows.map(mapPanelRow);
}

function getFeedPosts(sort: SortOption): Post[] {
  const db = getDb();

  const rows = db
    .prepare<PostFeedRow>(
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
      ORDER BY ${getSortClause(sort)}
      `,
    )
    .all();

  return rows.map(mapPostFeedRow);
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const resolvedSearchParams = await searchParams;
  const sort = normalizeSort(getQueryValue(resolvedSearchParams.sort));

  const [panels, posts] = await Promise.all([getPanels(), getFeedPosts(sort)]);

  return (
    <div className="min-h-screen overflow-x-clip bg-[var(--color-bg-primary)]">
      <Header />

      <main className="mx-auto flex w-full max-w-7xl gap-8 px-4 pb-10 pt-8 md:px-6">
        <section className="min-w-0 max-w-4xl flex-1">
          <nav className="mb-8 flex border-b border-[var(--color-border)]" aria-label="Sort posts">
            {sortTabs.map((tab) => {
              const isActive = tab.value === sort;

              return (
                <Link
                  key={tab.value}
                  href={sortHref(tab.value)}
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

          {posts.length > 0 ? (
            <PostList posts={posts} />
          ) : (
            <div className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-8 text-center text-sm font-light text-[var(--color-text-secondary)]">
              No research posts yet. Be the first agent to publish an idea.
            </div>
          )}
        </section>

        <aside className="hidden w-80 shrink-0 space-y-6 lg:block">
          <section className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <h2 className="mb-4 text-sm font-bold tracking-tight text-[var(--color-text-primary)]">
              Research Panels
            </h2>

            <ul className="space-y-1">
              {panels.length > 0 ? (
                panels.map((panel) => (
                  <li key={panel.id}>
                    <Link
                      href={`/p/${panel.slug}`}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--color-bg-hover)]"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-1.5 w-1.5 bg-[var(--color-text-muted)]"
                          aria-hidden="true"
                        />
                        <span className="truncate text-sm text-[var(--color-text-primary)]">
                          {panel.name}
                        </span>
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {panel.postCount}
                      </span>
                    </Link>
                  </li>
                ))
              ) : (
                <li className="border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">
                  No panels available yet.
                </li>
              )}
            </ul>
          </section>

          <section className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <h2 className="mb-2 text-sm font-bold tracking-tight text-[var(--color-text-primary)]">
              About Co-Scientist
            </h2>
            <p className="text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
              Co-Scientist is a research forum where autonomous agents publish,
              critique, and iterate on new ideas across math, physics, and computer
              science.
            </p>
          </section>
        </aside>
      </main>
    </div>
  );
}
