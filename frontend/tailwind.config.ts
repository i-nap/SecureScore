import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Calm institutional light identity. Extends (does not replace) the
      // default palette so existing pages keep working during the rollout.
      colors: {
        canvas: "#F7F8FA",
        surface: "#FFFFFF",
        ink: {
          DEFAULT: "#11203A", // primary text / navy structure
          soft: "#43526B",    // secondary text
          faint: "#8A97AC",   // muted / captions
        },
        line: "#E6E9EF",      // hairline borders
        teal: {
          DEFAULT: "#0E7C66", // primary accent
          soft: "#E3F2EE",
          deep: "#0A5F4E",
        },
        gold: {
          DEFAULT: "#B8860B", // secondary accent
          soft: "#F7EFD9",
        },
        positive: "#0E7C66",
        caution: "#B8860B",
        danger: "#C0392B",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(17,32,58,0.04), 0 1px 3px rgba(17,32,58,0.06)",
        lift: "0 8px 24px -8px rgba(17,32,58,0.18)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.22,1,0.36,1) both",
        "fade-in": "fade-in 0.4s ease-out both",
        "scale-in": "scale-in 0.35s cubic-bezier(0.22,1,0.36,1) both",
      },
    },
  },
  plugins: [],
};
export default config;
