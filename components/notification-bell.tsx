"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatDateTime } from "@/lib/format";
import type { NotificationKind, Person } from "@/lib/types";

import { useIdentity } from "./identity";
import { Avatar } from "./ui";

/**
 * Notification bell with an unread count.
 *
 * Lights up when someone mentions you in a channel or sends you a direct
 * message. The count comes from /api/notifications, which resolves whose bell
 * it is from the identity cookie rather than a query parameter.
 *
 * Polled rather than pushed. Mentions could ride the existing Realtime channel
 * subscription, but direct messages cannot: `direct_messages` grants the anon
 * key nothing, on purpose, so there is no socket that can carry them. One
 * polling path for both is simpler than two mechanisms that behave differently.
 */

export interface BellItem {
  id: string;
  kind: NotificationKind;
  actorId: string | null;
  href: string;
  preview: string | null;
  createdAt: string;
}

/** Poll cadence. Paused entirely while the tab is hidden. */
const POLL_MS = 20000;

/** Above this the badge shows "9+" rather than growing the nav. */
const BADGE_CAP = 9;

const KIND_LABEL: Record<NotificationKind, string> = {
  mention: "mentioned you",
  direct_message: "sent you a message",
};

export function NotificationBell({
  people,
  initialItems,
  initialOwnerId,
}: {
  people: Person[];
  /**
   * Seeded on the server from the identity cookie, so the badge is correct on
   * first paint instead of flashing empty. It also keeps the polling effect a
   * pure subscription, with no state written during the effect body.
   */
  initialItems: BellItem[];
  /** Who those items belong to, per the cookie the server saw. */
  initialOwnerId: string | null;
}) {
  const router = useRouter();
  const { current, ready } = useIdentity();
  /*
   * Items are stored WITH the person they belong to.
   *
   * Identity can change in the browser at any moment. Holding the owner
   * alongside the data lets the mismatch be resolved during render, so the
   * previous person's message previews are never displayed and "Mark all read"
   * can never act on one person's notifications while showing another's. An
   * effect that cleared state on change would be a frame late and would write
   * state during the effect body.
   */
  const [state, setState] = useState<{
    ownerId: string | null;
    items: BellItem[];
  }>({ ownerId: initialOwnerId, items: initialItems });
  const [open, setOpen] = useState(false);

  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people],
  );

  const load = useCallback(async (ownerId: string) => {
    try {
      const response = await fetch("/api/notifications", {
        // Never serve a stale count from the browser cache.
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = await response.json();
      // Stamped with the identity this fetch was for, so a response that
      // arrives after an identity switch is discarded rather than displayed.
      setState({
        ownerId,
        items: Array.isArray(data.items) ? data.items : [],
      });
    } catch {
      // Offline or a failed request leaves the previous count in place.
    }
  }, []);

  /*
   * Subscription only: a timer and a focus listener, both of which write state
   * from their own async callbacks. Nothing is set during the effect body,
   * which is why the initial value arrives as a prop instead of a fetch here.
   *
   * `current?.id` is a dependency so switching identity restarts the poll. The
   * new person's count arrives on the next tick, or immediately on refocus —
   * the cookie the endpoint reads has already changed by then.
   */
  useEffect(() => {
    const personId = current?.id;
    if (!personId) return;

    const tick = () => {
      if (document.visibilityState === "visible") void load(personId);
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [current?.id, load]);

  async function markRead(ids?: string[]) {
    const personId = current?.id;
    if (!personId) return;

    /*
     * Always send explicit ids, even for "mark all": the ids of what is
     * actually on screen. A bare "mark everything" would also clear anything
     * that arrived between the last poll and the click, which the person never
     * saw.
     */
    const target = ids ?? items.map((i) => i.id);
    if (target.length === 0) return;

    // Clear locally first so the badge responds immediately.
    setState((previous) => ({
      ownerId: personId,
      items: previous.items.filter((i) => !target.includes(i.id)),
    }));
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: target }),
      });
    } catch {
      // Re-sync on the next poll if the request failed.
      void load(personId);
    }
  }

  // Reserve the footprint before hydration so the nav does not shift.
  if (!ready || !current) {
    return <span className="inline-block h-8 w-8" aria-hidden />;
  }

  /*
   * Derived, not synced. Anything belonging to a different identity is treated
   * as absent immediately, so a switch can never show the previous person's
   * previews while waiting for the next poll.
   */
  const items = state.ownerId === current.id ? state.items : [];

  const count = items.length;
  const badge = count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          const opening = !open;
          setOpen(opening);
          // Opening is a deliberate action, so fetch rather than wait for the
          // next tick. This is also what makes an identity switch feel instant.
          if (opening) void load(current.id);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          count === 0
            ? "Notifications"
            : `Notifications, ${count} unread`
        }
        className="relative flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface"
      >
        {/* Inline so it inherits currentColor and needs no icon dependency. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>

        {count > 0 ? (
          /*
           * The one red in the interface. The brand reserves colour for
           * functional status, and an unread count is exactly that — it is
           * telling you something needs attention, not decorating the nav. Uses
           * the brand's own red token rather than an arbitrary one.
           */
          <span
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-lost px-1 text-[10px] font-bold text-paper tabular-nums"
            aria-hidden
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* Click-away layer. */}
          <button
            type="button"
            aria-label="Close notifications"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-paper shadow-lg"
          >
            <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
              <p className="text-xs font-bold tracking-[0.16em] uppercase">
                Notifications
              </p>
              {count > 0 ? (
                <button
                  type="button"
                  onClick={() => void markRead()}
                  className="text-xs font-bold underline decoration-1 underline-offset-4 hover:no-underline"
                >
                  Mark all read
                </button>
              ) : null}
            </div>

            {count === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                Nothing new. Mentions and direct messages show up here.
              </p>
            ) : (
              <ul className="max-h-96 overflow-y-auto">
                {items.map((item) => {
                  const actor = item.actorId
                    ? (peopleById.get(item.actorId) ?? null)
                    : null;
                  return (
                    <li key={item.id} className="border-b border-line last:border-b-0">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpen(false);
                          void markRead([item.id]);
                          router.push(item.href);
                        }}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface"
                      >
                        <Avatar person={actor} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs">
                            <span className="font-bold">
                              {actor?.name ?? "Someone"}
                            </span>{" "}
                            {KIND_LABEL[item.kind]}
                          </span>
                          {item.preview ? (
                            <span className="mt-0.5 block truncate text-xs text-muted">
                              {item.preview}
                            </span>
                          ) : null}
                          <span className="mt-1 block text-[10px] text-muted">
                            {formatDateTime(item.createdAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
