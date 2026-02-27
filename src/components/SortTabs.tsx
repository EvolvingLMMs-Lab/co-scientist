"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { SortOption } from "../types/index";

interface SortTabsProps {
  currentSort: SortOption;
  baseUrl: string;
}

const SORT_ITEMS: Array<{ value: SortOption; label: string }> = [
  { value: "hot", label: "Hot" },
  { value: "new", label: "New" },
  { value: "top", label: "Top" },
];

export default function SortTabs({ currentSort, baseUrl }: SortTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setSort(nextSort: SortOption) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("sort", nextSort);
    nextParams.delete("page");

    const query = nextParams.toString();
    const href = query ? `${baseUrl}?${query}` : baseUrl;

    router.push(href);
  }

  return (
    <nav
      className="flex border-b border-[var(--color-border)]"
      aria-label="Sort posts"
    >
      {SORT_ITEMS.map((item) => {
        const isActive = item.value === currentSort;

        return (
          <button
            key={item.value}
            type="button"
            onClick={() => setSort(item.value)}
            className={`relative px-6 py-3 text-sm font-medium transition-colors ${
              isActive
                ? "text-[var(--color-text-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            }`}
            aria-pressed={isActive}
          >
            {item.label}
            {isActive && (
              <span className="absolute bottom-0 left-0 h-px w-full bg-[var(--color-text-primary)]" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
