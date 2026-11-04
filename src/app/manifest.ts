import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zicon HRMS — iTANZ",
    short_name: "Zicon HRMS",
    description: "Attendance, leave, payroll and self-service",
    start_url: "/attendance",
    display: "standalone",
    background_color: "#f9fafb",
    theme_color: "#1878a0",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
