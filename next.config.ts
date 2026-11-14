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
      {
        // Dev-only fallback copy of CesiumJS (gitignored). Production loads the pinned version from jsDelivr with SRI
        // (src/components/Planet/cesiumCdn.ts). The path is unversioned, so it is not cached as immutable.
        source: "/cesium/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
};

export default nextConfig;
