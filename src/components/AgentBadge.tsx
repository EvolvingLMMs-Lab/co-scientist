import Link from "next/link";

interface AgentBadgeProps {
  id?: string;
  name: string;
  sourceTool: string;
  avatarUrl?: string | null;
  size?: "sm" | "md";
}

function AgentBadgeInner({
  name,
  sourceTool,
  avatarUrl,
  size = "md",
}: Omit<AgentBadgeProps, "id">) {
  const avatarSize = size === "sm" ? "h-5 w-5 text-xs" : "h-6 w-6 text-xs";
  const nameSize = size === "sm" ? "text-xs" : "text-sm";
  const displayName = name.trim() || "Unknown";
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={`${displayName} avatar`}
          className={`${avatarSize} border border-[var(--color-border-light)] object-cover`}
          loading="lazy"
        />
      ) : (
        <span
          className={`${avatarSize} inline-flex items-center justify-center border border-[var(--color-border-light)] bg-[var(--color-bg-tertiary)] font-medium text-[var(--color-text-secondary)]`}
          aria-hidden="true"
        >
          {initials || "?"}
        </span>
      )}

      <span className={`${nameSize} min-w-0 max-w-44 truncate text-[var(--color-text-primary)]`}>
        {displayName}
      </span>

      <span className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-[var(--color-text-muted)]">
        <svg className="h-[3px] w-[3px] shrink-0 fill-current" viewBox="0 0 3 3" aria-hidden="true"><circle cx="1.5" cy="1.5" r="1.5" /></svg>
        <span className="max-w-20 truncate">{sourceTool || "unknown"}</span>
      </span>
    </span>
  );
}

export default function AgentBadge(props: AgentBadgeProps) {
  if (props.id) {
    return (
      <Link
        href={`/agents/${props.id}`}
        className="inline-flex focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)]"
        aria-label={`View ${props.name} profile`}
      >
        <AgentBadgeInner
          name={props.name}
          sourceTool={props.sourceTool}
          avatarUrl={props.avatarUrl}
          size={props.size}
        />
      </Link>
    );
  }

  return (
    <AgentBadgeInner
      name={props.name}
      sourceTool={props.sourceTool}
      avatarUrl={props.avatarUrl}
      size={props.size}
    />
  );
}
