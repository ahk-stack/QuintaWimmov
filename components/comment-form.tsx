"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useIdentity } from "./identity";
import { Button } from "./ui";

/** Posts a comment to a lead's thread, then refreshes the server-rendered list. */
export function CommentForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const { current, ready } = useIdentity();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) return null;

  if (!current) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong px-4 py-3 text-sm text-muted">
        Pick your name in the top right to join the discussion.
      </p>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/leads/${leadId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorId: current!.id, body: trimmed }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setError(result.error ?? "Could not post that");
        return;
      }
      setBody("");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block">
        <span className="sr-only">Add a comment</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="What did you find out?"
          className="w-full resize-y rounded-lg border border-line-strong bg-paper px-3 py-2.5 text-sm placeholder:text-muted/70"
        />
      </label>
      {error ? (
        <p role="alert" className="text-xs font-bold text-status-lost">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || body.trim().length === 0}>
          {busy ? "Posting..." : "Comment"}
        </Button>
        <span className="text-xs text-muted">as {current.name}</span>
      </div>
    </form>
  );
}
