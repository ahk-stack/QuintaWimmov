"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "./ui";

const INPUT_CLASS =
  "mt-2 w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 text-sm placeholder:text-muted/70";

/**
 * Username and password form.
 *
 * Posts JSON to /api/auth/login, which sets an httpOnly cookie — the browser
 * never sees the session token. On success the router refreshes, so every
 * server component re-renders with the new session.
 */
export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (response.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      const result = await response.json().catch(() => ({}));
      setError(result.error ?? "Could not sign in.");
      // Clear the password so a wrong one is not resubmitted by accident.
      setPassword("");
    } catch {
      setError("Could not reach the server.");
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
      <label className="block">
        <span className="block text-xs font-bold tracking-[0.12em] uppercase">Username</span>
        <input
          name="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          className={INPUT_CLASS}
        />
      </label>

      <label className="block">
        <span className="block text-xs font-bold tracking-[0.12em] uppercase">Password</span>
        <input
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          className={INPUT_CLASS}
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-status-lost">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={submitting || !username || !password} className="w-full">
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
