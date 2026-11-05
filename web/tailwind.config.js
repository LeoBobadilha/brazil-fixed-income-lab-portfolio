/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        plane: "var(--plane)", surface: "var(--surface-1)", surface2: "var(--surface-2)",
        ink: "var(--text-primary)", ink2: "var(--text-secondary)", muted: "var(--text-muted)",
        line: "var(--gridline)", edge: "var(--border)", accent: "var(--accent)",
        nominal: "var(--series-nominal)", real: "var(--series-real)", floating: "var(--series-floating)",
        ntnb1: "var(--series-ntnb1)", good: "var(--status-good)", warn: "var(--status-warning)", bad: "var(--status-critical)",
      },
      fontFamily: { sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"] },
      maxWidth: { page: "1320px" },
    },
  },
  plugins: [],
};
