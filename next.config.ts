import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server in .next/standalone, used by the container image
  // (docker/code-preprod.Dockerfile). See DEPLOYMENT.md §3.
  output: "standalone",

  /*
   * Every API answer is per-user or about the caller's session, so none may be
   * stored by the browser or a shared proxy. Set here once rather than per
   * handler, so a new route or an early return (validation, 429) cannot forget
   * it. Pages are dynamic and Next already marks them private.
   */
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
