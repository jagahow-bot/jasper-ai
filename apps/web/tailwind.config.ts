import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        neon: "var(--neon)",
        "neon-cyan": "var(--cyan)",
        "neon-magenta": "var(--magenta)",
        "neon-amber": "var(--amber)",
        primary: "var(--primary)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        pixel: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        terminal: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        pixel: "0 1px 2px rgba(15, 23, 42, 0.05)",
      },
    },
  },
  plugins: [],
} satisfies Config;
