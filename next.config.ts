import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server in .next/standalone, used by the container image
  // (docker/code-preprod.Dockerfile). See DEPLOYMENT.md §3.
  output: "standalone",
};

export default nextConfig;
