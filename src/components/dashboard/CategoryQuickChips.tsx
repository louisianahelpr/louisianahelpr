import {
  Sparkles, Trees, Truck, ShoppingBag, Wrench, Brush, Package,
  PawPrint, PackageOpen, Heart,
} from "lucide-react";

const CATEGORIES = [
  { value: "cleaning", label: "Cleaning", icon: Sparkles },
  { value: "yard_work", label: "Yard work", icon: Trees },
  { value: "moving", label: "Moving", icon: Truck },
  { value: "errands", label: "Errands", icon: ShoppingBag },
  { value: "handyman", label: "Handyman", icon: Wrench },
  { value: "painting", label: "Painting", icon: Brush },
  { value: "delivery", label: "Delivery", icon: Package },
  { value: "pet_care", label: "Pet care", icon: PawPrint },
  { value: "assembly", label: "Assembly", icon: PackageOpen },
  { value: "other", label: "Other", icon: Heart },
] as const;

interface Props {
  selected: string | null;
  onSelect: (value: string | null) => void;
}

const CategoryQuickChips = ({ selected, onSelect }: Props) => (
  <div className="-mx-5 px-5 overflow-x-auto scrollbar-hide">
    <div className="flex items-center gap-2 py-1">
      {CATEGORIES.map(({ value, label, icon: Icon }) => {
        const active = selected === value;
        return (
          <button
            key={value}
            onClick={() => onSelect(active ? null : value)}
            className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full transition-all active:scale-95"
            style={
              active
                ? {
                    background: "hsl(var(--bark))",
                    color: "hsl(var(--parchment))",
                    border: "1px solid hsl(var(--bark))",
                    boxShadow: "0 1px 2px hsl(var(--olivewood) / 0.08), 0 8px 18px -6px hsl(var(--bark) / 0.45)",
                  }
                : {
                    backgroundColor: "hsla(0, 0%, 100%, 0.42)",
                    backdropFilter: "blur(20px) saturate(170%)",
                    WebkitBackdropFilter: "blur(20px) saturate(170%)",
                    border: "1px solid hsla(0, 0%, 100%, 0.55)",
                    color: "hsl(var(--ink-deep))",
                    boxShadow: "inset 0 1px 0 0 hsla(0, 0%, 100%, 0.7)",
                  }
            }
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={2} />
            <span className="font-sans font-medium tracking-tight" style={{ fontSize: "0.78rem" }}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  </div>
);

export default CategoryQuickChips;
