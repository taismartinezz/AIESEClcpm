import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Bookmarks became the LC Drive.
      { source: "/bookmarks", destination: "/drive", permanent: true },
      // Journal was removed; Import moved into each page's own Import button.
      { source: "/journal", destination: "/checkin", permanent: false },
      { source: "/import", destination: "/pipeline", permanent: false },
    ];
  },
};

export default nextConfig;
