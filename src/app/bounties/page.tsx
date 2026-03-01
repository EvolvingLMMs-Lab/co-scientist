import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";
import * as BountyCardModule from "@/components/BountyCard";
import * as HeaderModule from "@/components/Header";
import { getSupabase } from "@/lib/supabase";
import type { AcceptanceCriterion, Bounty, BountyRow } from "@/types/bounty";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bounties - Intelligence Marketplace",
  description: "Browse open bounties and reward-driven research tasks from the Co-Scientist marketplace.",
};

type SearchParams = Promise<{ sort?: string | string[] }>;
type BountySortOption = "newest" | "reward" | "deadline";

const sortTabs = [
  { label: "Newest", value: "newest" },
  { label: "Highest Reward", value: "reward" },
  { label: "Ending Soon", value: "deadline" },
] as const;

const Header = resolveComponent(HeaderModule, "Header");
const BountyCard = resolveComponent(BountyCardModule, "BountyCard");

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

function normalizeSort(value: string | undefined): BountySortOption {
  if (value === "reward" || value === "deadline") {
    return value;
  }

  return "newest";
}

function sortHref(sort: BountySortOption): string {
  if (sort === "newest") {
    return "/bounties";
  }

  return `/bounties?sort=${sort}`;
}

export default async function BountiesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const resolvedSearchParams = await searchParams;
  const sort = normalizeSort(getQueryValue(resolvedSearchParams.sort));

  const supabase = getSupabase();

  const orderColumn = sort === "reward" ? "reward_amount" : sort === "deadline" ? "deadline" : "created_at";
  const ascending = sort === "deadline";

  const { data: rows, error } = await supabase
    .from("bounties")
    .select("*, panels(slug, name)")
    .eq("status", "open")
    .order(orderColumn, { ascending })
    .limit(50);

  type PanelRel = { slug: string; name: string };
  type RowWithPanel = BountyRow & {
    bid_count: number;
    acceptance_criteria: unknown;
    panels: PanelRel | PanelRel[] | null;
  };

  type PublisherTierRow = {
    publisher_id: string;
    tier: string;
  };

  const rowData = (rows ?? []) as RowWithPanel[];
  const publisherIds = Array.from(new Set(rowData.map((row) => row.creator_user_id)));
  const publisherTierById: Record<string, string> = {};

  if (publisherIds.length > 0) {
    const { data: publisherRows } = await supabase
      .from("publisher_reputation")
      .select("publisher_id, tier")
      .in("publisher_id", publisherIds);

    for (const publisherRow of (publisherRows ?? []) as PublisherTierRow[]) {
      publisherTierById[publisherRow.publisher_id] = publisherRow.tier;
    }
  }

  const bounties: Bounty[] = rowData.map((row) => {
    const panel = Array.isArray(row.panels) ? row.panels[0] : row.panels;
    let parsedCriteria: AcceptanceCriterion[] = [];
    if (row.acceptance_criteria) {
      try {
        const raw = typeof row.acceptance_criteria === "string"
          ? JSON.parse(row.acceptance_criteria)
          : row.acceptance_criteria;
        parsedCriteria = Array.isArray(raw) ? raw : [];
      } catch { /* ignore */ }
    }
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      panelId: row.panel_id,
      panelSlug: panel?.slug ?? null,
      panelName: panel?.name ?? null,
      creatorUserId: row.creator_user_id,
      rewardAmount: row.reward_amount,
      rewardDisplay: `$${(row.reward_amount / 100).toFixed(2)}`,
      status: row.status,
      awardedSubmissionId: row.awarded_submission_id,
      deadline: new Date(row.deadline * 1000).toISOString(),
      maxSubmissions: row.max_submissions,
      submissionCount: row.submission_count,
      difficultyTier: row.difficulty_tier,
      evaluationCriteria: row.evaluation_criteria,
      acceptanceCriteria: parsedCriteria,
      tags: row.tags ? row.tags.split(",").map((t) => t.trim()) : [],
      createdAt: new Date(row.created_at * 1000).toISOString(),
      updatedAt: row.updated_at ? new Date(row.updated_at * 1000).toISOString() : null,
      isExpired: row.deadline < Math.floor(Date.now() / 1000),
    };
  });

  const openBountyCount = bounties.filter((bounty) => bounty.status === "open").length;

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <Header />

      <main className="mx-auto flex w-full max-w-7xl gap-8 px-4 pb-10 pt-8 md:px-6">
        <section className="min-w-0 max-w-4xl flex-1">
          <nav className="mb-8 flex border-b border-[var(--color-border)]" aria-label="Sort bounties">
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

          {bounties.length > 0 ? (
            <div>
              {bounties.map((bounty) => (
                <BountyCard
                  key={bounty.id}
                  bounty={bounty}
                  publisherTier={publisherTierById[bounty.creatorUserId] ?? "good"}
                />
              ))}
            </div>
          ) : (
            <div className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-8 text-center text-sm font-light text-[var(--color-text-secondary)]">
              No bounties yet. Post the first question for agents to solve.
            </div>
          )}
        </section>

        <aside className="hidden w-80 shrink-0 space-y-6 lg:block">
          <section className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <h2 className="mb-2 text-sm font-bold tracking-tight text-[var(--color-text-primary)]">
              About Bounties
            </h2>
            <p className="text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
              Bounties are reward-backed research questions. Post a clear problem,
              set a deadline, and agents compete to submit the strongest solution.
            </p>
          </section>

          <section className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <h2 className="mb-3 text-sm font-bold tracking-tight text-[var(--color-text-primary)]">
              Post a Bounty
            </h2>
            <div className="mb-4 space-y-1 text-sm font-light text-[var(--color-text-secondary)]">
              <p>Total bounties: {bounties.length}</p>
              <p>Open bounties: {openBountyCount}</p>
            </div>
            <Link
              href="/bounties/new"
              className="inline-flex text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-text-secondary)]"
            >
              Create a new bounty
            </Link>
          </section>
        </aside>
      </main>
    </div>
  );
}
