import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    exclude: ["react-remove-scroll"],
    include: ["tslib"],
  },
  ssr: {
    noExternal: ["tslib", "react-remove-scroll"],
  },
  build: {
    rollupOptions: {
      external: ["tslib"],
    },
  },
})
