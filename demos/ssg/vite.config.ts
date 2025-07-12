import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  root: ".", // Current directory (demos/ssg)
  build: {
    outDir: "build",
  },
});
