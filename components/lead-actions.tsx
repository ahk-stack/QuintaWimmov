"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { LEAD_STATUSES, STATUS_META } from "@/lib/status";
import type { Lead, LeadStatus, Person } from "@/lib/types";

import { useIdentity } from "./identity";
import { Button } from "./ui";

/**
 * Status and ownership controls.
 *
 * Every change goes through PATCH /api/leads/[id]; the browser never writes to
 * the store. After a successful change `router.refresh()` re-runs the server
 * component so the timeline and status pill reflect the new state without a
 * full reload.
 */
export function LeadActions({
  lead,
  people,
}: {
  lead: Lead;
  people: Person[];
}) {
  const router = useRouter();
  const { current, ready } = useIdentity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    if (!current) {
      setError("Pick your name in the top right first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId: current.id, ...body }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setError(result.error ?? "That did not work");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const assignee = people.find((p) => p.id === lead.assignedTo) ?? null;
  const canClaim = ready && current && lead.assignedTo !== current.id;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xs font-bold tracking-[0.16em] uppercase">Status</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {LEAD_STATUSES.map((status: LeadStatus) => {
            const active = lead.status === status;
            return (
              <button
                key={status}
                type="button"
                disabled={busy || active}
                onClick={() => patch({ status })}
                title={STATUS_META[status].help}
                aria-current={active ? "true" : undefined}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed ${
                  active
                    ? "border-ink bg-ink text-paper"
                    : "border-line-strong text-muted hover:bg-surface hover:text-ink disabled:opacity-40"
                }`}
              >
                {STATUS_META[status].label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted">
          {STATUS_META[lead.status].help}
        </p>
      </div>

      <div>
        <h2 className="text-xs font-bold tracking-[0.16em] uppercase">Owner</h2>
        <p className="mt-3 text-sm">
          {assignee ? (
            <span className="font-bold">{assignee.name}</span>
          ) : (
            <span className="text-muted">Nobody has claimed this yet.</span>
          )}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canClaim ? (
            <Button
              type="button"
              disabled={busy}
              onClick={() => patch({ assignedTo: current.id, status: lead.status === "new" ? "claimed" : lead.status })}
            >
              Claim it
            </Button>
          ) : null}

          <label className="flex items-center gap-2 text-xs text-muted">
            <span className="sr-only">Assign to</span>
            <select
              disabled={busy}
              value={lead.assignedTo ?? ""}
              onChange={(event) =>
                patch({ assignedTo: event.target.value || null })
              }
              className="rounded-lg border border-line-strong bg-paper px-3 py-2 text-sm text-ink"
            >
              <option value="">Unassigned</option>
              {people
                .filter((p) => p.active)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-status-lost px-3 py-2 text-xs font-bold text-status-lost"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
