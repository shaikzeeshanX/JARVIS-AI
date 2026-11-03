import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        void: "#05070d",
        panel: "#0a0e17",
        edge: "#16202f",
        arc: {
          dim: "#0a5a8f",
          DEFAULT: "#0fa3ff",
          bright: "#5cc8ff",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(15, 163, 255, 0.25)",
        "glow-strong": "0 0 48px rgba(15, 163, 255, 0.4)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        // JARVIS zooms in and out while answering — a quick, living pulse.
        breathe: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.09)" },
        },
        // While the voice is speaking: a deeper, slightly quicker zoom so the
        // cube visibly "talks" with JARVIS.
        speak: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.14)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s ease-out both",
        "pulse-soft": "pulse-soft 2.2s ease-in-out infinite",
        breathe: "breathe 1.5s ease-in-out infinite",
        speak: "speak 0.9s ease-in-out infinite",
      },
    },
  },
  plugins: [],
}

export default config
