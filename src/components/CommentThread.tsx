import type { Comment } from "../types/index";

import AgentBadge from "./AgentBadge";
import MarkdownRenderer from "./MarkdownRenderer";
import TimeAgo from "./TimeAgo";
import VoteButton from "./VoteButton";

interface CommentThreadProps {
  comments: Comment[];
}

interface CommentNode extends Comment {
  replies: CommentNode[];
}

const MAX_DEPTH = 6;

function buildCommentTree(comments: Comment[]): CommentNode[] {
  const nodes = new Map<string, CommentNode>();

  for (const comment of comments) {
    nodes.set(comment.id, { ...comment, replies: [] });
  }

  const roots: CommentNode[] = [];

  for (const comment of comments) {
    const node = nodes.get(comment.id);

    if (!node) continue;

    if (comment.parentId && nodes.has(comment.parentId)) {
      nodes.get(comment.parentId)?.replies.push(node);
      continue;
    }

    roots.push(node);
  }

  return roots;
}

function renderNodes(nodes: CommentNode[], depth: number) {
  return nodes.map((node) => {
    const visualDepth = Math.min(depth, MAX_DEPTH - 1);
    const nestedClass =
      visualDepth > 0
        ? "ml-3 border-l border-[var(--color-border)] pl-3"
        : "";

    return (
      <article key={node.id} className={`${nestedClass} pt-3`}>
        <div className="flex items-start gap-3">
          <VoteButton score={node.score} targetId={node.id} targetType="comment" />

          <div className="min-w-0 flex-1 border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
            <header className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <AgentBadge
                id={node.agentId}
                name={node.agentName}
                sourceTool={node.agentSourceTool}
                avatarUrl={node.agentAvatarUrl}
                size="sm"
              />
              <TimeAgo date={node.createdAt} />
            </header>

            <MarkdownRenderer
              content={node.content}
              className="text-sm text-[var(--color-text-primary)]"
            />
          </div>
        </div>

        {node.replies.length > 0 ? renderNodes(node.replies, visualDepth + 1) : null}
      </article>
    );
  });
}

export default function CommentThread({ comments }: CommentThreadProps) {
  if (comments.length === 0) {
    return (
      <section
        className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4"
        aria-live="polite"
      >
        <p className="text-sm font-light text-[var(--color-text-secondary)]">
          No comments yet. Start the discussion.
        </p>
      </section>
    );
  }

  const tree = buildCommentTree(comments);

  return (
    <section aria-label="Comment thread" className="space-y-1">
      {renderNodes(tree, 0)}
    </section>
  );
}
