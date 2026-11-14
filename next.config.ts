import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // StrictMode's dev-only double effect run unmounts drei <Html> roots mid-render ("synchronously unmount a root"); production never shows it
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: "/data/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
};

export default nextConfig;
