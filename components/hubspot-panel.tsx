"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatDateTime } from "@/lib/format";
import type { HubSpotErrorCode, HubSpotSyncState } from "@/lib/types";

import { Button } from "./ui";

/**
 * Where this lead stands with HubSpot, and a button to send or retry.
 *
 * Every message is fixed text chosen by code. The stored value is a code, never
 * a HubSpot message — those quote contact emails and phones.
 */

const ERROR_TEXT: Record<HubSpotErrorCode, string> = {
  no_contact: "Needs a contact email before it can go to HubSpot.",
  not_configured: "HubSpot is not connected yet.",
  owner_unmapped: "The owner isn't a HubSpot user, so the HubSpot lead has no owner.",
  company_busy: "Waiting for the company to be created in HubSpot.",
  "hubspot:auth": "HubSpot refused the app's access. An admin needs to check the connection.",
  "hubspot:scope": "The HubSpot connection is missing a permission. An admin needs to check it.",
  "hubspot:validation": "HubSpot rejected the lead's details.",
  "hubspot:not_found": "The record no longer exists in HubSpot.",
  "hubspot:rate_limited": "HubSpot was busy.",
  "hubspot:server": "HubSpot had a problem.",
  "hubspot:timeout": "HubSpot didn't answer in time.",
  "hubspot:network": "Couldn't reach HubSpot.",
  "hubspot:unexpected": "HubSpot answered unexpectedly.",
  internal: "Something went wrong on our side.",
};

export function HubSpotPanel({
  leadId,
  state,
  error,
  syncedAt,
  hubspotUrl,
  connected,
}: {
  leadId: string;
  state: HubSpotSyncState;
  error: HubSpotErrorCode | null;
  syncedAt: string | null;
  hubspotUrl: string | null;
  connected: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/leads/${leadId}/hubspot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) setMessage(result.error ?? "Could not queue it.");
      else setMessage(result.queued ? "Queued. It usually arrives within a minute." : "Already on its way.");
      router.refresh();
    } catch {
      setMessage("Could not reach the server.");
    }
    setBusy(false);
  }

  const view = !connected
    ? { label: "Not connected", tone: "text-status-pending" }
    : {
        manual: { label: "Not sent", tone: "text-status-pending" },
        pending: { label: "Sending…", tone: "text-status-info" },
        running: { label: "Sending…", tone: "text-status-info" },
        retry: { label: "Will retry automatically", tone: "text-status-watch" },
        synced: { label: "In HubSpot", tone: "text-status-won" },
        blocked: { label: "Can't be sent", tone: "text-status-lost" },
        failed: { label: "Failed", tone: "text-status-lost" },
      }[state];

  // A scheduled retry is left to its backoff; only a final failure can be re-run.
  const canSend = connected && (state === "manual" || state === "failed");

  return (
    <div>
      <h2 className="text-xs font-bold tracking-[0.16em] uppercase">HubSpot</h2>
      <p className={`mt-3 text-sm font-bold ${view.tone}`}>{view.label}</p>

      {connected && syncedAt && state !== "manual" ? (
        <p className="mt-1 text-xs text-muted">Last synced {formatDateTime(syncedAt)}</p>
      ) : null}

      {connected && error ? (
        <p className={`mt-1 text-xs ${error === "owner_unmapped" ? "text-muted" : "text-status-lost"}`}>
          {ERROR_TEXT[error]}
        </p>
      ) : null}

      {connected && state === "manual" ? (
        <p className="mt-1 text-xs text-muted">Posted before the HubSpot sync started.</p>
      ) : null}

      {hubspotUrl ? (
        <a
          href={hubspotUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs font-bold underline underline-offset-2"
        >
          Open in HubSpot
        </a>
      ) : null}

      {canSend ? (
        <div className="mt-3">
          <Button type="button" variant="secondary" onClick={send} disabled={busy}>
            {busy ? "Queuing…" : state === "manual" ? "Send to HubSpot" : "Try again"}
          </Button>
        </div>
      ) : null}

      {message ? <p className="mt-2 text-xs text-muted">{message}</p> : null}
    </div>
  );
}
