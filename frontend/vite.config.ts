import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Ernest console (assure vertex). Configuration keeps the PUBLIC_* names the deployment
// already passes (PUBLIC_API_URL, PUBLIC_OIDC_*, PUBLIC_*_URL); like any Vite variable they
// are fixed at build time.
export default defineConfig({
  plugins: [react()],
  envPrefix: "PUBLIC_",
  server: {
    port: 5186,
    strictPort: true,
    // The same routes nginx forwards in the image, so `npm run dev` talks to a local backend.
    proxy: {
      "/api": process.env.ERNEST_BACKEND_URL || "http://localhost:3001",
      "/ingestor": {
        target: process.env.ERNEST_INGESTOR_URL || "http://localhost:3011",
        rewrite: (path) => path.replace(/^\/ingestor/, ""),
      },
    },
  },
});
