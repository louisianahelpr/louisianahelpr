import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Brand-aligned toast styling — translucent parchment surface with
// olivewood hairline border, font-serif italic body, and stage-tinted
// icon colors (bark for success, sienna for error/warning).
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            "group toast !rounded-2xl !border-0 !shadow-[0_1px_2px_hsl(var(--olivewood)/0.06),0_14px_30px_-8px_hsl(var(--olivewood)/0.20)] !text-[hsl(var(--ink-deep))] !font-serif !italic !text-[0.88rem] !leading-snug !backdrop-blur-[18px] !backdrop-saturate-[160%] before:absolute before:inset-0 before:rounded-2xl before:border before:border-[hsl(var(--olivewood)/0.12)] before:pointer-events-none",
          title: "!font-display !italic !font-bold !not-[font-serif] !text-[0.95rem] !leading-tight !text-[hsl(var(--ink-deep))]",
          description: "!font-serif !italic !text-[0.78rem] !text-[hsl(var(--olivewood)/0.78)]",
          actionButton:
            "!bg-[hsl(var(--bark))] !text-[hsl(var(--parchment))] !font-sans !font-semibold !rounded-full !px-3 !h-8",
          cancelButton:
            "!bg-transparent !text-[hsl(var(--olivewood)/0.75)] !font-sans !font-semibold !rounded-full !px-3 !h-8",
          success: "!bg-[hsl(var(--parchment)/0.96)] [&_[data-icon]]:!text-[hsl(var(--bark))]",
          error: "!bg-[hsl(var(--parchment)/0.96)] [&_[data-icon]]:!text-[hsl(var(--burnt-sienna))]",
          warning: "!bg-[hsl(var(--parchment)/0.96)] [&_[data-icon]]:!text-[hsl(var(--gold-warm))]",
          info: "!bg-[hsl(var(--parchment)/0.96)] [&_[data-icon]]:!text-[hsl(var(--bark))]",
          default: "!bg-[hsl(var(--parchment)/0.96)]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
