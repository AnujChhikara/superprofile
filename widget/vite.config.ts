import { defineConfig } from "vite";

// Frame app build → served from the API origin at /widget/.
export default defineConfig({
  base: "/widget/",
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: {
    outDir: "../server/public/widget",
    emptyOutDir: true,
  },
});
