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
}: {
  people: Person[];
  /**
   * Seeded on the server from the identity cookie, so the badge is correct on
   * first paint instead of flashing empty. It also keeps the polling effect a
   * pure subscription, with no state written during the effect body.
   */
  initialItems: BellItem[];
}) {
  const router = useRouter();
  const { current, ready } = useIdentity();
  const [items, setItems] = useState<BellItem[]>(initialItems);
  const [open, setOpen] = useState(false);

  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people],
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", {
        // Never serve a stale count from the browser cache.
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = await response.json();
      setItems(Array.isArray(data.items) ? data.items : []);
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
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [current?.id, load]);

  async function markRead(ids?: string[]) {
    // Clear locally first so the badge responds immediately.
    setItems((previous) =>
      ids ? previous.filter((i) => !ids.includes(i.id)) : [],
    );
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : {}),
      });
    } catch {
      // Re-sync on the next poll if the request failed.
      void load();
    }
  }

  // Reserve the footprint before hydration so the nav does not shift.
  if (!ready || !current) {
    return <span className="inline-block h-8 w-8" aria-hidden />;
  }

  const count = items.length;
  const badge = count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
