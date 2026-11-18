import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    join(__dirname, "index.html").replaceAll("\\", "/"),
    join(__dirname, "src/**/*.{js,ts,jsx,tsx}").replaceAll("\\", "/"),
  ],
  theme: {
    extend: {
      colors: {
        cockpit: {
          bg: "#0B0F17",
          surface: "#161E2E",
          border: "#1F2937",
          accent: "#6366F1",
          text: "#F8FAFC",
          muted: "#94A3B8",
          success: "#10B981",
          warning: "#F59E0B",
          danger: "#EF4444",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
