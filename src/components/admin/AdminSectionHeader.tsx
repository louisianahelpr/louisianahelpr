import BackButton from "@/components/BackButton";

const AdminSectionHeader = ({ title, onBack }: { title: string; onBack: () => void }) => (
  <div className="mb-5 sm:mb-6 flex items-start gap-2">
    <BackButton onClick={onBack} />
    <div className="flex flex-col leading-none min-w-0">
      <h1
        // Montserrat, not Bodoni italic (M5). Admin is a moderation and
        // dispute queue — someone reads rows here for eight hours, and that
        // wants density and scanability rather than brand expression. The
        // editorial voice stops at the product boundary.
        className="font-sans font-semibold leading-tight truncate"
        style={{
          fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.85rem)",
          color: "hsl(var(--ink-deep))",
          letterSpacing: "-0.025em",
        }}
      >
        {title}
      </h1>
    </div>
  </div>
);

export default AdminSectionHeader;
