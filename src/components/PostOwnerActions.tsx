"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PostOwnerActionsProps {
  postId: string;
  panelSlug: string;
  initialTitle: string;
  initialSummary: string | null;
  initialContent: string;
}

type ApiPayload = {
  ok?: boolean;
  error?: string;
};

function readApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const maybeError = (payload as { error?: unknown }).error;
  if (typeof maybeError === "string" && maybeError.trim()) {
    return maybeError;
  }

  return fallback;
}

function normalizeSummary(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export default function PostOwnerActions({
  postId,
  panelSlug,
  initialTitle,
  initialSummary,
  initialContent,
}: PostOwnerActionsProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const [savedSummary, setSavedSummary] = useState(initialSummary ?? "");
  const [savedContent, setSavedContent] = useState(initialContent);

  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary ?? "");
  const [content, setContent] = useState(initialContent);

  const resetDraftToSaved = () => {
    setTitle(savedTitle);
    setSummary(savedSummary);
    setContent(savedContent);
  };

  const onSave = async () => {
    if (isSaving || isDeleting) {
      return;
    }

    setError(null);
    setIsSaving(true);

    const payload = {
      title: title.trim(),
      summary: normalizeSummary(summary),
      content,
    };

    try {
      const response = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responsePayload = (await response.json().catch(() => null)) as ApiPayload | null;
      if (!response.ok || !responsePayload?.ok) {
        throw new Error(readApiError(responsePayload, "Failed to update post."));
      }

      setSavedTitle(payload.title);
      setSavedSummary(payload.summary ?? "");
      setSavedContent(payload.content);
      setTitle(payload.title);
      setSummary(payload.summary ?? "");
      setContent(payload.content);
      setIsEditing(false);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update post.");
    } finally {
      setIsSaving(false);
    }
  };

  const onDelete = async () => {
    if (isDeleting || isSaving) {
      return;
    }

    const confirmed = window.confirm(
      "Delete this post permanently? This action cannot be undone.",
    );
    if (!confirmed) {
      return;
    }

    setError(null);
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/posts/${postId}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as ApiPayload | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(readApiError(payload, "Failed to delete post."));
      }

      router.push(`/p/${panelSlug}`);
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete post.");
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setError(null);
            if (isEditing) {
              resetDraftToSaved();
            }
            setIsEditing((current) => !current);
          }}
          disabled={isSaving || isDeleting}
          className="border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
        >
          {isEditing ? "Cancel" : "Edit"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={isSaving || isDeleting}
          className="border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </button>
      </div>

      {isEditing ? (
        <div className="mt-5 border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="space-y-3">
            <label className="block text-sm font-medium text-[var(--color-text-primary)]">
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1 w-full border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm font-light text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-border-hover)]"
              />
            </label>

            <label className="block text-sm font-medium text-[var(--color-text-primary)]">
              Summary
              <input
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                className="mt-1 w-full border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm font-light text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-border-hover)]"
              />
            </label>

            <label className="block text-sm font-medium text-[var(--color-text-primary)]">
              Content
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={14}
                className="mt-1 w-full border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 font-mono text-sm font-light text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-border-hover)]"
              />
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onSave}
                disabled={isSaving || isDeleting}
                className="border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-hover)] disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm font-light text-[var(--color-text-secondary)]" role="status">
          {error}
        </p>
      ) : null}
    </>
  );
}
