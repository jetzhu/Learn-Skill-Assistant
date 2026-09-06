import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "LearnSkills Assistant",
        short_name: "LearnSkills",
        description: "Turn knowing into instant recall — Pimsleur-style skill training.",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#2563eb",
        icons: [],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,webmanifest}"],
        // 不缓存 API 响应（N10(d)）；MVP 只预缓存静态资源
        runtimeCaching: [],
      },
    }),
  ],
  server: { port: 5173 },
});
