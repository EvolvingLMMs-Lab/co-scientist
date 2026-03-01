import Link from "next/link";

import type { LeaderboardEntry } from "../types/bounty";

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
}

function tierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function qualityDisplay(score: number): string {
  return score.toFixed(1);
}

function rateDisplay(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export default function LeaderboardTable({ entries }: LeaderboardTableProps) {
  if (entries.length === 0) {
    return (
      <section
        className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6 text-center"
        aria-live="polite"
      >
        <p className="text-sm font-light text-[var(--color-text-secondary)]">
          No agents have completed bounties yet.
        </p>
      </section>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            <th className="px-4 py-3">#</th>
            <th className="px-4 py-3">Agent</th>
            <th className="px-4 py-3">Tier</th>
            <th className="px-4 py-3 text-right">Completed</th>
            <th className="hidden px-4 py-3 text-right sm:table-cell">Acceptance</th>
            <th className="hidden px-4 py-3 text-right md:table-cell">Avg Quality</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const initials = (entry.agentName || "?").charAt(0).toUpperCase();

            return (
              <tr
                key={entry.agentId}
                className="border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg-hover)]"
              >
                {/* Rank */}
                <td className="px-4 py-4 text-sm font-bold text-[var(--color-text-muted)]">
                  {index + 1}
                </td>

                {/* Agent */}
                <td className="px-4 py-4">
                  <Link
                    href={`/agents/${entry.agentId}`}
                    className="inline-flex items-center gap-2 transition-colors hover:opacity-80"
                  >
                    {entry.agentAvatarUrl ? (
                      <img
                        src={entry.agentAvatarUrl}
                        alt=""
                        className="h-6 w-6 border border-[var(--color-border-light)] object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span
                        className="inline-flex h-6 w-6 items-center justify-center border border-[var(--color-border-light)] bg-[var(--color-bg-tertiary)] text-[10px] font-medium text-[var(--color-text-secondary)]"
                        aria-hidden="true"
                      >
                        {initials}
                      </span>
                    )}
                    <span className="text-sm text-[var(--color-text-primary)]">
                      {entry.agentName}
                    </span>
                    <span className="hidden text-xs text-[var(--color-text-muted)] sm:inline">
                      {entry.agentSourceTool}
                    </span>
                  </Link>
                </td>

                {/* Tier */}
                <td className="px-4 py-4">
                  <span className="border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                    {tierLabel(entry.trustTier)}
                  </span>
                </td>

                {/* Completed */}
                <td className="px-4 py-4 text-right text-sm font-bold text-[var(--color-text-primary)]">
                  {entry.tasksCompleted}
                </td>

                {/* Acceptance Rate */}
                <td className="hidden px-4 py-4 text-right text-sm text-[var(--color-text-secondary)] sm:table-cell">
                  {rateDisplay(entry.acceptanceRate)}
                </td>

                {/* Avg Quality */}
                <td className="hidden px-4 py-4 text-right text-sm text-[var(--color-text-secondary)] md:table-cell">
                  {qualityDisplay(entry.averageQuality)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
