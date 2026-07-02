// ---------------------------------------------------------------------------
// Types (derived from DB schema — keep in sync with migration)
// ---------------------------------------------------------------------------
export type Platform = "airbnb" | "vrbo" | "booking_com" | "other";

export const PLATFORM_LABELS: Record<Platform, string> = {
  airbnb: "Airbnb",
  vrbo: "VRBO",
  booking_com: "Booking.com",
  other: "Other",
};

export interface StrConnection {
  id: string;
  platform: Platform;
  ical_url: string;
  property_name: string | null;
  property_address: string | null;
  auto_create_cleaning: boolean;
  cleaning_budget: number | null;
  cleaning_notes: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
  is_active: boolean;
}

export const PLATFORM_HELP: Record<Platform, string> = {
  airbnb: "https://www.airbnb.com/help/article/99/can-i-export-my-reservations-to-another-calendar",
  vrbo: "https://help.vrbo.com/en-us/articles/360021264494",
  booking_com: "https://partner.booking.com/en-gb/help/other-help-topics/how-do-i-export-my-bookings-to-third-party-calendar",
  other: "",
};

export interface AddFormState {
  platform: Platform;
  ical_url: string;
  property_name: string;
  property_address: string;
  auto_create_cleaning: boolean;
  cleaning_budget: string;
  cleaning_notes: string;
}

export const EMPTY_FORM: AddFormState = {
  platform: "airbnb",
  ical_url: "",
  property_name: "",
  property_address: "",
  auto_create_cleaning: true,
  cleaning_budget: "80",
  cleaning_notes: "",
};
