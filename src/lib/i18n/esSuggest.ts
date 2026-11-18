/** Spanish for enSuggest.ts (design audit r2 #37): "Suggest a category". */
import type { enSuggest } from "./enSuggest";

export const esSuggest: Record<keyof typeof enSuggest, string> = {
  "sug.link": "¿No ve la suya? Sugiera una categoría",
  "sug.title": "Sugerir una categoría",
  "sug.body": "Díganos qué falta y veremos cómo agregarla para todos. Puede elegir “Otro” y publicar ahora mismo.",
  "sug.name": "Nombre de la categoría",
  "sug.placeholder": "p. ej., Tutoría",
  "sug.max": "Hasta {n} caracteres.",
  "sug.cancel": "Cancelar",
  "sug.send": "Enviar sugerencia",
};
