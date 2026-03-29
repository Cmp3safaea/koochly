import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Path A (hosted WebView): the native shell loads your deployed Next app from `server.url`.
 * Set `CAPACITOR_SERVER_URL` or `NEXT_PUBLIC_SITE_URL` before `cap sync` / native runs.
 * Dev default: `http://localhost:3000`. Android emulator: use `http://10.0.2.2:3000`.
 */
function normalizeOrigin(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function getServerUrl(): string {
  const explicit =
    process.env.CAPACITOR_SERVER_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return normalizeOrigin(explicit);
  return "http://localhost:3000";
}

const url = getServerUrl();

const config: CapacitorConfig = {
  appId: "app.koochly.web",
  appName: "Koochly",
  webDir: "public/capacitor-www",
  server: {
    url,
    cleartext: url.startsWith("http://"),
  },
};

export default config;
