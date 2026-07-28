import type { Config } from "tailwindcss";

export default {
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  // Key `dark:` utilities off the `[data-theme="dark"]` attribute that
  // useDarkMode sets on <html>, NOT the default `prefers-color-scheme`
  // media query. The CSS-variable tokens in index.css already flip on that
  // attribute; without this the `dark:` utilities would track the OS instead
  // of the user's saved choice, so a manual Light/Dark override would desync
  // the two layers (utilities stuck on the OS theme, tokens on the picked one).
  darkMode: ["selector", '[data-theme="dark"]'],
  // This is a touch-first Capacitor app. Without this flag Tailwind's
  // `hover:` styles compile to plain `:hover`, which STICKS after a tap on
  // touch devices — e.g. the toolbar's ghost buttons (`hover:bg-secondary`,
  // secondary = sand) leave a tan square highlighted on the map/search/
  // filter control after you tap it. Gating hover behind `@media (hover:
  // hover)` means hover affordances only apply with a real pointer, so taps
  // never leave a stuck highlight. Fixes the class of "selected looks tan/
  // cream" artifacts across the whole app at the root.
  future: {
    hoverOnlyWhenSupported: true,
  },
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
        // Brand system (Louisiana Helpr, 2026):
        //   - Display: Bodoni Moda (architectural authority — large hero headlines)
        //   - Serif:   EB Garamond (timeless trustworthy — body text)
        //   - Sans:    Montserrat (modern professional — UI + buttons)
        //   - Script:  Beth Ellen (personal authentic — micro-accents / signatures)
        sans: ["Montserrat", "system-ui", "-apple-system", "sans-serif"],
        display: ["\"Bodoni Moda\"", "Georgia", "serif"],
        serif: ["\"EB Garamond\"", "Georgia", "Cambria", "serif"],
        script: ["\"Beth Ellen\"", "cursive"],
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
        // Semantic color tokens
        success: "hsl(var(--success))",
        "success-foreground": "hsl(var(--success-foreground))",
        warning: "hsl(var(--warning))",
        "warning-foreground": "hsl(var(--warning-foreground))",
        error: "hsl(var(--error))",
        "error-foreground": "hsl(var(--error-foreground))",
        info: "hsl(var(--info))",
        "info-foreground": "hsl(var(--info-foreground))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Design system radii
        "ds-sm": "8px",
        "ds-md": "14px",
        "ds-lg": "20px",
        "ds-pill": "28px",
      },
      fontSize: {
        "ds-9": ["9px", { lineHeight: "1.45", letterSpacing: "0.04em" }],
        "ds-10": ["10px", { lineHeight: "1.45", letterSpacing: "0.02em" }],
        "ds-11": ["11px", { lineHeight: "1.45", letterSpacing: "0" }],
        "ds-12": ["12px", { lineHeight: "1.45", letterSpacing: "0" }],
        "ds-13": ["13px", { lineHeight: "1.45", letterSpacing: "0" }],
        "ds-14": ["14px", { lineHeight: "1.45", letterSpacing: "0" }],
        "ds-15": ["15px", { lineHeight: "1.5", letterSpacing: "0" }],
        "ds-16": ["16px", { lineHeight: "1.5", letterSpacing: "0" }],
        "ds-17": ["17px", { lineHeight: "1.5", letterSpacing: "0" }],
        "ds-18": ["18px", { lineHeight: "1.4", letterSpacing: "-0.01em" }],
        "ds-20": ["20px", { lineHeight: "1.3", letterSpacing: "-0.02em" }],
        "ds-22": ["22px", { lineHeight: "1.25", letterSpacing: "-0.02em" }],
        "ds-24": ["24px", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
        "ds-26": ["26px", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
        "ds-28": ["28px", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        "ds-32": ["32px", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        "ds-40": ["40px", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
      },
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
        "safe-top": "env(safe-area-inset-top)",
        "safe-bottom": "env(safe-area-inset-bottom)",
        "safe-left": "env(safe-area-inset-left)",
        "safe-right": "env(safe-area-inset-right)",
        // Bottom clearance for content above the floating MobileNav dock + FAB
        // (96px dock/FAB height + 1rem breathing room) plus the iOS safe-area
        // inset. Consumed via `pb-safe-nav` on full-scroll pages.
        //
        // The dock height is a VARIABLE, not a literal, so it can collapse to 0
        // in the one case where no dock is rendered: signed-out visitors. 22
        // files use `pb-safe-nav`; without this they would each reserve ~112px
        // of empty space below the last element on every guest page. See
        // `html.no-bottom-nav` in index.css.
        "safe-nav": "calc(env(safe-area-inset-bottom, 0px) + var(--bottom-nav-h, 96px) + 1rem)",
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
        "float-slow": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "float-slower": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-14px)" },
        },
        // Instagram-style double-tap heart: pops in over-scale, settles,
        // then fades + drifts up. Centered overlay, runs once (~600ms).
        "heart-pop": {
          "0%": { opacity: "0", transform: "translate(-50%, -50%) scale(0.3)" },
          "15%": { opacity: "1", transform: "translate(-50%, -50%) scale(1.25)" },
          "30%": { opacity: "1", transform: "translate(-50%, -50%) scale(0.92)" },
          "45%": { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
          "100%": { opacity: "0", transform: "translate(-50%, -58%) scale(1)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.6s ease-out forwards",
        "ds-page-in": "ds-page-in 280ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "float-slow": "float-slow 5s ease-in-out infinite",
        "float-slower": "float-slower 7s ease-in-out infinite",
        "heart-pop": "heart-pop 600ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;