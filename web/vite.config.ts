import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // deployments/ lives one level up and is imported at build time.
  server: { port: 5173, fs: { allow: [".."] } },
});
