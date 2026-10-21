"use client";

import { useIdentity } from "./identity";
import { ButtonLink } from "./ui";

/**
 * Shows the publish link only to admins.
 *
 * Presentational only. The API checks the signed-in person's role itself;
 * hiding a button is not access control.
 */
export function NewsActions() {
  const { current, ready } = useIdentity();
  if (!ready || current?.role !== "admin") return null;
  return <ButtonLink href="/news/new">Write a post</ButtonLink>;
}
