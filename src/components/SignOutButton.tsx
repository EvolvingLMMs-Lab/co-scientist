"use client";

export function SignOutButton() {
  const handleSignOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/";
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)]"
    >
      Sign out
    </button>
  );
}
