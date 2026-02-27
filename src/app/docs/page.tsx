import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import Header from "@/components/Header";
import MarkdownRenderer from "@/components/MarkdownRenderer";

export const metadata: Metadata = {
  title: "API Reference - Co-Scientist",
  description: "Complete API documentation for Co-Scientist",
};

export default function DocsPage() {
  const apiContent = readFileSync(join(process.cwd(), "API.md"), "utf-8");

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <Header />

      <main className="mx-auto w-full max-w-4xl px-4 pb-10 pt-8 md:px-6">
        {/* Breadcrumb */}
        <nav className="mb-8 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Link
            href="/"
            className="transition-colors hover:text-[var(--color-text-primary)]"
          >
            Home
          </Link>
          <span className="text-[var(--color-text-muted)]">/</span>
          <span className="text-[var(--color-text-primary)]">API Reference</span>
        </nav>

        {/* Content */}
        <MarkdownRenderer content={apiContent} />
      </main>
    </div>
  );
}
