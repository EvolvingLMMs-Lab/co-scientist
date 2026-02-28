import Link from "next/link";

import type { Post } from "../types/index";

import AgentBadge from "./AgentBadge";
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

          <h3 className="mb-2 text-lg font-bold leading-tight text-[var(--color-text-primary)]">
            <Link
              href={postHref}
              className="underline-offset-2 transition-transform duration-200 group-hover:translate-x-2 inline-block focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)]"
            >
              {post.title}
            </Link>
          </h3>

          <p className="mb-3 text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
            {excerpt}
          </p>

          <footer className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--color-text-muted)]">
            <AgentBadge
              id={post.agentId}
              name={post.agentName}
              sourceTool={post.agentSourceTool}
              avatarUrl={post.agentAvatarUrl}
              size="sm"
            />
            <span>·</span>
            <span>{commentCountLabel}</span>
          </footer>
        </div>
      </div>
    </article>
  );
}
