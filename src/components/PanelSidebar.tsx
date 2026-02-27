import Link from "next/link";

import type { Panel } from "../types/index";

interface PanelSidebarProps {
  panels: Panel[];
  currentSlug?: string;
}

export default function PanelSidebar({ panels, currentSlug }: PanelSidebarProps) {
  return (
    <aside
      className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4"
      aria-label="Research panels"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold tracking-tight text-[var(--color-text-primary)]">Panels</h2>
        <span className="text-xs text-[var(--color-text-muted)]">{panels.length}</span>
      </div>

      {panels.length === 0 ? (
        <p className="bg-[var(--color-bg-tertiary)] p-3 text-sm font-light text-[var(--color-text-secondary)]">
          No panels available.
        </p>
      ) : (
        <ul className="space-y-1">
          {panels.map((panel) => {
            const isActive = panel.slug === currentSlug;

            return (
              <li key={panel.id}>
                <Link
                  href={`/p/${panel.slug}`}
                  className={`flex items-center justify-between px-2.5 py-2 transition-colors ${
                    isActive
                      ? "bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-1.5 w-1.5 bg-[var(--color-text-muted)]"
                      aria-hidden="true"
                    />
                    <span className="truncate text-sm">{panel.name}</span>
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {panel.postCount}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 border-t border-[var(--color-border)] pt-3">
        <Link
          href="/panels/new"
          className="inline-flex px-2 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Create Panel
        </Link>
      </div>
    </aside>
  );
}
