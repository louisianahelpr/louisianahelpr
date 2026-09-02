import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Settings, FileText, FileSpreadsheet, ChevronRight, Printer } from "lucide-react";
import { canPrintDocument } from "@/lib/fileExport";

interface EarningsToolsMenuProps {
  onExportPdf: () => void;
  onExportCsv: () => void;
  onNavigatePayment: () => void;
}

export function EarningsToolsMenu({ onExportPdf, onExportCsv, onNavigatePayment }: EarningsToolsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-ds-sm hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Earnings settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-ds-11">Earnings tools</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onExportPdf}>
          <FileText className="w-4 h-4 mr-2" /> Export for Taxes (PDF)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onExportCsv}>
          <FileSpreadsheet className="w-4 h-4 mr-2" /> Export Payouts CSV
        </DropdownMenuItem>
        {/* Lightweight "save as PDF" path — opens the browser print dialog.
            ONLY WHERE A PRINT DIALOG EXISTS. The comment that used to sit here
            claimed this was "useful on iOS, where Safari can save the print
            preview as a PDF" — but this menu does not run in Safari. It runs in
            WKWebView (Capacitor serves bundled dist/, and an iOS home-screen
            install is `display: standalone`), and neither ships any print UI,
            so `window.print()` returned without doing anything: a menu item
            that promised a printer that isn't there. WorkRecord.tsx hit and
            documented this first and answers it the same way — don't render the
            control. On native, "Export for Taxes (PDF)" directly above produces
            the same PDF and now hands it to the OS share sheet, so nothing is
            lost by hiding this. See `canPrintDocument` in src/lib/fileExport.ts. */}
        {canPrintDocument && (
          <DropdownMenuItem onSelect={() => { window.print(); }}>
            <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {/* Scrolls to the Payout & payments section of THIS screen — so no
            ExternalLink icon and no "Stripe Dashboard" name, both of which
            promised leaving the app (the ↗ affordance is reserved for
            actions that actually do). */}
        <DropdownMenuItem onSelect={onNavigatePayment}>
          <ChevronRight className="w-4 h-4 mr-2" /> Payout Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
