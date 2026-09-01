import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { STATUS_META, toneTextClass } from "@/lib/status";
import type { LeadStatus, Person } from "@/lib/types";

/**
 * Design-system primitives.
 *
 * The brand is monochrome, so hierarchy has to come from type scale, weight and
 * rules rather than colour. Keeping these primitives in one file makes the
 * palette auditable in a single place, which is what the brand review rules in
 * AGENTS.md check against.
 */

// Surfaces --------------------------------------------------------------------

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-line bg-paper p-6 ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-baseline justify-between gap-4">
      <h2 className="text-xs font-bold tracking-[0.18em] uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  action,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-bold tracking-[0.2em] text-muted uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-2 text-4xl leading-[1.1]">{title}</h1>
        {lede ? (
          <p className="mt-3 max-w-2xl text-base text-muted">{lede}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="font-heading text-lg font-bold">{title}</p>
      {hint ? (
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{hint}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

// Actions ---------------------------------------------------------------------

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40";

const BUTTON_VARIANTS = {
  primary: "bg-ink text-paper hover:bg-ink/85",
  secondary: "border border-line-strong text-ink hover:bg-surface",
  ghost: "text-ink hover:bg-surface",
} as const;

type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return (
    <Link
      {...props}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`}
    />
  );
}

// Status ----------------------------------------------------------------------

/**
 * The one place colour is allowed. Rendered as an outlined pill using
 * `border-current`, so the single status colour drives both text and border and
 * cannot drift apart.
 */
export function StatusPill({ status }: { status: LeadStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`${toneTextClass(meta.tone)} inline-flex shrink-0 items-center rounded-full border border-current px-2.5 py-0.5 text-xs font-bold whitespace-nowrap`}
    >
      {meta.label}
    </span>
  );
}

/** Neutral label for anything that is not a status. Never coloured. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-bold text-muted whitespace-nowrap">
      {children}
    </span>
  );
}

// People ----------------------------------------------------------------------

export function Avatar({
  person,
  size = "md",
}: {
  person: Pick<Person, "initials" | "name"> | null;
  size?: "sm" | "md";
}) {
  const dimensions = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  if (!person) {
    return (
      <span
        aria-hidden
        className={`${dimensions} inline-flex items-center justify-center rounded-full border border-dashed border-line-strong font-bold text-muted`}
      >
        ?
      </span>
    );
  }
  return (
    <span
      title={person.name}
      className={`${dimensions} inline-flex shrink-0 items-center justify-center rounded-full bg-ink font-bold text-paper`}
    >
      {person.initials}
    </span>
  );
}

// Metrics ---------------------------------------------------------------------

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line px-5 py-4">
      <p className="text-xs font-bold tracking-[0.14em] text-muted uppercase">
        {label}
      </p>
      <p className="mt-2 font-heading text-3xl font-bold tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
