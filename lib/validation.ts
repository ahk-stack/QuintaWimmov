import { z } from "zod";

/**
 * Request validation.
 *
 * Every route handler parses its body through one of these schemas. With no
 * sign-in, the request body is fully attacker-controlled, so nothing reaches the
 * store unvalidated and every field carries a length bound.
 */

/** Trims, treats blank as absent, and normalises "" and undefined to null. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .optional()
    .nullable()
    .transform((value) => (value && value.length > 0 ? value : null));
}

const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .optional()
  .nullable()
  .transform((value) => (value && value.length > 0 ? value : null))
  .refine((value) => value === null || z.email().safeParse(value).success, {
    message: "Enter a valid email address",
  });

const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .optional()
  .nullable()
  .transform((value) => {
    if (!value || value.length === 0) return null;
    // People paste bare domains; store something that resolves as a link.
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  })
  .refine((value) => value === null || z.url().safeParse(value).success, {
    message: "Enter a valid website address",
  });

/** Accepts a number or a numeric string; blank becomes null. */
const optionalRoomCount = z
  .preprocess(
    (value) =>
      value === "" || value === null || value === undefined ? undefined : value,
    z.coerce
      .number()
      .int("Room count must be a whole number")
      .min(1, "Room count must be at least 1")
      .max(20000, "That room count looks wrong")
      .optional(),
  )
  .transform((value) => value ?? null);

export const LEAD_DIRECTIONS = ["for_sales", "for_consultant"] as const;
export const LEAD_STATUSES = [
  "new",
  "claimed",
  "in_progress",
  "won",
  "lost",
] as const;
export const LEAD_PRIORITIES = ["low", "normal", "high"] as const;

export const newLeadSchema = z.object({
  /** Attribution only. Checked against the roster, never trusted as identity. */
  createdBy: z.string().min(1, "Pick your name first").max(64),
  direction: z.enum(LEAD_DIRECTIONS),
  hotelName: z
    .string()
    .trim()
    .min(2, "Give the hotel or group a name")
    .max(200),
  website: optionalUrl,
  city: optionalText(120),
  country: optionalText(120),
  rooms: optionalRoomCount,
  contactName: optionalText(160),
  contactEmail: optionalEmail,
  contactPhone: optionalText(60),
  productInterest: optionalText(80),
  context: optionalText(4000),
  priority: z.enum(LEAD_PRIORITIES).default("normal"),
});

export type NewLeadInput = z.infer<typeof newLeadSchema>;

export const leadPatchSchema = z
  .object({
    actorId: z.string().min(1).max(64),
    status: z.enum(LEAD_STATUSES).optional(),
    assignedTo: z.string().min(1).max(64).nullable().optional(),
    priority: z.enum(LEAD_PRIORITIES).optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.assignedTo !== undefined ||
      value.priority !== undefined,
    { message: "Nothing to change" },
  );

export const leadCommentSchema = z.object({
  authorId: z.string().min(1, "Pick your name first").max(64),
  body: z.string().trim().min(1, "Write something").max(4000),
});

export const messageSchema = z.object({
  channelId: z.string().min(1).max(64),
  authorId: z.string().min(1, "Pick your name first").max(64),
  body: z.string().trim().min(1, "Write something").max(4000),
});

/**
 * Flattens zod issues to `{ field: message }`.
 *
 * Messages only. The submitted values are never echoed back, because lead
 * bodies carry prospect contact details.
 */
export function fieldErrors(
  error: z.ZodError<unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    result[key] ??= issue.message;
  }
  return result;
}
