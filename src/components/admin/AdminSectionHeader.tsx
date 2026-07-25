import BackButton from "@/components/BackButton";

const AdminSectionHeader = ({ title, onBack }: { title: string; onBack: () => void }) => (
  <div className="mb-5 sm:mb-6 flex items-start gap-2">
    <BackButton onClick={onBack} />
    <div className="flex flex-col leading-none min-w-0">
      <h1
        className="font-display italic font-bold leading-tight truncate"
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
