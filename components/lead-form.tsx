"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { DIRECTION_META, ROLE_LABEL } from "@/lib/status";
import type { LeadDirection, LeadPriority, Person, Role } from "@/lib/types";

import { useIdentity } from "./identity";
import { Button } from "./ui";

/**
 * Lead submission form.
 *
 * Posts to /api/leads rather than writing to the store directly: the browser
 * never holds credentials that can write. Server-side validation is the
 * authority, and the field errors it returns are rendered inline here.
 */

const PRODUCTS = [
  "Velma",
  "Q-Data",
  "Q-Share",
  "Q-Channel",
  "Q-Sales",
  "Q-SEO",
  "Other",
];

const PRIORITIES: LeadPriority[] = ["low", "normal", "high"];

const INPUT_CLASS =
  "w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 text-sm placeholder:text-muted/70";

function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-bold tracking-[0.12em] uppercase">
        {label}
        {required ? null : (
          <span className="ml-2 font-normal tracking-normal text-muted normal-case">
            optional
          </span>
        )}
      </span>
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
      <span className="mt-2 block">{children}</span>
      {error ? (
        <span className="mt-1.5 block text-xs font-bold text-status-lost">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function LeadForm({ people }: { people: Person[] }) {
  const router = useRouter();
  const { current, ready } = useIdentity();

  const [direction, setDirection] = useState<LeadDirection>("for_sales");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState<LeadPriority>("normal");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || submitting) return;

    const form = new FormData(event.currentTarget);
    const payload = {
      createdBy: current.id,
      direction,
      priority,
      // Empty string means unassigned; the schema normalises it to null.
      assignedTo: assignedTo || null,
      hotelName: form.get("hotelName"),
      website: form.get("website"),
      city: form.get("city"),
      country: form.get("country"),
      rooms: form.get("rooms"),
      contactName: form.get("contactName"),
      contactEmail: form.get("contactEmail"),
      contactPhone: form.get("contactPhone"),
      productInterest: form.get("productInterest"),
      context: form.get("context"),
    };

    setSubmitting(true);
    setFormError(null);
    setFieldError({});

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFieldError(result.fields ?? {});
        setFormError(result.error ?? "Could not save the lead");
        setSubmitting(false);
        return;
      }

      // Land on the new lead so the next action (claiming it) is one click away.
      router.push(`/leads/${result.id}`);
    } catch {
      setFormError("Could not reach the server. Try again.");
      setSubmitting(false);
    }
  }

  /*
   * Role order follows the lead's direction: a lead FOR sales lists sales
   * first, and vice versa. Recomputed when direction changes, so switching the
   * picker reorders the dropdown.
   */
  const assignableGroups = (() => {
    const order: Role[] =
      direction === "for_sales"
        ? ["sales", "consultant", "admin"]
        : ["consultant", "sales", "admin"];
    return order
      .map((role) => ({
        role,
        members: people.filter((p) => p.active && p.role === role),
      }))
      .filter((group) => group.members.length > 0);
  })();

  if (!ready) return null;

  if (!current) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
        <p className="font-heading text-lg font-bold">Pick your name first</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Use the control in the top right. A lead needs an author so the other
          side knows who to come back to.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-10">
      <fieldset>
        <legend className="text-xs font-bold tracking-[0.18em] uppercase">
          What is this?
        </legend>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(["for_sales", "for_consultant"] as const).map((value) => {
            const active = direction === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setDirection(value)}
                aria-pressed={active}
                className={`rounded-xl border p-5 text-left transition-colors ${
                  active
                    ? "border-ink bg-surface"
                    : "border-line hover:border-line-strong"
                }`}
              >
                <span className="font-heading block text-base font-bold">
                  {DIRECTION_META[value].label}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {DIRECTION_META[value].help}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-xs font-bold tracking-[0.18em] uppercase">
          Assign it
        </legend>
        <p className="mt-2 text-xs text-muted">
          Optional. Left unassigned, it sits on the board for anyone to claim.
          Whoever you pick gets a notification.
        </p>

        <label className="mt-4 block">
          <span className="sr-only">Assign to</span>
          <select
            value={assignedTo}
            onChange={(event) => setAssignedTo(event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Unassigned — anyone can claim it</option>
            {/*
              Grouped by role, with the side the lead is FOR listed first, since
              that is who it is usually going to. Everyone stays selectable: a
              consultant occasionally needs to hand something to an admin, and
              hiding that would be a dead end rather than a safeguard.
            */}
            {assignableGroups.map((group) => (
              <optgroup key={group.role} label={ROLE_LABEL[group.role]}>
                {group.members.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {person.territory ? ` (${person.territory})` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {fieldError.assignedTo ? (
          <span className="mt-1.5 block text-xs font-bold text-status-lost">
            {fieldError.assignedTo}
          </span>
        ) : null}
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="text-xs font-bold tracking-[0.18em] uppercase">
          The hotel
        </legend>

        <Field label="Hotel or group" required error={fieldError.hotelName}>
          <input
            name="hotelName"
            required
            maxLength={200}
            autoComplete="off"
            placeholder="Hotel des Quatre Vents"
            className={INPUT_CLASS}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Website"
            hint="A bare domain is fine."
            error={fieldError.website}
          >
            <input
              name="website"
              maxLength={300}
              autoComplete="off"
              placeholder="quatrevents.com"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Rooms" error={fieldError.rooms}>
            <input
              name="rooms"
              type="number"
              min={1}
              max={20000}
              autoComplete="off"
              placeholder="62"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="City" error={fieldError.city}>
            <input
              name="city"
              maxLength={120}
              autoComplete="off"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Country" error={fieldError.country}>
            <input
              name="country"
              maxLength={120}
              autoComplete="off"
              className={INPUT_CLASS}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="text-xs font-bold tracking-[0.18em] uppercase">
          Who to talk to
        </legend>
        <p className="text-xs text-muted">
          Work contact details only. No personal mobiles, and nothing told to you
          in confidence.
        </p>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Contact name" error={fieldError.contactName}>
            <input
              name="contactName"
              maxLength={160}
              autoComplete="off"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Contact email" error={fieldError.contactEmail}>
            <input
              name="contactEmail"
              type="email"
              maxLength={200}
              autoComplete="off"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Contact phone" error={fieldError.contactPhone}>
            <input
              name="contactPhone"
              maxLength={60}
              autoComplete="off"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Product interest" error={fieldError.productInterest}>
            <select name="productInterest" defaultValue="" className={INPUT_CLASS}>
              <option value="">Not sure yet</option>
              {PRODUCTS.map((product) => (
                <option key={product} value={product}>
                  {product}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="text-xs font-bold tracking-[0.18em] uppercase">
          Context
        </legend>

        <Field
          label="Background"
          hint="What does the other side need to know to have a useful first conversation?"
          error={fieldError.context}
        >
          <textarea
            name="context"
            rows={6}
            maxLength={4000}
            className={`${INPUT_CLASS} resize-y`}
            placeholder="How you came across them, what they said, and anything time sensitive."
          />
        </Field>

        <Field label="Priority" required error={fieldError.priority}>
          <div className="flex gap-2">
            {PRIORITIES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPriority(value)}
                aria-pressed={priority === value}
                className={`rounded-full border px-4 py-1.5 text-xs font-bold capitalize transition-colors ${
                  priority === value
                    ? "border-ink bg-ink text-paper"
                    : "border-line-strong text-muted hover:bg-surface hover:text-ink"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </Field>
      </fieldset>

      {formError ? (
        <p
          role="alert"
          className="rounded-lg border border-status-lost px-4 py-3 text-sm font-bold text-status-lost"
        >
          {formError}
        </p>
      ) : null}

      <div className="flex items-center gap-4 border-t border-line pt-6">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Posting..." : "Post lead"}
        </Button>
        <span className="text-xs text-muted">
          Posting as <span className="font-bold">{current.name}</span>
        </span>
      </div>
    </form>
  );
}
