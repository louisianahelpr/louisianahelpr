/** Spanish for enTracker.ts (F260q): the job tracker's step button. "Ya llegué" matches Home's To-do button. */
import type { enTracker } from "./enTracker";

export const esTracker: Record<keyof typeof enTracker, string> = {
  "trk.act.confirmed": "Ya acepté",
  "trk.act.job_confirmed": "Confirmar este trabajo",
  "trk.act.on_the_way": "Voy en camino",
  "trk.act.arrived": "Ya llegué",
  "trk.act.working": "Empezar a trabajar",
  "trk.act.done": "Marcarlo como hecho",
  "trk.retryLocation": "Intentar mi ubicación otra vez",
};
