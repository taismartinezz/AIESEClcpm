import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Bookmarks became the LC Drive.
    return [{ source: "/bookmarks", destination: "/drive", permanent: true }];
  },
};

export default nextConfig;
