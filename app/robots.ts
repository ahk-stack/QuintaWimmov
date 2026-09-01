import type { MetadataRoute } from "next";

/*
 * The hub is an internal tool on an open URL holding third-party contact
 * details. Disallow everything, unconditionally.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
