export interface MaterialItem {
  name: string;           // "Moving boxes (25-pack)"
  estimatedCost: string;  // "$18–$25"
  searchUrl: string;      // Amazon search URL
  icon: string;           // lucide icon name as string for dynamic lookup
}

export const categoryMaterials: Record<string, MaterialItem[]> = {
  moving: [
    { name: "Moving boxes (25-pack)", estimatedCost: "$18–$28", searchUrl: "https://www.amazon.com/s?k=moving+boxes+25+pack", icon: "Package" },
    { name: "Packing tape (6-pack)", estimatedCost: "$12–$18", searchUrl: "https://www.amazon.com/s?k=packing+tape+6+pack", icon: "Layers" },
    { name: "Bubble wrap roll", estimatedCost: "$15–$25", searchUrl: "https://www.amazon.com/s?k=bubble+wrap+roll", icon: "Circle" },
    { name: "Mattress bag (queen)", estimatedCost: "$8–$15", searchUrl: "https://www.amazon.com/s?k=mattress+bag+moving+queen", icon: "Maximize" },
  ],
  assembly: [
    { name: "Electric screwdriver", estimatedCost: "$25–$45", searchUrl: "https://www.amazon.com/s?k=electric+screwdriver+cordless", icon: "Zap" },
    { name: "Wall anchor kit", estimatedCost: "$8–$15", searchUrl: "https://www.amazon.com/s?k=wall+anchor+kit", icon: "Anchor" },
  ],
  cleaning: [
    { name: "All-purpose cleaner spray", estimatedCost: "$5–$10", searchUrl: "https://www.amazon.com/s?k=all+purpose+cleaner+spray", icon: "Droplets" },
    { name: "Microfiber cloths (12-pack)", estimatedCost: "$10–$18", searchUrl: "https://www.amazon.com/s?k=microfiber+cloths+12+pack", icon: "Wind" },
  ],
  painting: [
    { name: "Painter's tape (3-pack)", estimatedCost: "$12–$20", searchUrl: "https://www.amazon.com/s?k=painters+tape+blue+3+pack", icon: "Minus" },
    { name: "Drop cloth (canvas)", estimatedCost: "$15–$30", searchUrl: "https://www.amazon.com/s?k=canvas+drop+cloth", icon: "Shield" },
    { name: "Paint roller kit", estimatedCost: "$15–$25", searchUrl: "https://www.amazon.com/s?k=paint+roller+kit+frame+cover", icon: "Paintbrush" },
  ],
  yard_work: [
    { name: "Heavy-duty trash bags (50-count)", estimatedCost: "$12–$18", searchUrl: "https://www.amazon.com/s?k=heavy+duty+trash+bags+outdoor+50", icon: "Trash2" },
    { name: "Garden gloves", estimatedCost: "$8–$15", searchUrl: "https://www.amazon.com/s?k=garden+work+gloves", icon: "Hand" },
  ],
  handyman: [
    { name: "Drywall patch kit", estimatedCost: "$10–$20", searchUrl: "https://www.amazon.com/s?k=drywall+patch+kit", icon: "Square" },
    { name: "Caulk gun + caulk", estimatedCost: "$12–$20", searchUrl: "https://www.amazon.com/s?k=caulk+gun+and+caulk+kit", icon: "PenLine" },
  ],
  storm_prep: [
    { name: "Sandbags (10-pack)", estimatedCost: "$20–$35", searchUrl: "https://www.amazon.com/s?k=sandbags+flood+10+pack", icon: "Shield" },
    { name: "Tarp (heavy duty, 20x30)", estimatedCost: "$25–$45", searchUrl: "https://www.amazon.com/s?k=heavy+duty+tarp+20x30", icon: "Cloud" },
    { name: "Plywood screws (1 lb box)", estimatedCost: "$8–$12", searchUrl: "https://www.amazon.com/s?k=plywood+screws+1lb", icon: "Wrench" },
  ],
};
