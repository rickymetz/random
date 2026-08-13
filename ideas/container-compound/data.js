// Shared unit definitions for the Container Compound composer and the
// unit plan studio (plans/). Edit plans in the studio, export, and bake
// the settled layouts back into this file.

export const TYPES = [
  {
    id: "sleeping", name: "Sleeping unit", len: 20, wid: 8, color: 0x96a48e,
    cost: 29000, variant: "tunnel", hvac: "minisplit",
    desc: "Queen bed, wardrobe and a reading bench. Tunnel container: glazed door-walls at both ends give two exits and cross-ventilation.",
    va: "Both egress paths are outswing glazed doors inside factory apertures (VRC R310) — zero cuts.",
    furniture: [
      { x: -5.8, z: 0, w: 6.6, d: 5.2, h: 2.0, color: 0xd9cfc0 },        // bed
      { x: -9.2, z: -3.0, w: 1.4, d: 1.6, h: 2.0, color: 0x9c7c58 },     // nightstand
      { x: -9.2, z: 3.0, w: 1.4, d: 1.6, h: 2.0, color: 0x9c7c58 },      // nightstand
      { x: 7.5, z: -2.4, w: 4.0, d: 2.2, h: 6.6, color: 0x8a6f4f },      // wardrobe
      { x: 5.5, z: 2.9, w: 6.0, d: 1.6, h: 1.5, color: 0xb08d63 },       // bench
    ],
  },
  {
    id: "kitchen", name: "Kitchen unit", len: 20, wid: 8, color: 0xc9ac7f,
    cost: 38000, variant: "standard", wet: true, hvac: "minisplit",
    desc: "Full galley run with range and sink, tall fridge, pantry and a small eat-at counter. Supply and drains rise through the floor.",
    va: "Plumbing, gas and electrical need trade permits even under 256 sq ft.",
    furniture: [
      { x: -1.5, z: -2.9, w: 15.0, d: 2.2, h: 3.0, color: 0xdad2c4 },    // counter run
      { x: 8.4, z: -2.6, w: 2.6, d: 2.7, h: 6.6, color: 0xb9b3a7 },      // fridge
      { x: -8.4, z: -2.6, w: 2.6, d: 2.7, h: 6.6, color: 0x8a6f4f },     // pantry
      { x: 1.5, z: 2.4, w: 6.0, d: 2.2, h: 3.1, color: 0x9c7c58 },       // island / eat-at
    ],
  },
  {
    id: "bathhouse", name: "Bathhouse unit", len: 20, wid: 8, color: 0x7e97a6,
    cost: 37000, variant: "tunnel", wet: true, hvac: "panel",
    desc: "Two shower stalls, a soaking tub and a changing bench. Tunnel container so steam vents straight through with both door-walls open.",
    va: "Wet unit: plumbing permits and inspections apply; vented per VRC.",
    furniture: [
      { x: -8.2, z: -2.2, w: 3.2, d: 3.2, h: 7.0, color: 0xcfd8dc },     // shower 1
      { x: -8.2, z: 2.2, w: 3.2, d: 3.2, h: 7.0, color: 0xcfd8dc },      // shower 2
      { x: 3.0, z: -2.5, w: 6.0, d: 2.8, h: 2.0, color: 0xe8e4da },      // soaking tub
      { x: 4.0, z: 2.8, w: 7.0, d: 1.6, h: 1.5, color: 0xb08d63 },       // bench
    ],
  },
  {
    id: "bath-laundry", name: "Bath + laundry unit", len: 20, wid: 8, color: 0xa092a8,
    cost: 34000, variant: "standard", wet: true, hvac: "panel",
    desc: "Full bath on one end, washer-dryer pair and folding counter on the other. All water through the floor.",
    va: "Wet unit: plumbing and electrical permits apply.",
    furniture: [
      { x: -8.2, z: -2.2, w: 3.2, d: 3.2, h: 7.0, color: 0xcfd8dc },     // shower
      { x: -8.6, z: 2.6, w: 1.6, d: 2.4, h: 1.4, color: 0xf2efe8 },      // toilet
      { x: -4.6, z: -2.8, w: 3.2, d: 1.8, h: 3.0, color: 0xdad2c4 },     // vanity
      { x: 6.0, z: -2.7, w: 2.4, d: 2.4, h: 3.2, color: 0xe8e6e0 },      // washer
      { x: 8.6, z: -2.7, w: 2.4, d: 2.4, h: 3.2, color: 0xe8e6e0 },      // dryer
      { x: 6.5, z: 2.8, w: 6.0, d: 1.8, h: 3.0, color: 0x9c7c58 },       // folding counter
    ],
  },
  {
    id: "dining", name: "Dining unit", len: 20, wid: 8, color: 0xb78d7b,
    cost: 24000, variant: "openside", hvac: "minisplit",
    desc: "A table for eight and a sideboard. Open-side container: the factory side doors become a full glazed wall that spills onto a deck.",
    va: "Unplumbed gathering space — simplest permit path of the set.",
    furniture: [
      { x: 0, z: 0, w: 9.0, d: 3.4, h: 2.5, color: 0x9c7c58 },           // table
      { x: -3.4, z: 2.6, w: 1.5, d: 1.5, h: 1.5, color: 0xd9cfc0 },
      { x: 0, z: 2.6, w: 1.5, d: 1.5, h: 1.5, color: 0xd9cfc0 },
      { x: 3.4, z: 2.6, w: 1.5, d: 1.5, h: 1.5, color: 0xd9cfc0 },
      { x: -3.4, z: -2.6, w: 1.5, d: 1.5, h: 1.5, color: 0xd9cfc0 },
      { x: 0, z: -2.6, w: 1.5, d: 1.5, h: 1.5, color: 0xd9cfc0 },
      { x: 3.4, z: -2.6, w: 1.5, d: 1.5, h: 1.5, color: 0xd9cfc0 },
      { x: 8.6, z: 0, w: 1.8, d: 5.0, h: 3.0, color: 0x8a6f4f },         // sideboard
    ],
  },
  {
    id: "living", name: "Living unit", len: 20, wid: 8, color: 0xa5a184,
    cost: 26000, variant: "openside", hvac: "minisplit",
    desc: "Deep sofa, media wall and a small wood stove behind an open-side glazed wall — the den.",
    va: "Solid-fuel stove needs mechanical permit + clearances (VRC ch. 10); flue uses the factory vent position, not a new roof cut.",
    furniture: [
      { x: -3.0, z: -2.3, w: 7.5, d: 3.0, h: 2.2, color: 0xd9cfc0 },     // sofa
      { x: -3.0, z: 1.6, w: 4.0, d: 2.0, h: 1.4, color: 0x9c7c58 },      // coffee table
      { x: 4.5, z: 2.8, w: 6.0, d: 1.5, h: 2.0, color: 0x8a6f4f },       // media console
      { x: 8.5, z: -2.6, w: 1.8, d: 1.8, h: 4.0, color: 0x4a4a48 },      // wood stove
    ],
  },
  {
    id: "bathroom", name: "Bathroom unit", len: 10, wid: 8, color: 0x8fa0ad,
    cost: 17000, variant: "standard", wet: true, hvac: "panel",
    desc: "Compact three-fixture bath in a mini: shower, toilet, vanity. Drains drop straight through the floor.",
    va: "Wet unit: plumbing permits apply. 80 sq ft, one story.",
    furniture: [
      { x: -3.0, z: -1.9, w: 3.2, d: 3.2, h: 7.0, color: 0xcfd8dc },     // shower
      { x: 3.4, z: -2.4, w: 1.6, d: 2.4, h: 1.4, color: 0xf2efe8 },      // toilet
      { x: 2.6, z: 2.7, w: 3.4, d: 1.8, h: 3.0, color: 0xdad2c4 },       // vanity
    ],
  },
  {
    id: "laundry", name: "Laundry / utility unit", len: 10, wid: 8, color: 0xb0a08d,
    cost: 15000, variant: "standard", hvac: "panel", core: true,
    desc: "Washer, dryer, water heater and the compound's mechanical closet — the utility core. Wet units want to sit inside its ring.",
    va: "Houses water heater + panel; trade permits apply.",
    furniture: [
      { x: -3.2, z: -2.5, w: 2.4, d: 2.4, h: 3.2, color: 0xe8e6e0 },     // washer
      { x: -0.6, z: -2.5, w: 2.4, d: 2.4, h: 3.2, color: 0xe8e6e0 },     // dryer
      { x: 3.4, z: -2.3, w: 2.0, d: 2.0, h: 5.0, color: 0xbdb8ae },      // water heater
      { x: 0.5, z: 2.8, w: 7.0, d: 1.4, h: 6.0, color: 0x8a6f4f },       // shelving
    ],
  },
  {
    id: "office", name: "Office / studio unit", len: 20, wid: 8, color: 0x8fa695,
    cost: 24000, variant: "standard", hvac: "minisplit",
    desc: "Desk facing the glazed door-wall, a bookshelf wall and a reading corner. Sized up to a 20' box to clear the habitable-room minimum.",
    va: "Habitable space: ~131 sq ft interior clears VRC R304.1's 70 sq ft minimum.",
    furniture: [
      { x: 6.2, z: 0, w: 2.5, d: 5.5, h: 2.5, color: 0x9c7c58 },         // desk facing the glazed end
      { x: 3.8, z: 0, w: 1.7, d: 1.7, h: 1.6, color: 0x6b6b66 },         // chair
      { x: -2.0, z: -2.9, w: 9.0, d: 1.3, h: 6.6, color: 0x8a6f4f },     // bookshelf wall
      { x: -6.5, z: 2.3, w: 2.6, d: 2.6, h: 2.0, color: 0xd9cfc0 },      // reading chair
      { x: -8.8, z: -1.0, w: 1.6, d: 2.2, h: 3.0, color: 0x9c7c58 },     // cabinet
    ],
  },
  {
    id: "hobby", name: "Hobby / storage unit", len: 10, wid: 8, color: 0x8d919c,
    cost: 12000, variant: "standard", hvac: "none",
    desc: "Workbench, deep shelving and gear storage in a mini — deliberately non-habitable, so the small interior is fine by code.",
    va: "Not habitable space, so VRC R304's 70 sq ft / 7 ft minimums don't apply.",
    furniture: [
      { x: -2.6, z: -2.6, w: 3.6, d: 2.2, h: 3.0, color: 0x9c7c58 },     // workbench
      { x: 2.6, z: -2.7, w: 3.4, d: 1.4, h: 6.0, color: 0x8a6f4f },      // shelving
      { x: 0.6, z: 2.6, w: 5.5, d: 1.6, h: 2.2, color: 0xbdb8ae },       // bins
    ],
  },
  {
    id: "deck", name: "Deck section", len: 8, wid: 8, color: 0xb78e5f,
    cost: 1200, deck: true,
    desc: "8×8 ground-level wood platform. Chain them to link units into one compound.",
    va: "Decks under 30\" above grade are exempt from permits (VRC R105.2).",
    furniture: [],
  },
];

// index-aligned with each type's furniture array
export const PLAN_LABELS = {
  sleeping: ["bed", "", "", "wardrobe", "bench"],
  kitchen: ["counter run", "fridge", "pantry", "island"],
  bathhouse: ["shower", "shower", "soaking tub", "bench"],
  "bath-laundry": ["shower", "WC", "vanity", "washer", "dryer", "counter"],
  dining: ["table", "", "", "", "", "", "", "sideboard"],
  living: ["sofa", "table", "media", "stove"],
  bathroom: ["shower", "WC", "vanity"],
  laundry: ["washer", "dryer", "WH", "shelving"],
  office: ["desk", "", "bookshelves", "chair", "cab"],
  hobby: ["workbench", "shelving", "bins"],
};
