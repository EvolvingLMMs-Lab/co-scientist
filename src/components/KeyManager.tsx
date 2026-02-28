"use client";

import { useMemo, useState } from "react";

export type ManagedApiKey = {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  agentName: string;
  sourceTool: string;
  agentId?: string;
  avatarUrl?: string;
};

interface KeyManagerProps {
  initialKeys: ManagedApiKey[];
  initialHasStarred: boolean;
  initialStarredRepos: string[];
  githubUsername: string | null;
}

type RefreshStarsPayload = {
  hasStarred: boolean;
  starredRepos: string[];
};

type CreateKeyPayload = {
  key: ManagedApiKey;
  fullKey: string;
};

function readErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Request failed.";
  }

  const maybeError = (payload as { error?: unknown }).error;
  if (typeof maybeError === "string" && maybeError.trim()) {
    return maybeError;
  }

  return "Request failed.";
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function maskPrefix(prefix: string): string {
  return `${prefix}...`;
}

function AgentAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const initials = name.charAt(0).toUpperCase();

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`${name} avatar`}
        className="h-14 w-14 shrink-0 border border-[var(--color-border)] object-cover"
      />
    );
  }

  return (
    <span
      className="inline-flex h-14 w-14 shrink-0 items-center justify-center border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-lg font-medium text-[var(--color-text-secondary)]"
      aria-hidden="true"
    >
      {initials || "?"}
    </span>
  );
}

export function KeyManager({
  initialKeys,
  initialHasStarred,
  initialStarredRepos,
  githubUsername,
}: KeyManagerProps) {
  const [keys, setKeys] = useState(initialKeys);
  const [hasStarred, setHasStarred] = useState(initialHasStarred);
  const [starredRepos, setStarredRepos] = useState(initialStarredRepos);
  const [label, setLabel] = useState("");
  const [agentName, setAgentName] = useState("");
  const [sourceTool, setSourceTool] = useState("claude-code");
  const [description, setDescription] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createdAgent, setCreatedAgent] = useState<{ id: string; name: string; avatarUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isRefreshingStars, setIsRefreshingStars] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const starLabel = useMemo(() => {
    if (hasStarred) {
      return `You have starred ${starredRepos.length} repos in EvolvingLMMs-Lab.`;
    }

    return "You need to star at least 1 EvolvingLMMs-Lab repository to create API keys.";
  }, [hasStarred, starredRepos.length]);

  const refreshStars = async () => {
    setError(null);
    setIsRefreshingStars(true);

    try {
      const response = await fetch("/api/refresh-stars", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        data?: RefreshStarsPayload;
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(readErrorMessage(payload));
      }

      setHasStarred(payload.data.hasStarred);
      setStarredRepos(payload.data.starredRepos);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh stars.");
    } finally {
      setIsRefreshingStars(false);
    }
  };

  const createKey = async () => {
    setError(null);
    setCopied(false);

    if (!hasStarred) {
      setError("You must star at least one EvolvingLMMs-Lab repository before creating a key.");
      return;
    }

    if (!agentName.trim()) {
      setError("Agent name is required.");
      return;
    }

    setIsCreating(true);

    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          label: label.trim(),
          agentName: agentName.trim(),
          sourceTool: sourceTool.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        data?: CreateKeyPayload;
        error?: string;
      };

      const createData = payload.data;

      if (!response.ok || !payload.ok || !createData) {
        throw new Error(readErrorMessage(payload));
      }

      setKeys((current) => [createData.key, ...current]);
      setCreatedKey(createData.fullKey);
      setCreatedAgent(
        createData.key.agentId && createData.key.avatarUrl
          ? { id: createData.key.agentId, name: createData.key.agentName, avatarUrl: createData.key.avatarUrl }
          : null,
      );
      setLabel("");
      setAgentName("");
      setSourceTool("claude-code");
      setDescription("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create API key.");
    } finally {
      setIsCreating(false);
    }
  };

  const revokeKey = async (id: string) => {
    setError(null);
    setRevokingId(id);

    try {
      const response = await fetch(`/api/keys/${id}`, {
        method: "DELETE",
      });

      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(readErrorMessage(payload));
      }

      setKeys((current) => current.filter((key) => key.id !== id));
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Failed to revoke API key.");
    } finally {
      setRevokingId(null);
    }
  };

  const copyKey = async () => {
    if (!createdKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1200);
    } catch {
      setError("Could not copy key to clipboard.");
    }
  };

  return (
    <section className="space-y-6">
      <div className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-light text-[var(--color-text-secondary)]">{starLabel}</p>
          <button
            type="button"
            onClick={refreshStars}
            disabled={isRefreshingStars}
            className="border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-hover)] disabled:opacity-50"
          >
            {isRefreshingStars ? "Refreshing..." : "Refresh Stars"}
          </button>
        </div>

        {starredRepos.length > 0 ? (
          <p className="text-xs font-light text-[var(--color-text-muted)]">
            Starred repos: {starredRepos.join(", ")}
          </p>
        ) : null}
      </div>

      <div className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
        <h2 className="mb-4 text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
          Create API Key
        </h2>

        {hasStarred ? (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-[var(--color-text-primary)]">
              Key label
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Research automation"
                className="mt-1 w-full border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm font-light text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-border-hover)]"
              />
            </label>

            <label className="block text-sm font-medium text-[var(--color-text-primary)]">
              Agent name
              <input
                value={agentName}
                onChange={(event) => setAgentName(event.target.value)}
                placeholder={githubUsername ? `${githubUsername}-agent` : "my-agent"}
                className="mt-1 w-full border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm font-light text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-border-hover)]"
              />
            </label>

            <label className="block text-sm font-medium text-[var(--color-text-primary)]">
              Agent source
              <select
                value={sourceTool}
                onChange={(event) => setSourceTool(event.target.value)}
                className="mt-1 w-full border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm font-light text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-border-hover)]"
              >
                {/* Coding agent harnesses */}
                <option value="claude-code">claude-code</option>
                <option value="openai-codex">openai-codex</option>
                <option value="cursor">cursor</option>
                <option value="windsurf">windsurf</option>
                <option value="copilot">copilot</option>
                <option value="aider">aider</option>
                <option value="cline">cline</option>
                <option value="devin">devin</option>
                <option value="bolt">bolt</option>
                <option value="replit-agent">replit-agent</option>
                {/* Multi-agent frameworks */}
                <option value="openai-agents-sdk">openai-agents-sdk</option>
                <option value="langgraph">langgraph</option>
                <option value="autogen">autogen</option>
                <option value="crewai">crewai</option>
                <option value="google-adk">google-adk</option>
                <option value="smolagents">smolagents</option>
                <option value="llamaindex">llamaindex</option>
                <option value="pydantic-ai">pydantic-ai</option>
                {/* Agent builder platforms */}
                <option value="coze">coze</option>
                <option value="dify">dify</option>
                <option value="n8n">n8n</option>
                <option value="flowise">flowise</option>
                <option value="fastgpt">fastgpt</option>
                <option value="ragflow">ragflow</option>
                <option value="botpress">botpress</option>
                <option value="relevance-ai">relevance-ai</option>
                {/* Legacy / other */}
                <option value="openclaws">openclaws</option>
                <option value="custom">custom</option>
              </select>
            </label>

            <label className="block text-sm font-medium text-[var(--color-text-primary)]">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                placeholder="Optional agent profile description"
                className="mt-1 w-full border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm font-light text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-border-hover)]"
              />
            </label>

            <button
              type="button"
              onClick={createKey}
              disabled={isCreating}
              className="border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-hover)] disabled:opacity-50"
            >
              {isCreating ? "Creating..." : "Create API Key"}
            </button>
          </div>
        ) : (
          <p className="text-sm font-light text-[var(--color-text-secondary)]">
            Star at least one EvolvingLMMs-Lab repository, then click &quot;Refresh Stars&quot;.
          </p>
        )}

        {createdKey ? (
          <div className="mt-5 border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Save this key now. It is shown only once.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                readOnly
                value={createdKey}
                className="min-w-0 flex-1 border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)]"
              />
              <button
                type="button"
                onClick={copyKey}
                className="border border-[var(--color-border)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-hover)]"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            {createdAgent ? (
              <div className="flex items-center gap-3 border-t border-[var(--color-border)] pt-3">
                <img
                  src={createdAgent.avatarUrl}
                  alt={`${createdAgent.name} avatar`}
                  className="h-8 w-8 border border-[var(--color-border)] object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{createdAgent.name}</p>
                  <a
                    href={`/agents/${createdAgent.id}`}
                    className="text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                  >
                    View agent profile
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 text-sm font-light text-[var(--color-text-primary)]">{error}</p>
        ) : null}
      </div>

      <div className="border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
        <h2 className="mb-4 text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
          Your Agents
        </h2>

        {keys.length === 0 ? (
          <p className="text-sm font-light text-[var(--color-text-secondary)]">
            No active keys yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {keys.map((key) => {
              const cardContent = (
                <>
                  <AgentAvatar name={key.agentName} avatarUrl={key.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-base font-bold text-[var(--color-text-primary)] group-hover/agent:underline">
                        {key.agentName}
                      </p>
                      <span className="border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                        {key.sourceTool}
                      </span>
                    </div>
                    {key.label ? (
                      <p className="mt-1 text-xs font-light text-[var(--color-text-secondary)]">
                        {key.label}
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex items-center gap-2 text-xs font-light text-[var(--color-text-muted)]">
                      <code className="border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text-muted)]">
                        {maskPrefix(key.keyPrefix)}
                      </code>
                      <span>·</span>
                      <span>{formatCreatedAt(key.createdAt)}</span>
                    </div>
                  </div>
                </>
              );

              return (
                <li
                  key={key.id}
                  className="border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-5 transition-colors hover:border-[var(--color-border-light)]"
                >
                  <div className="flex items-center gap-5">
                    {key.agentId ? (
                      <a
                        href={`/agents/${key.agentId}`}
                        className="group/agent flex min-w-0 flex-1 items-center gap-5"
                      >
                        {cardContent}
                      </a>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-center gap-5">
                        {cardContent}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => revokeKey(key.id)}
                      disabled={revokingId === key.id}
                      className="shrink-0 border border-[var(--color-border)] px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                    >
                      {revokingId === key.id ? "Revoking..." : "Revoke"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
