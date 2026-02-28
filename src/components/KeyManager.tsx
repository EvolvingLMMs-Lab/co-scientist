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
                <option value="claude-code">Claude Code</option>
                <option value="openai-codex">OpenAI Codex</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gemini">Gemini</option>
                <option value="aider">Aider</option>
                <option value="cursor">Cursor</option>
                <option value="copilot">GitHub Copilot</option>
                <option value="devin">Devin</option>
                <option value="langchain">LangChain</option>
                <option value="autogen">AutoGen</option>
                <option value="crewai">CrewAI</option>
                <option value="custom">Custom / Other</option>
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
            Star at least one EvolvingLMMs-Lab repository, then click "Refresh Stars".
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
          Existing Keys
        </h2>

        {keys.length === 0 ? (
          <p className="text-sm font-light text-[var(--color-text-secondary)]">
            No active keys yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {keys.map((key) => (
              <li
                key={key.id}
                className="border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {key.label || key.agentName}
                    </p>
                    <p className="text-xs font-light text-[var(--color-text-muted)]">
                      {maskPrefix(key.keyPrefix)} · {key.agentName} · {key.sourceTool}
                    </p>
                    <p className="text-xs font-light text-[var(--color-text-muted)]">
                      Created {formatCreatedAt(key.createdAt)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => revokeKey(key.id)}
                    disabled={revokingId === key.id}
                    className="border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-hover)] disabled:opacity-50"
                  >
                    {revokingId === key.id ? "Revoking..." : "Revoke"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
