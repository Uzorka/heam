import type { Config } from "tailwindcss";

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: token("background"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        border: token("border"),
        foreground: token("foreground"),
        muted: token("muted"),
        accent: { DEFAULT: token("accent"), foreground: token("accent-foreground"), soft: token("accent-soft") },
        danger: { DEFAULT: token("danger"), soft: token("danger-soft") },
        warning: { DEFAULT: token("warning"), soft: token("warning-soft") },
        success: { DEFAULT: token("success"), soft: token("success-soft") },
        info: { DEFAULT: token("info"), soft: token("info-soft") },
        ring: token("ring"),
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          '"Segoe UI"',
          "Inter",
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
        mono: ['"SF Mono"', "ui-monospace", "Menlo", "Consolas", "monospace"],
      },
      borderRadius: { lg: "12px", md: "8px", sm: "6px" },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.04)",
        pop: "0 8px 30px rgb(15 23 42 / 0.12)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        pulse: { "50%": { opacity: ".5" } },
      },
      animation: { "fade-in": "fade-in 120ms ease-out" },
    },
  },
  plugins: [],
} satisfies Config;
