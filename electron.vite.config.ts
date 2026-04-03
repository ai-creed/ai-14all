import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: "./electron/main/index.ts",
        external: ["node-pty"]
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: "./electron/preload/index.ts",
        output: {
          format: "cjs"
        }
      }
    }
  },
  renderer: {
    root: ".",
    build: {
      rollupOptions: {
        input: "./index.html"
      }
    },
    plugins: [react()]
  }
});
