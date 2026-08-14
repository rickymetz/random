// Shared unit definitions for the Container Compound composer and the
// unit plan studio (plans/). Edit plans in the studio, export, and bake
// the settled layouts back into this file.
//
// Layout rules (from the VRC + ergonomics review):
// - Finished interior after spray foam: 7'2" wide -> walls at z = ±3.55.
// - 20' units: usable x in [-9.3, +8.8] (tunnels: ±8.8). Minis: [-4.3, +3.7].
// - Entry-door approach (z -3.1..-0.1, ~3 ft deep) stays clear at every
//   DOOR end. Tunnel units may fill one aperture with a glazed window wall
//   instead of a door (ends: ["door"|"window" at +x, same at -x]) — a
//   window end needs no approach, freeing the layout against that wall.
// - Water closets: centerline >= 15" from any side wall, 21" clear in front
//   (VRC ch.27 / IRC R307). Showers >= 30"x30".
// - Kitchen aisle >= 36", bed gets one >= 23" side aisle, sofa-to-table
//   14-18", stove on a hearth pad with a listed-shield note.

export const TYPES = [
  {
    id: "sleeping", name: "Sleeping unit", len: 20, wid: 8, color: 0x96a48e,
    cost: 29000, variant: "tunnel", hvac: "minisplit",
    desc: "Queen bed, wardrobe and a reading bench. Tunnel container: glazed door-walls at both ends give two exits and cross-ventilation.",
    va: "Both egress paths are outswing glazed doors inside factory apertures (VRC R310) — zero cuts.",
    furniture: [
      { x: -2.4, z: 0.95, w: 6.6, d: 5.2, h: 2.0, color: 0xd9cfc0 },     // queen bed, against the north wall
      { x: -6.7, z: 2.75, w: 1.4, d: 1.6, h: 2.0, color: 0x9c7c58 },     // nightstand
      { x: 1.7, z: 2.75, w: 1.4, d: 1.6, h: 2.0, color: 0x9c7c58 },      // nightstand
      { x: 6.6, z: 2.45, w: 4.0, d: 2.2, h: 6.6, color: 0x8a6f4f },      // wardrobe, clear of the door
      { x: 3.0, z: -2.75, w: 5.0, d: 1.6, h: 1.5, color: 0xb08d63 },     // bench
    ],
  },
  {
    id: "suite", name: "Suite unit", len: 20, wid: 8, color: 0xb08f96,
    cost: 42000, variant: "tunnel", ends: ["door", "window"], wet: true, hvac: "minisplit",
    desc: "A private suite: queen bed with an en-suite shower, WC and vanity behind a full-height partition with a pocket door at the aisle. Entry door at the bed end; the bath end is a frosted operable window wall.",
    va: "Habitable + wet: the bed-end glazed door is the egress opening (a door satisfies VRC R310); WC 15in+ off the wall with 21in+ in front (VRC ch.27), exhaust through the floor. Interior partition is framing, not steel — no envelope cuts.",
    furniture: [
      { x: -7.2, z: 1.95, w: 3.2, d: 3.2, h: 7.0, color: 0xcfd8dc },     // shower
      { x: -8.0, z: -2.3, w: 1.6, d: 2.4, h: 1.4, color: 0xf2efe8 },     // WC at the window wall (15.4in centerline)
      { x: -3.25, z: 2.65, w: 2.8, d: 1.8, h: 3.0, color: 0xdad2c4 },    // vanity
      { x: -1.7, z: 1.0, w: 0.35, d: 5.1, h: 8.0, color: 0xe6e1d8 },     // partition (2ft pocket-door opening at the aisle)
      { x: 1.9, z: 0.95, w: 6.6, d: 5.2, h: 2.0, color: 0xd9cfc0 },      // queen bed (23in aisle)
      { x: 6.0, z: 2.75, w: 1.4, d: 1.6, h: 2.0, color: 0x9c7c58 },      // nightstand
      { x: 7.7, z: 2.45, w: 2.0, d: 2.2, h: 6.6, color: 0x8a6f4f },      // wardrobe, clear of the door
    ],
  },
  {
    id: "kitchen", name: "Kitchen unit", len: 20, wid: 8, color: 0xc9ac7f,
    cost: 39000, variant: "tunnel", wet: true, hvac: "minisplit",
    desc: "Full galley run with range and sink, tall fridge, pantry and a small eat-at counter. Tunnel container: a pass-through galley with door-walls at both ends.",
    va: "Plumbing, gas and electrical need trade permits even under 256 sq ft. Range hood exhausts through the floor.",
    furniture: [
      { x: 0, z: -2.55, w: 11.2, d: 2.0, h: 3.0, color: 0xdad2c4 },      // 24in counter run
      { x: -7.4, z: 2.15, w: 2.6, d: 2.7, h: 6.6, color: 0xb9b3a7 },     // fridge, clear of the door
      { x: -4.8, z: 2.2, w: 2.6, d: 2.6, h: 6.6, color: 0x8a6f4f },      // pantry
      { x: 0.8, z: 2.65, w: 6.0, d: 1.8, h: 3.1, color: 0x9c7c58 },      // island / eat-at (40in aisle)
    ],
  },
  {
    id: "bathhouse", name: "Bathhouse unit", len: 20, wid: 8, color: 0x7e97a6,
    cost: 38000, variant: "tunnel", wet: true, hvac: "panel",
    desc: "Two shower stalls, a soaking tub, a changing bench and a linen tower. On-board tankless water heater — no long hot-water runs from the core.",
    va: "Wet unit: plumbing permits and inspections apply; mechanical exhaust (R303.3) ducted through the floor.",
    furniture: [
      { x: -6.9, z: 1.95, w: 3.2, d: 3.2, h: 7.0, color: 0xcfd8dc },     // shower 1
      { x: 6.9, z: 1.95, w: 3.2, d: 3.2, h: 7.0, color: 0xcfd8dc },      // shower 2
      { x: 0, z: -2.3, w: 6.0, d: 2.5, h: 2.0, color: 0xe8e4da },        // soaking tub
      { x: -0.5, z: 2.75, w: 4.0, d: 1.6, h: 1.5, color: 0xb08d63 },     // bench
      { x: 2.6, z: 2.8, w: 1.6, d: 1.3, h: 6.0, color: 0x8a6f4f },       // linen tower
    ],
  },
  {
    id: "bath-laundry", name: "Bath + laundry unit", len: 20, wid: 8, color: 0xa092a8,
    cost: 35000, variant: "tunnel", ends: ["door", "window"], wet: true, hvac: "panel",
    desc: "Full bath on one end, washer-dryer pair and folding counter on the other. Entry door at the laundry end; a frosted window wall lights the bath.",
    va: "Wet unit: plumbing and electrical permits apply. WC set 15in+ off the wall with 21in+ in front (VRC ch.27); exhaust + dryer duct through the floor.",
    furniture: [
      { x: -7.2, z: 1.95, w: 3.2, d: 3.2, h: 7.0, color: 0xcfd8dc },     // shower
      { x: -8.0, z: -2.3, w: 1.6, d: 2.4, h: 1.4, color: 0xf2efe8 },     // WC at the window wall (15.4in centerline)
      { x: -3.9, z: 2.65, w: 3.0, d: 1.8, h: 3.0, color: 0xdad2c4 },     // vanity
      { x: 2.6, z: 2.35, w: 2.4, d: 2.4, h: 3.2, color: 0xe8e6e0 },      // washer
      { x: 5.2, z: 2.35, w: 2.4, d: 2.4, h: 3.2, color: 0xe8e6e0 },      // dryer
      { x: 1.5, z: -2.75, w: 5.0, d: 1.6, h: 3.0, color: 0x9c7c58 },     // folding counter
      { x: 1.5, z: -3.4, w: 5.0, d: 0.3, h: 6.5, color: 0xbdb8ae },      // hanging rod
    ],
  },
  {
    id: "dining", name: "Dining unit", len: 20, wid: 8, color: 0xb78d7b,
    cost: 24000, variant: "openside", hvac: "minisplit",
    desc: "A table for eight with a banquette on the closed wall and chairs on the open side, spilling onto a deck. Sideboard at the quiet end.",
    va: "Unplumbed gathering space — simplest permit path of the set.",
    furniture: [
      { x: -1.0, z: -0.55, w: 8.0, d: 3.2, h: 2.5, color: 0x9c7c58 },    // table for 8
      { x: -1.0, z: -2.8, w: 8.0, d: 1.5, h: 1.5, color: 0xb08d63 },     // banquette
      { x: -4.0, z: 1.95, w: 1.5, d: 1.4, h: 1.5, color: 0xd9cfc0 },     // chair
      { x: -2.0, z: 1.95, w: 1.5, d: 1.4, h: 1.5, color: 0xd9cfc0 },     // chair
      { x: 0, z: 1.95, w: 1.5, d: 1.4, h: 1.5, color: 0xd9cfc0 },        // chair
      { x: 2.0, z: 1.95, w: 1.5, d: 1.4, h: 1.5, color: 0xd9cfc0 },      // chair
      { x: -8.5, z: 0, w: 1.5, d: 4.5, h: 3.0, color: 0x8a6f4f },        // sideboard
    ],
  },
  {
    id: "living", name: "Living unit", len: 20, wid: 8, color: 0xa5a184,
    cost: 26000, variant: "openside", hvac: "minisplit",
    desc: "Deep sofa, media wall and an electric fireplace behind an open-side glazed wall — the den, with zero envelope penetrations.",
    va: "All-electric heat (mini-split + fireplace): no flue, no roof cut, no solid-fuel clearances to defend.",
    furniture: [
      { x: -8.6, z: -1.2, w: 1.2, d: 3.2, h: 2.2, color: 0x4a4a48 },     // electric fireplace
      { x: 0, z: -2.05, w: 7.5, d: 3.0, h: 2.2, color: 0xd9cfc0 },       // sofa
      { x: 0, z: 1.5, w: 4.0, d: 1.8, h: 1.4, color: 0x9c7c58 },         // coffee table (14in gap)
      { x: 7.9, z: 1.7, w: 1.5, d: 3.0, h: 2.0, color: 0x8a6f4f },       // media, clear of the door
    ],
  },
  {
    id: "bathroom", name: "Bathroom unit", len: 10, wid: 8, color: 0x8fa0ad,
    cost: 17000, variant: "standard", wet: true, hvac: "panel",
    desc: "Compact three-fixture bath in a mini: shower, toilet, vanity. Drains drop straight through the floor.",
    va: "Wet unit: plumbing permits apply. WC set 15in+ off the wall with a clear doorway (VRC ch.27); exhaust fan ducted through the floor.",
    furniture: [
      { x: -2.6, z: 1.9, w: 3.2, d: 3.2, h: 7.0, color: 0xcfd8dc },      // shower
      { x: -3.4, z: -2.3, w: 1.6, d: 2.4, h: 1.4, color: 0xf2efe8 },     // WC (15.4in centerline)
      { x: 0.7, z: 2.65, w: 3.0, d: 1.8, h: 3.0, color: 0xdad2c4 },      // vanity
      { x: -1.4, z: -2.9, w: 1.6, d: 0.6, h: 4.5, color: 0xbdb8ae },     // shelf
    ],
  },
  {
    id: "laundry", name: "Laundry / utility unit", len: 10, wid: 8, color: 0xb0a08d,
    cost: 15000, variant: "standard", hvac: "panel", core: true,
    desc: "Washer, dryer, water heater and the compound's mechanical closet — the utility core. Wet units want to sit inside its ring.",
    va: "Houses water heater + panel; trade permits apply. Panel keeps its 30\" x 36\" working clearance (NEC 110.26) at the east wall.",
    furniture: [
      { x: -3.1, z: -2.3, w: 2.4, d: 2.4, h: 3.2, color: 0xe8e6e0 },     // washer
      { x: -0.5, z: -2.3, w: 2.4, d: 2.4, h: 3.2, color: 0xe8e6e0 },     // dryer
      { x: -3.3, z: 2.5, w: 2.0, d: 2.0, h: 5.0, color: 0xbdb8ae },      // water heater
      { x: 0.6, z: 2.85, w: 3.0, d: 1.4, h: 6.0, color: 0x8a6f4f },      // shelving (panel wall kept clear)
      { x: -1.8, z: -3.4, w: 4.0, d: 0.25, h: 6.5, color: 0xbdb8ae },    // hanging rod
    ],
  },
  {
    id: "office", name: "Office / studio unit", len: 20, wid: 8, color: 0x8fa695,
    cost: 26000, variant: "openside", hvac: "minisplit",
    desc: "Desk against the open-side glazed wall, a bookshelf wall and a reading corner. Sized up to a 20' box to clear the habitable-room minimum.",
    va: "Habitable space: ~131 sq ft interior clears VRC R304.1's 70 sq ft minimum.",
    furniture: [
      { x: 6.3, z: 1.55, w: 2.5, d: 4.0, h: 2.5, color: 0x9c7c58 },      // desk facing the glazed end
      { x: 4.3, z: 1.55, w: 1.7, d: 1.7, h: 1.6, color: 0x6b6b66 },      // chair
      { x: -2.5, z: -2.9, w: 9.0, d: 1.3, h: 6.6, color: 0x8a6f4f },     // bookshelf wall
      { x: -6.5, z: 2.2, w: 2.6, d: 2.6, h: 2.0, color: 0xd9cfc0 },      // reading chair
      { x: -8.4, z: -0.5, w: 1.6, d: 2.2, h: 3.0, color: 0x9c7c58 },     // cabinet
    ],
  },
  {
    id: "hobby", name: "Hobby / storage unit", len: 10, wid: 8, color: 0x8d919c,
    cost: 12000, variant: "standard", hvac: "none",
    desc: "Workbench, deep shelving and gear storage in a mini — deliberately non-habitable, so the small interior is fine by code.",
    va: "Not habitable space, so VRC R304's 70 sq ft / 7 ft minimums don't apply.",
    furniture: [
      { x: -2.4, z: -2.5, w: 3.6, d: 2.0, h: 3.0, color: 0x9c7c58 },     // workbench
      { x: -2.5, z: 2.8, w: 3.4, d: 1.4, h: 6.0, color: 0x8a6f4f },      // shelving
      { x: 1.6, z: 2.8, w: 4.0, d: 1.5, h: 2.2, color: 0xbdb8ae },       // bins
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
  suite: ["shower", "WC", "vanity", "", "bed", "", "wardrobe"],
  kitchen: ["counter run", "fridge", "pantry", "island"],
  bathhouse: ["shower", "shower", "soaking tub", "bench", "linen"],
  "bath-laundry": ["shower", "WC", "vanity", "washer", "dryer", "counter", "rod"],
  dining: ["table", "banquette", "", "", "", "", "sideboard"],
  living: ["fireplace", "sofa", "table", "media"],
  bathroom: ["shower", "WC", "vanity", "shelf"],
  laundry: ["washer", "dryer", "WH", "shelving", "rod"],
  office: ["desk", "", "bookshelves", "chair", "cab"],
  hobby: ["workbench", "shelving", "bins"],
};
