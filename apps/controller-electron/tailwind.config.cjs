/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#0b84ff",
          dark: "#0068d6",
        },
        surface: {
          50:  "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          700: "#2f4460",
          800: "#1b2d44",
          900: "#102238",
          950: "#091a2d",
        },
        accent: {
          DEFAULT: "#4cc6ff",
          muted: "#2399e3",
        },
        danger: "#ef4444",
        success: "#22c55e",
        warn: "#f59e0b",
      },
      fontFamily: {
        sans: ["Manrope", "Segoe UI", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl2: "1rem",
        xl3: "1.5rem",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
