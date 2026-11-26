/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--bg-canvas) / <alpha-value>)",
        surface: "rgb(var(--bg-surface) / <alpha-value>)",
        elevated: "rgb(var(--bg-elevated) / <alpha-value>)",
        hover: "rgb(var(--bg-hover) / <alpha-value>)",
        line: "rgb(var(--border-subtle) / <alpha-value>)",
        "line-strong": "rgb(var(--border-strong) / <alpha-value>)",
        ink: "rgb(var(--text-primary) / <alpha-value>)",
        "ink-secondary": "rgb(var(--text-secondary) / <alpha-value>)",
        "ink-muted": "rgb(var(--text-muted) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-fg": "rgb(var(--accent-fg) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
      },
      fontFamily: {
        sans: [
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        serif: [
          '"Noto Serif SC"',
          '"Source Han Serif SC"',
          "Georgia",
          "serif",
        ],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
