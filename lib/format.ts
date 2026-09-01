/**
 * Formatting helpers.
 *
 * Every formatter pins both the locale and the time zone. Left to the runtime
 * default, the server and the browser can disagree and React reports a
 * hydration mismatch, so the output here is deliberately deterministic rather
 * than localised to the viewer.
 */

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export function formatDate(iso: string): string {
  return DATE.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return `${DATE_TIME.format(new Date(iso))} UTC`;
}

export function formatTime(iso: string): string {
  return TIME.format(new Date(iso));
}

/** Calendar-day key in UTC, used to group chat messages under a date divider. */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function isWithinDays(iso: string, days: number): boolean {
  const age = Date.now() - new Date(iso).getTime();
  return age >= 0 && age <= days * 24 * 60 * 60 * 1000;
}

/** Strips the scheme and any trailing slash, for compact display of a website. */
export function displayHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

/** First paragraph of markdown, plain text, for list previews. */
export function markdownLede(body: string, maxLength = 180): string {
  const firstBlock =
    body
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .find((block) => block.length > 0 && !block.startsWith("#")) ?? "";
  const plain = firstBlock
    .replace(/^[-*]\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLength
    ? `${plain.slice(0, maxLength).trimEnd()}...`
    : plain;
}
