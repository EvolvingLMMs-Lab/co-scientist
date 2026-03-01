"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import type { Bounty } from "../types/bounty";

import TimeAgo from "./TimeAgo";

interface BountyCardProps {
  bounty: Bounty;
  publisherTier?: string | null;
}

function difficultyLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function deadlineLabel(deadline: string, isExpired: boolean, mounted: boolean): string {
  if (isExpired) {
    return "Expired";
  }

  if (!mounted) {
    // Server: use deterministic UTC formatting (no Intl API) to avoid hydration mismatch
    const d = new Date(deadline);
    if (Number.isNaN(d.getTime())) return "Unknown";
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }

  const diff = new Date(deadline).getTime() - Date.now();

  if (diff < 0) {
    return "Expired";
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d left`;
  }

  if (hours > 0) {
    return `${hours}h left`;
  }

  return "<1h left";
}

function publisherTierLabel(tier: string | null | undefined): string {
  if (tier === "excellent") return "Excellent Publisher";
  if (tier === "fair") return "Fair Publisher";
  if (tier === "poor") return "Poor Publisher";
  if (tier === "untrusted") return "Untrusted Publisher";
  return "Good Publisher";
}

export default function BountyCard({ bounty, publisherTier }: BountyCardProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const excerpt =
    bounty.description.length > 200
      ? `${bounty.description.replace(/[#*_`~\[\]()>!]/g, "").replace(/\s+/g, " ").trim().slice(0, 200).trimEnd()}...`
      : bounty.description.replace(/[#*_`~\[\]()>!]/g, "").replace(/\s+/g, " ").trim();

  const deadline = deadlineLabel(bounty.deadline, bounty.isExpired, mounted);
  const isOpen = bounty.status === "open";

  return (
    <article className="group border-t border-[var(--color-border)] pb-6 pt-6 transition-colors hover:border-[var(--color-border-hover)]">
      <div className="flex items-start gap-4">
        {/* Reward amount */}
        <div className="flex w-20 shrink-0 flex-col items-center border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-3">
          <span className="text-lg font-bold text-[var(--color-text-primary)]">
            {bounty.rewardDisplay}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
            Bounty
          </span>
        </div>

        <div className="min-w-0 flex-1">
          {/* Meta row */}
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
            {bounty.panelName ? (
              <span className="font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                {bounty.panelName}
              </span>
            ) : null}
            <span className="font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              {difficultyLabel(bounty.difficultyTier)}
            </span>
            <span
              className={[
                "font-medium uppercase tracking-wider",
                isOpen
                  ? "text-[var(--color-text-secondary)]"
                  : "text-[var(--color-text-muted)]",
              ].join(" ")}
            >
              {bounty.status}
            </span>
          </div>

          {/* Title */}
          <h3 className="mb-2 text-xl font-bold leading-tight text-[var(--color-text-primary)] md:text-2xl">
            <Link
              href={`/bounties/${bounty.id}`}
              className="inline-block underline-offset-2 transition-transform duration-200 group-hover:translate-x-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)]"
            >
              {bounty.title}
            </Link>
          </h3>

          {/* Excerpt */}
          <p className="mb-3 text-base font-light leading-relaxed text-[var(--color-text-secondary)]">
            {excerpt}
          </p>

          {/* Footer */}
          <footer className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <span suppressHydrationWarning>{deadline}</span>
            <span className="h-3 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
            <span>
              {bounty.submissionCount}/{bounty.maxSubmissions} submissions
            </span>
            <span className="h-3 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
            <span>{publisherTierLabel(publisherTier)}</span>
            {bounty.tags.length > 0 ? (
              <>
                <span className="h-3 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
                <span className="flex gap-1">
                  {bounty.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider"
                    >
                      {tag}
                    </span>
                  ))}
                </span>
              </>
            ) : null}
            <span className="h-3 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
            <TimeAgo date={bounty.createdAt} />
          </footer>
        </div>
      </div>
    </article>
  );
}
