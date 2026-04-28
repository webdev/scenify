import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained server at .next/standalone for Docker / minimal images.
  output: "standalone",
};

export default nextConfig;
