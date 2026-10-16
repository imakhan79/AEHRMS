import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AE Global HRMS",
    short_name: "AE HRMS",
    description: "Attendance, leave and self-service for AE Global Group",
    start_url: "/attendance",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#1e1b4b",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
