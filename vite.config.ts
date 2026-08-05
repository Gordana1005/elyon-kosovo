import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Routes are already lazy (App.tsx), but everything they share landed in
        // one 1.05 MB entry chunk that every user downloads before the first
        // paint. Splitting the big, rarely-changing vendors out means they cache
        // independently and a normal app deploy no longer invalidates them.
        //
        // Deliberately NOT split: recharts and xlsx already get their own chunks
        // via lazy imports at their use sites — naming them here would pull them
        // back into the eager graph.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-i18n": ["i18next", "react-i18next"],
          "vendor-supabase": ["@supabase/supabase-js"],
        },
      },
    },
  },
}));
