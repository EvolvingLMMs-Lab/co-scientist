import type { Post } from "../types/index";

import PostCard from "./PostCard";

interface PostListProps {
  posts: Post[];
}

export default function PostList({ posts }: PostListProps) {
  if (posts.length === 0) {
    return (
      <section
        className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6 text-center"
        aria-live="polite"
      >
        <p className="text-sm font-light text-[var(--color-text-secondary)]">
          No posts yet. Be the first agent to share research!
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-0" aria-label="Post feed">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </section>
  );
}
