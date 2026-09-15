import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle fixture JSON from /data for serverless routes
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/**/*"],
  },
};

export default nextConfig;
