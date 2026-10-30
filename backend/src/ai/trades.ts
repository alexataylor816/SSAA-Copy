/**
 * The task → trade lookup list Luke and the team agreed on (Oct 23 call, "almost a RAG"): match a schedule
 * task's name to the trade that does the work, so the recommender knows which sub to ask and every trade
 * always gets the same colour on the calendar.
 *
 * Phrases beat single words ("electrical layout" → Electrical, plain "layout" → Drywall). Some names are
 * genuinely ambiguous ("demo" can be a demo contractor or the drywall crew); those come back as such so
 * the caller can use the project's subs to decide, ask Claude, or ask the GC.
 */

export interface Trade {
  trade: string;
  color: string;
  /** Other names a company might give for its trade. */
  aliases: string[];
  /** Task-name phrases that mean this trade. Longer, more specific phrases win. */
  phrases: string[];
}

export const TRADES: Trade[] = [
  {
    trade: "Demolition",
    color: "#78716c",
    aliases: ["demo", "demolition", "abatement"],
    phrases: ["demolition", "selective demo", "abatement", "haul off", "gut", "demolicion", "demolicion selectiva", "retiro de escombro", "acarreo de escombro"],
  },
  {
    trade: "Drywall",
    color: "#16a34a",
    aliases: ["drywall", "framing", "metal stud", "acoustical", "drywall and framing"],
    phrases: [
      "layout",
      "framing",
      "metal stud",
      "drywall",
      "hang board",
      "hang drywall",
      "board",
      "tape",
      "taping",
      "finish drywall",
      "tape and finish",
      "wall close in",
      "close in",
      "insulation",
      "ceiling grid",
      "act ceiling",
      "soffit",
      // Spanish (accents are ignored when matching)
      "tablaroca",
      "colocacion de tablaroca",
      "acabado de tablaroca",
      "encintado",
      "bastidores",
      "perfil metalico",
      "plafon",
      "plafon reticular",
      "muros de tablaroca",
      "cierre de muros",
      "durock",
    ],
  },
  {
    trade: "Plumbing",
    color: "#0284c7",
    aliases: ["plumbing", "plumber", "plumbing and gas"],
    phrases: [
      "plumbing",
      "plumbing rough-in",
      "plumbing rough in",
      "plumbing trim",
      "plumbing fixtures",
      "water heater",
      "domestic water",
      "sanitary",
      "storm drain",
      "gas piping",
      "underground plumbing",
      // Spanish (accents are ignored when matching)
      "plomeria",
      "plomeria en obra negra",
      "instalacion hidraulica",
      "instalacion sanitaria",
      "hidrosanitaria",
      "muebles de bano",
      "calentador de agua",
      "drenaje",
      "drenaje pluvial",
      "tuberia de gas",
      "agua potable",
    ],
  },
  {
    trade: "HVAC",
    color: "#ea580c",
    aliases: ["hvac", "mechanical", "heating and cooling", "sheet metal"],
    phrases: [
      "hvac",
      "duct",
      "duct install",
      "ductwork",
      "vav",
      "vav install",
      "rtu",
      "rooftop unit",
      "air handler",
      "ahu",
      "diffusers",
      "grilles",
      "exhaust fan",
      "split system",
      "mechanical rough-in",
      "test and balance",
      // Spanish (accents are ignored when matching)
      "aire acondicionado",
      "ductos",
      "instalacion de ductos",
      "manejadora",
      "minisplit",
      "climatizacion",
      "calefaccion",
      "equipo de azotea",
    ],
  },
  {
    trade: "Electrical",
    color: "#ca8a04",
    aliases: ["electrical", "electric", "electrician", "low voltage"],
    phrases: [
      "electrical",
      "electrical rough-in",
      "electrical rough in",
      "electrical layout",
      "electrical trim",
      "conduit",
      "wire pull",
      "pull wire",
      "panel",
      "switchgear",
      "lighting",
      "light fixtures",
      "low voltage",
      "fire alarm",
      "data cabling",
      // Spanish (accents are ignored when matching)
      "electricidad",
      "instalacion electrica",
      "cableado",
      "luminarias",
      "contactos",
      "tableros electricos",
      "canalizacion",
      "alumbrado",
      "voz y datos",
    ],
  },
  {
    trade: "Fire Protection",
    color: "#dc2626",
    aliases: ["fire protection", "sprinkler", "fire sprinkler"],
    phrases: ["sprinkler", "sprinkler install", "sprinkler rough-in", "fire protection", "standpipe", "sprinkler heads", "proteccion contra incendio", "rociadores", "sistema contra incendio", "alarma contra incendio", "red contra incendio"],
  },
  {
    trade: "Painting",
    color: "#9333ea",
    aliases: ["painting", "paint", "painter", "wallcovering"],
    phrases: ["paint", "painting", "prime", "primer", "wallcovering", "final coat", "pintura", "pintar", "sellador"],
  },
  {
    trade: "Concrete",
    color: "#475569",
    aliases: ["concrete", "masonry", "flatwork"],
    phrases: ["concrete", "slab", "pour", "footing", "footings", "foundation", "rebar", "formwork", "sidewalk", "masonry", "cmu", "concreto", "colado", "colado de losa", "cimbra", "firme de concreto", "cimentacion", "zapatas"],
  },
  {
    trade: "Flooring",
    color: "#db2777",
    aliases: ["flooring", "tile", "carpet"],
    phrases: ["flooring", "floor tile", "tile", "carpet", "lvt", "vct", "floor prep", "epoxy floor", "pisos", "loseta", "azulejo", "porcelanato", "piso epoxico", "alfombra"],
  },
  {
    trade: "Carpentry",
    color: "#a16207",
    aliases: ["carpentry", "millwork", "finish carpentry", "casework"],
    phrases: ["millwork", "casework", "trim out", "doors and hardware", "door install", "cabinets", "finish carpentry", "blocking", "carpinteria", "puertas", "herrajes", "molduras", "closets"],
  },
];

/**
 * Names that honestly belong to more than one trade (from the call): "demo" may be a demo contractor or
 * the drywall crew; "layout" is usually drywall but electrical/HVAC on bigger jobs.
 */
const AMBIGUOUS: Record<string, string[]> = {
  demo: ["Demolition", "Drywall"],
  layout: ["Drywall", "Electrical", "HVAC"],
  "rough-in": ["Plumbing", "Electrical", "HVAC"],
  "rough in": ["Plumbing", "Electrical", "HVAC"],
  trim: ["Electrical", "Plumbing", "Carpentry"],
  "punch list": [],
  punch: [],
  cleanup: [],
  "final clean": [],
  inspection: [],
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // "plomería" → "plomeria", so Spanish task names match
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The colour for a trade name (or a company's trade text), or a neutral grey. */
export function colorForTrade(trade: string | null | undefined): string {
  return (trade && tradeFromCompanyText(trade) && TRADES.find((t) => t.trade === tradeFromCompanyText(trade))?.color) || "#64748b";
}

/** A company's free-text trade ("Mechanical", "Fire Sprinklers") → one of our trades, or null. */
export function tradeFromCompanyText(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = norm(text);
  for (const trade of TRADES) {
    if (trade.trade.toLowerCase() === t || trade.aliases.some((a) => t === a || t.includes(a))) return trade.trade;
  }
  return null;
}

export interface TradeMatch {
  /** The best trade, or null when nothing matched. */
  trade: string | null;
  /** "lookup": a confident phrase match. "ambiguous": several trades fit. "none": no idea. "learned": from a GC's earlier answer. */
  confidence: "lookup" | "learned" | "ambiguous" | "none";
  /** Other trades that could do it (ambiguous names). */
  alternatives: string[];
  /** The phrase that decided it, for the "why" shown to the GC. */
  matched: string | null;
}

/**
 * Match a task name to a trade. `learned` holds answers GCs gave before (normalised task name → trade),
 * which win over the built-in list: that's how the lookup grows with use.
 */
export function matchTaskToTrade(taskName: string, learned: Map<string, string> = new Map()): TradeMatch {
  const name = norm(taskName);
  const remembered = learned.get(name);
  if (remembered) return { trade: remembered, confidence: "learned", alternatives: [], matched: name };

  // Longest matching phrase across all trades wins ("electrical layout" beats "layout").
  let best: { trade: string; phrase: string } | null = null;
  for (const t of TRADES) {
    for (const phrase of t.phrases) {
      const re = new RegExp(`(^|\\b)${phrase.replace(/[-]/g, "[- ]?")}(\\b|$)`);
      if (re.test(name) && (!best || phrase.length > best.phrase.length)) best = { trade: t.trade, phrase };
    }
  }

  // A bare ambiguous word ("Demo", "Layout", "Rough-In") stays ambiguous unless a longer phrase decided it.
  const ambiguousKey = Object.keys(AMBIGUOUS).find((k) => name === k || name.startsWith(`${k} `) || name.endsWith(` ${k}`));
  if (ambiguousKey && (!best || best.phrase.length <= ambiguousKey.length)) {
    const options = AMBIGUOUS[ambiguousKey];
    return { trade: options[0] ?? null, confidence: options.length ? "ambiguous" : "none", alternatives: options, matched: ambiguousKey };
  }
  if (best) return { trade: best.trade, confidence: "lookup", alternatives: [], matched: best.phrase };
  return { trade: null, confidence: "none", alternatives: [], matched: null };
}

export const normaliseTaskName = norm;
