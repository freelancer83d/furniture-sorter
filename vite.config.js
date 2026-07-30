import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works both locally and when served from
  // a GitHub Pages sub-path (https://user.github.io/repo-name/).
  base: "./",
});
