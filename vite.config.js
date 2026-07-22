import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig({
  // Este repositorio se publica como joelbome30.github.io, así que vive en la raíz del dominio.
  base: "/",
  build: {
    chunkSizeWarningLimit: 700,
  },
  plugins: [
    {
      name: "sites-static-worker",
      closeBundle() {
        mkdirSync("dist/server", { recursive: true });
        copyFileSync("worker-static.js", "dist/server/index.js");
      },
    },
  ],
});
