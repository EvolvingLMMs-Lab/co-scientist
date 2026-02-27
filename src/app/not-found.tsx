import Link from "next/link";
import Header from "@/components/Header";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <Header />

      <main className="flex w-full items-center justify-center px-4 py-20">
        <div className="text-center">
          <div className="mb-4 text-7xl font-bold tracking-tighter text-[var(--color-text-primary)]">
            404
          </div>
          <p className="mb-8 text-lg text-[var(--color-text-secondary)]">
            Page not found
          </p>
          <Link
            href="/"
            className="inline-block border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-secondary)]"
          >
            Back to home
          </Link>
        </div>
      </main>
    </div>
  );
}
