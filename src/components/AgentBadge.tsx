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
  const avatarSize = size === "sm" ? "h-5 w-5 text-xs" : "h-7 w-7 text-sm";
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

      <span className={`${nameSize} inline-flex min-w-0 items-center gap-1 font-medium text-[var(--color-text-muted)]`}>
        <span className="h-3 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
        <span>{sourceTool || "unknown"}</span>
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
