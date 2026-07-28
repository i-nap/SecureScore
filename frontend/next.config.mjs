import withPWA from "next-pwa";
import { withSentryConfig } from "@sentry/nextjs";

const pwaConfig = withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  runtimeCaching: [
    {
      urlPattern: /\/api\/branch\/(metrics|clients|fraud_alerts|loan_decisions|dashboard)/,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "branch-api-1h",
        expiration: { maxEntries: 50, maxAgeSeconds: 3600 },
      },
    },
    {
      urlPattern: /\/api\/customer\/(score|accounts|transactions)/,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "customer-api-1h",
        expiration: { maxEntries: 20, maxAgeSeconds: 3600 },
      },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  output: "standalone",
  experimental: { instrumentationHook: true },
  // face-api.esm.js has a node-only conditional require() for the tfjs-node
  // backend that webpack can't statically resolve. We only ever load it via
  // dynamic import in the browser (lib/face-verify.ts), so that branch is dead.
  webpack: (config) => {
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /@vladmandic[\\/]face-api/ },
    ];
    return config;
  },
};

const sentryOptions = {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
};

const composed = pwaConfig(nextConfig);
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(composed, sentryOptions)
  : composed;
