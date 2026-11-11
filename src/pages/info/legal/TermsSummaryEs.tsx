import { useContext } from "react";
import { Languages } from "lucide-react";
import { PolicySearchContext } from "@/components/policy/CollapsedPolicy";
import { DECLUTTER_BUYER_FEE_PERCENT, DECLUTTER_BUYER_FEE_FIXED_CENTS } from "@/lib/declutter/money";

/**
 * F260r (owner 11-11 ~2:10 PM, "Spanish everything"): a Spanish summary of the Terms, marked as a courtesy
 * translation. The English Terms stay the legal text; this card says so in its first line. It mirrors "The short
 * version" (TldrCard in TermsSection.tsx) point for point, with the same live inputs (the setup fee read from
 * platform_settings, the ID switch, the Declutter buyer's fee numbers checkout charges), so it never states a fee or
 * an ID rule the English does not.
 *
 * Always on the Terms tab (an English reader can find it too); open when the member or visitor has chosen Spanish.
 * Guard: src/test/termsSpanishSummary.test.tsx.
 */
export const COURTESY_NOTE_ES = "Traducción de cortesía. La versión en inglés de los Términos es la que rige.";

const buyerFeeEs = `${DECLUTTER_BUYER_FEE_PERCENT}% del precio del artículo más ${
  DECLUTTER_BUYER_FEE_FIXED_CENTS < 100 ? `${DECLUTTER_BUYER_FEE_FIXED_CENTS} centavos` : `$${(DECLUTTER_BUYER_FEE_FIXED_CENTS / 100).toFixed(2)}`
}`;

function termsSummaryEsItems({ idOn, feeLabel, posterPaysNothing }: { idOn: boolean; feeLabel: string | null; posterPaysNothing: boolean }): string[] {
  return [
    `Debe tener 18 años o más. Cada cuenta verifica su correo electrónico antes de publicar o aceptar trabajos.${
      idOn
        ? " También verifica una identificación con foto, una sola vez por cuenta: la primera vez que publica un trabajo, lo contratan o hace una entrega, publica un artículo o compra uno."
        : ""
    }`,
    "Helpr es un mercado: no hacemos los trabajos nosotros mismos y no somos responsables del trabajo entregado.",
    `${
      posterPaysNothing
        ? "No hay cargo por publicar cada trabajo: quien publica paga el precio del trabajo (y cualquier bono de urgencia que agregue) y nada más, salvo el impuesto sobre las ventas donde aplique y, una sola vez por cuenta, el cargo único de configuración de la cuenta."
        : "Quien publica paga el precio del trabajo más la tarifa de servicio que se muestra al pagar, antes de pagar."
    } Louisiana Helpr se queda con una tarifa de servicio de cada pago a un Helpr; un Helpr siempre ve cuánto va a recibir antes de postularse.`,
    `Cargo único de configuración de la cuenta${feeLabel ? `: ${feeLabel}` : ""}, una sola vez por cuenta. En Declutter, el comprador paga una tarifa de comprador de ${buyerFeeEs}, una vez por compra; el vendedor recibe el precio completo del artículo.`,
    "Las cancelaciones, las disputas y las reglas de conducta están en la pestaña Community Rules (Reglas de la comunidad) y forman parte de este acuerdo.",
    "Los Helprs son contratistas independientes, no empleados.",
    "Usted usa Helpr bajo su propio riesgo. Somos el mercado, no una parte de ningún trabajo: no somos responsables de pérdidas, robos, daños a la propiedad ni lesiones, y usted acepta indemnizarnos.",
  ];
}

export function TermsSummaryEs({ open, idOn, feeLabel, posterPaysNothing }: { open: boolean; idOn: boolean; feeLabel: string | null; posterPaysNothing: boolean }) {
  const query = useContext(PolicySearchContext);
  if (query.trim()) return null;
  return (
    <details lang="es" open={open} data-terms-summary-es="" className="rounded-[20px] border border-border bg-card p-5">
      <summary className="flex cursor-pointer items-center gap-2 text-ds-13 font-sans font-semibold min-h-11" style={{ color: "hsl(var(--ink-deep))" }}>
        <Languages className="w-4 h-4 shrink-0" aria-hidden style={{ color: "hsl(var(--bark))" }} />
        Resumen de los Términos en español
      </summary>
      <p className="mt-2 text-ds-13 font-sans font-semibold" data-courtesy-note="" style={{ color: "hsl(var(--ink-deep))" }}>
        {COURTESY_NOTE_ES}
      </p>
      <ul className="mt-3 space-y-1.5 text-ds-13 font-sans" style={{ color: "hsl(var(--ink-deep))" }}>
        {termsSummaryEsItems({ idOn, feeLabel, posterPaysNothing }).map((item) => (
          <li key={item} className="flex gap-2.5 leading-relaxed">
            <span className="shrink-0 w-1.5 h-1.5 rounded-full mt-[8px]" style={{ background: "hsl(var(--bark))" }} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
