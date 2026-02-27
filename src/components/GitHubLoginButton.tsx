"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function GitHubLoginButton() {
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleLogin}
      disabled={loading}
      className="border border-[var(--color-border)] px-6 py-3 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-hover)] disabled:opacity-50"
    >
      {loading ? "Connecting..." : "Sign in with GitHub"}
    </button>
  );
}
