import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a full name as "First L." for privacy. */
export function formatName(fullName: string | null | undefined, fallback = "User"): string {
  const name = (fullName || fallback).trim();
  const parts = name.split(/\s+/);
  if (parts.length > 1) {
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  }
  return parts[0];
}
