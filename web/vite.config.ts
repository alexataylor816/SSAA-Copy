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
// Picks the adapter a phone on the same network can reach: a real Wi-Fi or
// Ethernet adapter first. Windows' Mobile Hotspot (192.168.137.x, "Local Area
// Connection*"), VirtualBox host-only (192.168.56.x) and WSL/Hyper-V
// ("vEthernet", usually 172.x) only reach devices on those virtual networks.
// LAN_ADDRESS=1.2.3.4 overrides the guess.
const isVirtual = (name: string, address: string) =>
  /^Local Area Connection\*|vEthernet|VirtualBox|VMware|Hyper-V|docker|br-|virbr|tailscale|zerotier/i.test(name) ||
  address.startsWith("192.168.137.") ||
  address.startsWith("192.168.56.");
const lanRank = (name: string, address: string) =>
  (isVirtual(name, address) ? 10 : 0) +
  (/wi-?fi|wlan|ethernet|^en|^eth/i.test(name) ? 0 : 2) +
  (address.startsWith("192.168.") ? 0 : address.startsWith("10.") ? 1 : 2);
const lanAddress =
  process.env.LAN_ADDRESS ||
  Object.entries(os.networkInterfaces())
    .flatMap(([name, nets]) => (nets ?? []).map((net) => ({ name, net })))
    .filter(({ net }) => net.family === "IPv4" && !net.internal && !net.address.startsWith("169.254."))
    .sort((a, b) => lanRank(a.name, a.net.address) - lanRank(b.name, b.net.address))[0]?.net.address;

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