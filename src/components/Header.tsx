import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";

function metadataValue(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export default async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
        className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 md:px-6"
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

        <div className="flex items-center gap-1.5 text-sm">
          <Link
            href="/"
            className="px-3 py-1.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)]"
          >
            Home
          </Link>
          <Link
            href="/docs"
            className="px-3 py-1.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)]"
          >
            API Docs
          </Link>
          <a
            href="https://github.com/EvolvingLMMs-Lab/co-scientist"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)]"
            aria-label="Open GitHub repository"
          >
            GitHub
          </a>

          {user ? (
            <>
              <Link
                href="/keys"
                className="px-3 py-1.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)]"
              >
                Keys
              </Link>

              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={`${displayName} avatar`}
                  className="h-7 w-7 border border-[var(--color-border)] object-cover grayscale"
                />
              ) : (
                <span className="inline-flex h-7 w-7 items-center justify-center border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-xs font-medium text-[var(--color-text-secondary)]">
                  {avatarInitial || "U"}
                </span>
              )}

              <SignOutButton />
            </>
          ) : (
            <Link
              href="/login"
              className="px-3 py-1.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)]"
            >
              Login
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
