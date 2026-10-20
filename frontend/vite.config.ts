import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Ernest console (assure vertex). Configuration keeps the PUBLIC_* names the deployment
// already passes (PUBLIC_API_URL, PUBLIC_OIDC_*, PUBLIC_*_URL); like any Vite variable they
// are fixed at build time.
export default defineConfig({
  plugins: [react()],
  envPrefix: "PUBLIC_",
  server: { port: 5186, strictPort: true },
});
