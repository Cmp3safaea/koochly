import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedRoot = path.resolve(__dirname, "../packages/shared/src");

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@koochly/shared"],
  // Next 16 defaults to Turbopack for `next build`; keep aliases in sync for both bundlers.
  turbopack: {
    resolveAlias: {
      "@koochly/shared": path.join(sharedRoot, "index.ts"),
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@koochly/shared": path.join(sharedRoot, "index.ts"),
    };
    return config;
  },
  // Produces a minimal standalone server for Docker/Cloud Run.
  output: "standalone",
  // Monorepo: trace deps from repo root (avoids wrong workspace inference + duplicate lockfile warning).
  outputFileTracingRoot: path.join(__dirname, ".."),
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  experimental: {
    externalDir: true,
    optimizePackageImports: ["@koochly/shared"],
  },
  // If you open the dev app from another device/IP on your LAN,
  // Next.js will otherwise block the HMR websocket for safety.
  allowedDevOrigins: ["192.168.0.119", "localhost", "127.0.0.1"],
};

export default nextConfig;

