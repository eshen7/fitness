import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Training",
    short_name: "Training",
    description: "Vertical jump and athleticism training.",
    start_url: "/today",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f0e0c",
    theme_color: "#0f0e0c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
