import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
        display: ["Fraunces", "serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // 2026 radii system — use these for new components
        "ds-sm": "8px",   // small components: chips, tags, inline buttons
        "ds-md": "14px",  // cards, list items
        "ds-lg": "20px",  // sheets, modals
        "ds-pill": "28px", // full pills
      },
      // 2026 type scale — use text-ds-* for new components
      fontSize: {
        "ds-11": ["11px", { lineHeight: "1.45", letterSpacing: "0" }],
        "ds-13": ["13px", { lineHeight: "1.45", letterSpacing: "0" }],
        "ds-15": ["15px", { lineHeight: "1.5", letterSpacing: "0" }],
        "ds-17": ["17px", { lineHeight: "1.5", letterSpacing: "0" }],
        "ds-20": ["20px", { lineHeight: "1.3", letterSpacing: "-0.02em" }],
        "ds-24": ["24px", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
        "ds-32": ["32px", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        "ds-40": ["40px", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
      },
      // 4pt grid spacing — additive to Tailwind's defaults
      spacing: {
        "ds-1": "4px",
        "ds-2": "8px",
        "ds-3": "12px",
        "ds-4": "16px",
        "ds-5": "20px",
        "ds-6": "24px",
        "ds-8": "32px",
        "ds-10": "40px",
        "ds-12": "48px",
      },
      transitionTimingFunction: {
        "ds-out": "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "ds-page-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.6s ease-out forwards",
        "ds-page-in": "ds-page-in 280ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
