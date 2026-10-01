/** @type {import('tailwindcss').Config} */
module.exports = {
  // 深色走系统通道（Tailwind 默认 darkMode:'media'），**不要**写 darkMode:['class'] + safelist:['dark']：
  // 那是 web（html 挂 .dark 类）的形态，RN 没有 documentElement 可挂，`dark:` 变体会全部失效。
  // 深色令牌本身见 src/global.css 的 @media (prefers-color-scheme: dark) 段。
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        // 风险语义色四档（05d §7-5）：`text-risk-l1` / `border-risk-l1` 走实色，浅底走 `bg-risk-l1-tint`。
        // 不要写 `bg-risk-l1/10`——本文件的令牌全是 var 纯串，带 alpha 的类整条不落进产物（README 同名坑）。
        "risk-l1": { DEFAULT: "var(--risk-l1)", tint: "var(--risk-l1-tint)" },
        "risk-l2": { DEFAULT: "var(--risk-l2)", tint: "var(--risk-l2-tint)" },
        "risk-l3": { DEFAULT: "var(--risk-l3)", tint: "var(--risk-l3-tint)" },
        "risk-l4": { DEFAULT: "var(--risk-l4)", tint: "var(--risk-l4-tint)" },
      },
      borderRadius: {
        "4xl": "2rem",
        "3xl": "1.5rem",
        "2xl": "1rem",
        xl: "0.75rem",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};
