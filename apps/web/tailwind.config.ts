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
      },
      fontFamily: {
        pixel: ["var(--font-pixel)", "monospace"],
        terminal: ["var(--font-terminal)", "monospace"],
      },
      boxShadow: {
        pixel: "4px 4px 0 #000",
      },
    },
  },
  plugins: [],
} satisfies Config;
