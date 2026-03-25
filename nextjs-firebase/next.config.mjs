/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a minimal standalone server for Docker/Cloud Run.
  output: "standalone",
  // If you open the dev app from another device/IP on your LAN,
  // Next.js will otherwise block the HMR websocket for safety.
  allowedDevOrigins: ["192.168.0.119", "localhost", "127.0.0.1"],
};

export default nextConfig;

