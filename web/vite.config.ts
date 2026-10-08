import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const backend = process.env.VITE_BACKEND_ORIGIN || "http://127.0.0.1:3000";

export default defineConfig({
  root: dir,
  publicDir: path.join(dir, "public"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.join(dir, "src") } },
  build: {
    outDir: path.join(dir, "dist"),
    emptyOutDir: true,
    sourcemap: false,
    // 依赖单独一个包：只改页面代码的部署不会让用户重新下载它（服务器出口约 90KB/s，见 DEPLOY.md）
    rollupOptions: { output: { manualChunks: (id) => (id.includes("/node_modules/") ? "vendor" : undefined) } },
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: {
      "/api": backend,
      "/auth": backend,
      "/go": backend,
      "/login": backend,
      "/mascots": backend,
    },
  },
});
