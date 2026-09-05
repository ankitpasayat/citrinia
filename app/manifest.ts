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
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
