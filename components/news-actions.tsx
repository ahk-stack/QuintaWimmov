"use client";

import { useIdentity } from "./identity";
import { ButtonLink } from "./ui";

/**
 * Shows the publish link only to admins.
 *
 * Presentational only. The API enforces the same rule server-side, because
 * anyone can select an admin identity from the picker — hiding a button is not
 * access control, and is not treated as such.
 */
export function NewsActions() {
  const { current, ready } = useIdentity();
  if (!ready || current?.role !== "admin") return null;
  return <ButtonLink href="/news/new">Write a post</ButtonLink>;
}
