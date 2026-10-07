import type { Config } from "tailwindcss";

// Two colours that mean something and nothing else. Ultramarine is MUSD, the
// water in the pool. Bitcoin orange is BTC, the sediment a liquidation leaves
// behind. Everything else is ink on an off-white page.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "#f6f6f2",
        ink: {
          DEFAULT: "#0c0c0b",
          soft: "#3d3d39",
          mute: "#76766f",
          faint: "#b4b4ab",
          line: "#d9d9d0",
        },
        musd: {
          DEFAULT: "#1d36f5",
          deep: "#1226c4",
          pale: "#cdd4fd",
          mist: "#e7eafe",
        },
        btc: {
          DEFAULT: "#f7931a",
          deep: "#c96f00",
          pale: "#fde7c8",
        },
        stop: "#e0361b",
      },
      fontFamily: {
        sans: ["var(--font-archivo)", "system-ui", "sans-serif"],
      },
      keyframes: {
        swell: {
          "0%, 100%": { transform: "translateX(0)" },
          "50%": { transform: "translateX(-50px)" },
        },
        settle: {
          from: { transform: "translateY(-260px)", opacity: "0" },
          "70%": { opacity: "1" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        swell: "swell 7s ease-in-out infinite",
        settle: "settle 1.1s cubic-bezier(0.3, 0, 0.2, 1) both",
        rise: "rise 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
