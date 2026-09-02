"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useIdentity } from "./identity";
import { Markdown } from "./markdown";
import { Button } from "./ui";

/**
 * News editor with a live preview.
 *
 * The preview uses the same renderer as the article page, so what you see is
 * what publishes — including the fact that raw HTML comes out as text.
 */

const CATEGORIES = ["Product", "Wins", "Policy", "People", "Other"];

const INPUT_CLASS =
  "w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 text-sm placeholder:text-muted/70";

export function NewsForm() {
  const router = useRouter();
  const { current, ready } = useIdentity();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});

  if (!ready) return null;

  if (!current) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
        <p className="font-heading text-lg font-bold">Pick your name first</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Use the control in the top right.
        </p>
      </div>
    );
  }

  if (current.role !== "admin") {
    return (
      <div className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
        <p className="font-heading text-lg font-bold">Admins only</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          News goes to everyone, so publishing is limited to admins. If something
          belongs in front of the whole team, ask an admin to post it.
        </p>
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !current) return;

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setFormError(null);
    setFieldError({});

    try {
      const response = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorId: current.id,
          title,
          body,
          pinned,
          excerpt: form.get("excerpt"),
          category: form.get("category"),
        }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFieldError(result.fields ?? {});
        setFormError(result.error ?? "Could not publish the post");
        setSubmitting(false);
        return;
      }
      router.push(`/news/${result.slug}`);
    } catch {
      setFormError("Could not reach the server. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <label className="block">
        <span className="block text-xs font-bold tracking-[0.12em] uppercase">
          Title
        </span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={200}
          placeholder="What happened?"
          className={`${INPUT_CLASS} mt-2`}
        />
        {fieldError.title ? (
          <span className="mt-1.5 block text-xs font-bold text-status-lost">
            {fieldError.title}
          </span>
        ) : null}
      </label>

      <div className="grid gap-6 sm:grid-cols-2">
        <label className="block">
          <span className="block text-xs font-bold tracking-[0.12em] uppercase">
            Category
            <span className="ml-2 font-normal tracking-normal text-muted normal-case">
              optional
            </span>
          </span>
          <select name="category" defaultValue="" className={`${INPUT_CLASS} mt-2`}>
            <option value="">None</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-end gap-3 pb-2.5">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => setPinned(event.target.checked)}
            className="h-4 w-4 accent-black"
          />
          <span className="text-sm">
            Pin to the top
            <span className="block text-xs text-muted">
              Keeps it above newer posts.
            </span>
          </span>
        </label>
      </div>

      <label className="block">
        <span className="block text-xs font-bold tracking-[0.12em] uppercase">
          Summary
          <span className="ml-2 font-normal tracking-normal text-muted normal-case">
            optional
          </span>
        </span>
        <span className="mt-1 block text-xs text-muted">
          One line shown in the feed. Left blank, the first paragraph is used.
        </span>
        <input
          name="excerpt"
          maxLength={400}
          className={`${INPUT_CLASS} mt-2`}
        />
      </label>

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <span className="text-xs font-bold tracking-[0.12em] uppercase">
            Post
          </span>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="text-xs font-bold underline decoration-1 underline-offset-4 hover:no-underline"
          >
            {showPreview ? "Keep writing" : "Preview"}
          </button>
        </div>

        {showPreview ? (
          <div className="min-h-48 rounded-lg border border-line px-4 py-4">
            {body.trim().length > 0 ? (
              <Markdown>{body}</Markdown>
            ) : (
              <p className="text-sm text-muted">Nothing to preview yet.</p>
            )}
          </div>
        ) : (
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            required
            rows={16}
            maxLength={20000}
            placeholder={"Markdown works.\n\n## A heading\n\n- a list item\n- another\n\n**bold** and [links](https://quinta.im)."}
            className={`${INPUT_CLASS} resize-y font-mono`}
          />
        )}

        {fieldError.body ? (
          <span className="mt-1.5 block text-xs font-bold text-status-lost">
            {fieldError.body}
          </span>
        ) : null}
        <p className="mt-2 text-xs text-muted">
          Markdown is supported. HTML is not — it will show as plain text.
        </p>
      </div>

      {formError ? (
        <p
          role="alert"
          className="rounded-lg border border-status-lost px-4 py-3 text-sm font-bold text-status-lost"
        >
          {formError}
        </p>
      ) : null}

      <div className="flex items-center gap-4 border-t border-line pt-6">
        <Button
          type="submit"
          disabled={submitting || title.trim().length === 0 || body.trim().length === 0}
        >
          {submitting ? "Publishing..." : "Publish"}
        </Button>
        <span className="text-xs text-muted">
          Publishing as <span className="font-bold">{current.name}</span>
        </span>
      </div>
    </form>
  );
}
