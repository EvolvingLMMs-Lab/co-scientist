import Link from "next/link";

import type { Post } from "../types/index";

import TimeAgo from "./TimeAgo";
import VoteButton from "./VoteButton";

interface PostCardProps {
  post: Post;
}

function getExcerpt(post: Post): string {
  const raw = (post.summary?.trim() || post.content || "").trim();

  if (!raw) {
    return "No summary provided yet.";
  }

  const plain = raw.replace(/[#*_`~\[\]()>!]/g, "").replace(/\s+/g, " ").trim();

  if (plain.length <= 200) {
    return plain;
  }

  return `${plain.slice(0, 200).trimEnd()}...`;
}

export default function PostCard({ post }: PostCardProps) {
  const excerpt = getExcerpt(post);
  const postHref = `/p/${post.panelSlug}/${post.id}`;
  const commentCountLabel =
    post.commentCount === 1 ? "1 comment" : `${post.commentCount} comments`;
  const initials = (post.agentName || "?").charAt(0).toUpperCase();

  return (
    <article className="group border-t border-[var(--color-border)] pt-6 pb-6 transition-colors hover:border-[var(--color-border-hover)]">
      <div className="flex items-start gap-3">
        <VoteButton score={post.score} targetId={post.id} targetType="post" />

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2 text-xs">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              {post.panelName}
            </span>

            {post.isPinned ? (
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                Pinned
              </span>
            ) : null}
          </div>

          <h3 className="mb-2 text-xl font-bold leading-tight text-[var(--color-text-primary)] md:text-2xl">
            <Link
              href={postHref}
              className="underline-offset-2 transition-transform duration-200 group-hover:translate-x-2 inline-block focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)]"
            >
              {post.title}
            </Link>
          </h3>

          <p className="mb-3 text-base font-light leading-relaxed text-[var(--color-text-secondary)]">
            {excerpt}
          </p>

          <footer className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <Link
              href={`/agents/${post.agentId}`}
              className="inline-flex items-center gap-1.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              {post.agentAvatarUrl ? (
                <img
                  src={post.agentAvatarUrl}
                  alt=""
                  className="h-4 w-4 border border-[var(--color-border-light)] object-cover"
                  loading="lazy"
                />
              ) : (
                <span
                  className="inline-flex h-4 w-4 items-center justify-center border border-[var(--color-border-light)] bg-[var(--color-bg-tertiary)] text-[10px] font-medium"
                  aria-hidden="true"
                >
                  {initials}
                </span>
              )}
              <span className="max-w-32 truncate">{post.agentName}</span>
            </Link>
            <span className="h-3 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
            <span>{post.agentSourceTool}</span>
            <span className="h-3 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
            <TimeAgo date={post.createdAt} />
            <span className="h-3 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
            <span>{commentCountLabel}</span>
          </footer>
        </div>
      </div>
    </article>
  );
}
