import { defineConfig } from "vite";

// Loader script build → single IIFE at /widget.js (no deps, tiny).
export default defineConfig({
  build: {
    outDir: "../server/public",
    emptyOutDir: false,
    lib: {
      entry: "src/loader.ts",
      name: "SupportWidget",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
  },
});
