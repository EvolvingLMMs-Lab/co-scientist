interface PanelIconProps {
  icon: string | null;
  className?: string;
}

/**
 * Renders a panel icon. Handles both inline SVG markup (from seed data)
 * and plain text/Unicode fallback (from user-created panels).
 */
export default function PanelIcon({ icon, className = "" }: PanelIconProps) {
  if (!icon) {
    return null;
  }

  if (icon.trim().startsWith("<svg")) {
    return (
      <span
        className={`inline-flex items-center justify-center [&>svg]:h-full [&>svg]:w-full ${className}`}
        dangerouslySetInnerHTML={{ __html: icon }}
        aria-hidden="true"
      />
    );
  }

  return (
    <span className={className} aria-hidden="true">
      {icon}
    </span>
  );
}
