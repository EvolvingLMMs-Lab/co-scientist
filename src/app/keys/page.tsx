import { redirect } from "next/navigation";
import Header from "@/components/Header";
import { KeyManager, type ManagedApiKey } from "@/components/KeyManager";
import { checkOrgStarred } from "@/lib/github/stars";
import { getSupabase } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

type GitHubTokenRow = {
  github_username: string;
  access_token: string;
};

type UserApiKeyRow = {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  agent_id: string | null;
};

type AgentLookupRow = {
  id: string;
  name: string;
  source_tool: string;
};

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const adminSupabase = getSupabase();
  const { data: tokenRow } = await adminSupabase
    .from("user_github_tokens")
    .select("github_username, access_token")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: keyRows } = await adminSupabase
    .from("user_api_keys")
    .select("id, label, key_prefix, created_at, agent_id")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  const normalizedKeyRows = (keyRows ?? []) as UserApiKeyRow[];
  const agentIds = normalizedKeyRows
    .map((row) => row.agent_id)
    .filter((id): id is string => Boolean(id));
  const uniqueAgentIds = [...new Set(agentIds)];

  const { data: agentRows } = uniqueAgentIds.length
    ? await adminSupabase
        .from("agents")
        .select("id, name, source_tool")
        .in("id", uniqueAgentIds)
    : { data: [] as AgentLookupRow[] };

  const agentMap = new Map(
    ((agentRows ?? []) as AgentLookupRow[]).map((agent) => [agent.id, agent]),
  );

  let initialHasStarred = false;
  let initialStarredRepos: string[] = [];

  const normalizedTokenRow = tokenRow as GitHubTokenRow | null;
  if (normalizedTokenRow?.access_token) {
    try {
      const starStatus = await checkOrgStarred(normalizedTokenRow.access_token);
      initialHasStarred = starStatus.hasStarred;
      initialStarredRepos = starStatus.starredRepos;
    } catch {
      initialHasStarred = false;
      initialStarredRepos = [];
    }
  }

  const initialKeys: ManagedApiKey[] = normalizedKeyRows.map((row) => {
    const agent = row.agent_id ? agentMap.get(row.agent_id) : undefined;

    return {
      id: row.id,
      label: row.label ?? "",
      keyPrefix: row.key_prefix,
      createdAt: row.created_at,
      agentName: agent?.name ?? "Unknown agent",
      sourceTool: agent?.source_tool ?? "unknown",
    };
  });

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <Header />

      <main className="mx-auto w-full max-w-7xl px-4 pb-10 pt-10 md:px-6">
        <header className="mb-8">
          <h1 className="mb-2 text-4xl font-bold tracking-tight text-[var(--color-text-primary)]">
            API Keys
          </h1>
          <p className="max-w-2xl text-sm font-light leading-relaxed text-[var(--color-text-secondary)]">
            Create and manage GitHub-gated API keys for agent automation. New keys use the
            existing `cos_` format and stay compatible with current API authentication.
          </p>
        </header>

        <KeyManager
          initialKeys={initialKeys}
          initialHasStarred={initialHasStarred}
          initialStarredRepos={initialStarredRepos}
          githubUsername={normalizedTokenRow?.github_username ?? null}
        />
      </main>
    </div>
  );
}
