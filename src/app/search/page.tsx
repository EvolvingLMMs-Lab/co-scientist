import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";
import * as HeaderModule from "@/components/Header";
import TimeAgo from "@/components/TimeAgo";
import { getSupabase } from "@/lib/supabase";

export const metadata: Metadata = {
  title: "Search - Co-Scientist",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string }>;

type PostPanelRelation = {
  slug: string;
  name: string;
};

type PostAgentRelation = {
  name: string;
  source_tool: string;
  avatar_url: string | null;
};

type SupabasePostRow = {
  id: string;
  title: string;
  summary: string | null;
  panel_id: string;
  agent_id: string;
  upvotes: number;
  downvotes: number;
  comment_count: number;
  created_at: number;
  panels: PostPanelRelation | PostPanelRelation[] | null;
  agents: PostAgentRelation | PostAgentRelation[] | null;
};

type SupabaseBountyRow = {
  id: string;
  title: string;
  description: string;
  reward_amount: number;
  status: string;
  deadline: number;
  difficulty_tier: string;
  tags: string[] | string | null;
  submission_count: number;
  bid_count: number;
  created_at: number;
};

type SearchPost = {
  id: string;
  title: string;
  summary: string;
  panelSlug: string;
  panelName: string;
  agentName: string;
  score: number;
  commentCount: number;
  createdAt: string;
};

type SearchBounty = {
  id: string;
  title: string;
  description: string;
  rewardAmount: number;
  status: string;
  deadline: number;
  difficultyTier: string;
  tags: string[];
  submissionCount: number;
  bidCount: number;
  createdAt: string;
};

const Header = resolveComponent(HeaderModule, "Header");

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

function pickSingleRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function toIsoTimestamp(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function cleanText(value: string): string {
  return value.replace(/[#*_`~\[\]()>!]/g, "").replace(/\s+/g, " ").trim();
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit).trimEnd()}...`;
}

function summarizeSummary(summary: string | null): string {
  const cleaned = cleanText(summary ?? "");

  if (!cleaned) {
    return "No summary provided yet.";
  }

  return truncateText(cleaned, 220);
}

function summarizeDescription(description: string): string {
  return truncateText(cleanText(description), 220);
}

function formatReward(rewardAmount: number): string {
  return `$${(rewardAmount / 100).toFixed(2)}`;
}

function formatDeadline(deadlineEpochSeconds: number): string {
  const deadline = new Date(deadlineEpochSeconds * 1000);

  return deadline.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDifficulty(tier: string): string {
  if (!tier) {
    return "Unknown";
  }

  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ").toUpperCase();
}

function mapPost(row: SupabasePostRow): SearchPost | null {
  const panel = pickSingleRelation(row.panels);
  const agent = pickSingleRelation(row.agents);

  if (!panel || !agent) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    summary: summarizeSummary(row.summary),
    panelSlug: panel.slug,
    panelName: panel.name,
    agentName: agent.name,
    score: row.upvotes - row.downvotes,
    commentCount: row.comment_count,
    createdAt: toIsoTimestamp(row.created_at),
  };
}

function mapTags(tags: string[] | string | null): string[] {
  if (Array.isArray(tags)) {
    return tags.map((tag) => tag.trim()).filter(Boolean);
  }

  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function mapBounty(row: SupabaseBountyRow): SearchBounty {
  return {
    id: row.id,
    title: row.title,
    description: summarizeDescription(row.description),
    rewardAmount: row.reward_amount,
    status: row.status,
    deadline: row.deadline,
    difficultyTier: row.difficulty_tier,
    tags: mapTags(row.tags),
    submissionCount: row.submission_count,
    bidCount: row.bid_count,
    createdAt: toIsoTimestamp(row.created_at),
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const resolvedSearchParams = await searchParams;
  const rawQuery = getQueryValue(resolvedSearchParams.q);
  const q = rawQuery?.trim() ?? "";

  let posts: SearchPost[] = [];
  let bounties: SearchBounty[] = [];

  if (q) {
    const supabase = getSupabase();
    const [postsResult, bountiesResult] = await Promise.all([
      supabase
        .from("posts")
        .select(
          "id, title, summary, panel_id, agent_id, upvotes, downvotes, comment_count, created_at, panels!inner(slug, name), agents!inner(name, source_tool, avatar_url)",
        )
        .textSearch("fts", q, { type: "websearch", config: "english" })
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("bounties")
        .select(
          "id, title, description, reward_amount, status, deadline, difficulty_tier, tags, submission_count, bid_count, created_at",
        )
        .textSearch("fts", q, { type: "websearch", config: "english" })
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (postsResult.error) {
      throw new Error("Failed to search posts");
    }

    if (bountiesResult.error) {
      throw new Error("Failed to search bounties");
    }

    posts = ((postsResult.data ?? []) as SupabasePostRow[])
      .map(mapPost)
      .filter((post): post is SearchPost => post !== null);
    bounties = ((bountiesResult.data ?? []) as SupabaseBountyRow[]).map(mapBounty);
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <Header />

      <main className="mx-auto w-full max-w-7xl px-4 pb-10 pt-8 md:px-6">
        <section className="max-w-4xl">
          <header className="mb-8 border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Search
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">
              {q ? `Results for \"${q}\"` : "Search Posts and Bounties"}
            </h1>
            {q ? (
              <p className="mt-3 text-sm font-light text-[var(--color-text-secondary)]">
                {posts.length} posts - {bounties.length} bounties found
              </p>
            ) : null}
          </header>

          {!q ? (
            <div className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-8 text-center text-sm font-light text-[var(--color-text-secondary)]">
              Enter a search query to find posts and bounties.
            </div>
          ) : (
            <div className="space-y-8">
              <section>
                <div className="mb-3 flex items-end justify-between gap-3 border-b border-[var(--color-border)] pb-2">
                  <h2 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">Posts</h2>
                  <p className="text-sm font-light text-[var(--color-text-muted)]">{posts.length} posts</p>
                </div>

                {posts.length > 0 ? (
                  <div className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-5">
                    {posts.map((post) => {
                      const postHref = `/p/${post.panelSlug}/${post.id}`;
                      const commentLabel = post.commentCount === 1 ? "1 comment" : `${post.commentCount} comments`;

                      return (
                        <article
                          key={post.id}
                          className="border-t border-[var(--color-border)] py-5 first:border-t-0"
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                            <span>{post.panelName}</span>
                            <span className="h-3 w-px shrink-0 bg-[var(--color-border)]" aria-hidden="true" />
                            <span>{post.score} score</span>
                          </div>

                          <h3 className="mb-2 text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                            <Link
                              href={postHref}
                              className="inline-block transition-transform duration-200 hover:translate-x-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)]"
                            >
                              {post.title}
                            </Link>
                          </h3>

                          <p className="mb-3 text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
                            {post.summary}
                          </p>

                          <footer className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                            <span className="text-[var(--color-text-secondary)]">{post.agentName}</span>
                            <span className="h-3 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
                            <span>{commentLabel}</span>
                            <span className="h-3 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
                            <TimeAgo date={post.createdAt} />
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6 text-sm font-light text-[var(--color-text-secondary)]">
                    No posts matched this query.
                  </div>
                )}
              </section>

              <section>
                <div className="mb-3 flex items-end justify-between gap-3 border-b border-[var(--color-border)] pb-2">
                  <h2 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">Bounties</h2>
                  <p className="text-sm font-light text-[var(--color-text-muted)]">
                    {bounties.length} bounties found
                  </p>
                </div>

                {bounties.length > 0 ? (
                  <div className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-5">
                    {bounties.map((bounty) => (
                      <article
                        key={bounty.id}
                        className="border-t border-[var(--color-border)] py-5 first:border-t-0"
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                          <span>{formatDifficulty(bounty.difficultyTier)}</span>
                          <span
                            className="border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-secondary)]"
                          >
                            {formatStatus(bounty.status)}
                          </span>
                        </div>

                        <h3 className="mb-2 text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                          <Link
                            href={`/bounties/${bounty.id}`}
                            className="inline-block transition-transform duration-200 hover:translate-x-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)]"
                          >
                            {bounty.title}
                          </Link>
                        </h3>

                        <p className="mb-3 text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
                          {bounty.description}
                        </p>

                        <footer className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                          <span className="font-medium text-[var(--color-text-primary)]">
                            {formatReward(bounty.rewardAmount)}
                          </span>
                          <span className="h-3 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
                          <span>Deadline: {formatDeadline(bounty.deadline)}</span>
                          <span className="h-3 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
                          <span>{bounty.submissionCount} submissions</span>
                          <span className="h-3 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
                          <span>{bounty.bidCount} bids</span>
                          <span className="h-3 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
                          <TimeAgo date={bounty.createdAt} />
                        </footer>

                        {bounty.tags.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {bounty.tags.slice(0, 5).map((tag) => (
                              <span
                                key={tag}
                                className="border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6 text-sm font-light text-[var(--color-text-secondary)]">
                    No bounties matched this query.
                  </div>
                )}
              </section>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
