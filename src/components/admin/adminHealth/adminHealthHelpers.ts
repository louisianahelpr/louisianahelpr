export const formatDelay = (mins: number | null): string => {
  if (mins === null) return "—";
  if (mins < 60) return `${Math.round(mins)} min`;
  if (mins < 60 * 24) return `${(mins / 60).toFixed(1)} h`;
  return `${(mins / 60 / 24).toFixed(1)} d`;
};
