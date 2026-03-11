// Suggested pricing ranges per job category (based on typical market rates)
export const categoryPricing: Record<string, { min: number; max: number; label: string }> = {
  cleaning: { min: 25, max: 80, label: "Cleaning" },
  yard_work: { min: 30, max: 100, label: "Yard Work" },
  moving: { min: 50, max: 200, label: "Moving" },
  errands: { min: 15, max: 50, label: "Errands" },
  handyman: { min: 40, max: 150, label: "Handyman" },
  painting: { min: 50, max: 200, label: "Painting" },
  delivery: { min: 15, max: 60, label: "Delivery" },
  pet_care: { min: 20, max: 60, label: "Pet Care" },
  assembly: { min: 30, max: 120, label: "Assembly" },
  other: { min: 20, max: 100, label: "Other" },
};
