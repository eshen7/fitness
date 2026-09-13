import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev overlay badge is fixed to the bottom-left corner, which is exactly
  // where the mobile tab bar's first item sits. Off, so what is on screen in
  // development is what ships.
  devIndicators: false,
};

export default nextConfig;
