import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import os from "os";

// Port 8082 — the same slot the original Lovable app used, so the migration
// target and the reference can be compared side by side without moving URLs.
// The Expo client (frontend/) keeps 8081.
// GitHub Codespaces serves the forwarded port from *.app.github.dev over HTTPS.
const inCodespace = Boolean(process.env.CODESPACE_NAME);

// Invite links must open on a phone, where "localhost" means the
// phone itself. On a dev PC they use its Wi-Fi/LAN address instead.
// Prefers 192.168.x (home/office Wi-Fi) over 10.x and 172.x, which on Windows
// are often virtual adapters (WSL, Hyper-V) that a phone can't reach.
const lanRank = (address: string) => (address.startsWith("192.168.") ? 0 : address.startsWith("10.") ? 1 : 2);
const lanAddress = Object.values(os.networkInterfaces())
  .flat()
  .filter((net) => net && net.family === "IPv4" && !net.internal && !net.address.startsWith("169.254."))
  .map((net) => net!.address)
  .sort((a, b) => lanRank(a) - lanRank(b))[0];

export default defineConfig({
  server: {
    host: "::",
    port: 8082,
    // Vite refuses unknown Host headers; allow the Codespaces forwarding domain.
    allowedHosts: inCodespace ? [".app.github.dev"] : undefined,
    // Live reload has to reconnect through the HTTPS proxy, not straight to 8082.
    hmr: inCodespace ? { clientPort: 443 } : undefined,
    // Proxy to the Express API so the browser sees one origin and we never
    // need CORS exemptions or absolute API URLs in the client.
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/socket.io": {
        target: process.env.VITE_API_PROXY ?? "http://localhost:8000",
        ws: true,
      },
      "/uploads": {
        target: process.env.VITE_API_PROXY ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  define: {
    __SSAA_LAN_ORIGIN__: JSON.stringify(!inCodespace && lanAddress ? `http://${lanAddress}:8082` : ""),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});