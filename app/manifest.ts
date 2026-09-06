import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Citrinia",
    short_name: "Citrinia",
    description: "A tiny feed. Posts are peels.",
    start_url: "/",
    display: "standalone",
    background_color: "#FFF1E6",
    theme_color: "#FFF1E6",
    // The pngs are rendered from icon.svg (README, "Installing it"); the
    // maskable one keeps the art inside the safe zone on the ground colour.
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
