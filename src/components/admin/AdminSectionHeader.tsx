import BackButton from "@/components/BackButton";

// gap-3, matching PageHeader and ProfileTabHeader — the project standard names
// `flex items-center gap-3` (or items-start for a tall title stack) as THE
// back+title row. This was the only one of the three at gap-2, so the chevron
// sat 4px closer to its title in admin than it does everywhere else.
// `items-start` stays: this header's title stack carries an eyebrow.
const AdminSectionHeader = ({ title, onBack }: { title: string; onBack: () => void }) => (
  <div className="mb-5 sm:mb-6 flex items-start gap-3">
    <BackButton onClick={onBack} />
    <div className="flex flex-col leading-none min-w-0">
      <h1
        // THE SAME TITLE TYPE AS EVERY OTHER SCREEN — `font-display font-bold
        // text-ds-20`, verbatim from ScreenHeaderRow (owner: "title fonts are
        // not correct in admin").
        //
        // This deliberately reverses an earlier call that set admin in
        // Montserrat, on the reasoning that a moderation queue wants density
        // rather than brand expression and "the editorial voice stops at the
        // product boundary". The owner has drawn that boundary somewhere else:
        // admin is the same product, wearing the same chrome — which is the
        // same instruction that moved this console's top bar and rail onto the
        // app's own pattern. A different heading face was the last thing
        // announcing it as a separate application.
        className="font-display font-bold leading-tight truncate text-ds-20"
        style={{
          color: "hsl(var(--ink-deep))",
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </h1>
    </div>
  </div>
);

export default AdminSectionHeader;
