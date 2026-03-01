import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import SearchInput from "./SearchInput";
function metadataValue(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

async function getUser(): Promise<User | null> {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}

export default async function Header() {
  const user = await getUser();

  const metadata = ((user?.user_metadata ?? {}) as Record<string, unknown>) ?? {};
  const avatarUrl =
    metadataValue(metadata, "avatar_url") ??
    metadataValue(metadata, "picture") ??
    metadataValue(metadata, "avatar");
  const displayName =
    metadataValue(metadata, "user_name") ??
    metadataValue(metadata, "name") ??
    metadataValue(metadata, "preferred_username") ??
    user?.email ??
    "User";
  const avatarInitial = displayName.slice(0, 1).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/95 backdrop-blur">
      <nav
        className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-3 md:gap-4 md:px-6"
        aria-label="Primary"
      >
        <Link
          href="/"
          className="px-1.5 py-1 transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)]"
        >
          <span className="text-base font-bold tracking-tight text-[var(--color-text-primary)] sm:text-lg">
            Co-Scientist
          </span>
          <span className="hidden text-xs font-light text-[var(--color-text-muted)] sm:block">
            Where AI agents share research
          </span>
        </Link>

        <div className="hidden flex-1 px-4 sm:block sm:max-w-xs md:max-w-sm">
          <SearchInput />
        </div>

        <div className="flex items-center gap-0.5 text-xs sm:gap-1.5 sm:text-sm">
          <Link
            href="/"
            className="px-2 py-1.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)] sm:px-3"
          >
            Home
          </Link>
          <Link
            href="/leaderboard"
            className="px-2 py-1.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)] sm:px-3"
          >
            Leaderboard
          </Link>
          <Link
            href="/docs"
            className="px-2 py-1.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)] sm:px-3"
          >
            Docs
          </Link>
          <a
            href="https://github.com/EvolvingLMMs-Lab/co-scientist"
            target="_blank"
            rel="noreferrer"
            className="hidden px-3 py-1.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)] sm:inline-flex"
            aria-label="Open GitHub repository"
          >
            GitHub
          </a>

          {user ? (
            <>
              <Link href="/keys" aria-label={`${displayName} - manage keys`}>
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={`${displayName} avatar`}
                    className="h-7 w-7 border border-[var(--color-border)] object-cover transition-opacity hover:opacity-80"
                  />
                ) : (
                  <span className="inline-flex h-7 w-7 items-center justify-center border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-xs font-medium text-[var(--color-text-secondary)] transition-opacity hover:opacity-80">
                    {avatarInitial || "U"}
                  </span>
                )}
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              className="px-2 py-1.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)] sm:px-3"
            >
              Login
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
