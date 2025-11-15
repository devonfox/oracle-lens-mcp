import { db } from "../db/index.js";
import { oracleCards, inventory } from "../db/schema.js";
import { eq, and, or, like, lte, gte, sql } from "drizzle-orm";

/**
 * Map color names to their single-letter codes
 */
const COLOR_MAP: Record<string, string> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
  w: "W",
  u: "U",
  b: "B",
  r: "R",
  g: "G",
};

/**
 * Normalize color string to uppercase single letters
 */
function normalizeColor(color: string): string {
  const lower = color.toLowerCase();
  return COLOR_MAP[lower] || color.toUpperCase();
}

/**
 * Parse Scryfall-like query syntax
 * Supports: t:type, o:text, c:colors, ci:colors, cmc<=X, cmc>=X, k:keyword
 * Falls back to plain text search on name + oracle_text
 */
export function parseQuery(query: string): {
  type?: string;
  oracleText?: string;
  colors?: string;
  colorIdentity?: string;
  cmcMin?: number;
  cmcMax?: number;
  keyword?: string;
  plainText?: string;
} {
  const result: any = {};
  const parts = query.split(/\s+/);

  for (const part of parts) {
    if (part.startsWith("t:")) {
      result.type = part.slice(2);
    } else if (part.startsWith("o:")) {
      result.oracleText = part.slice(2).replace(/"/g, "");
    } else if (part.startsWith("c:") && !part.startsWith("ci:")) {
      // c: for colors (not ci:)
      result.colors = normalizeColor(part.slice(2));
    } else if (part.startsWith("ci:")) {
      result.colorIdentity = normalizeColor(part.slice(3));
    } else if (part.startsWith("cmc<=")) {
      result.cmcMax = parseInt(part.slice(5), 10);
    } else if (part.startsWith("cmc>=")) {
      result.cmcMin = parseInt(part.slice(5), 10);
    } else if (part.startsWith("k:")) {
      result.keyword = part.slice(2);
    } else {
      // Plain text search
      result.plainText = result.plainText
        ? `${result.plainText} ${part}`
        : part;
    }
  }

  return result;
}

/**
 * Search oracle cards with parsed query
 */
export async function searchOracleCards(
  query: string,
  limit: number = 20
): Promise<any[]> {
  const parsed = parseQuery(query);
  let conditions: any[] = [];

  if (parsed.type) {
    conditions.push(like(sql`lower(${oracleCards.typeLine})`, `%${parsed.type.toLowerCase()}%`));
  }

  if (parsed.oracleText) {
    conditions.push(
      like(sql`lower(${oracleCards.oracleText})`, `%${parsed.oracleText.toLowerCase()}%`)
    );
  }

  // Colors field (c:) - stored as JSON array like ["R","G"]
  if (parsed.colors) {
    conditions.push(
      like(sql`lower(${oracleCards.colors})`, `%"${parsed.colors.toLowerCase()}"%`)
    );
  }

  // Color identity field (ci:) - stored as JSON array like ["R","G"]
  if (parsed.colorIdentity) {
    conditions.push(
      like(sql`lower(${oracleCards.colorIdentity})`, `%"${parsed.colorIdentity.toLowerCase()}"%`)
    );
  }

  if (parsed.cmcMin !== undefined) {
    conditions.push(gte(oracleCards.cmc, parsed.cmcMin));
  }

  if (parsed.cmcMax !== undefined) {
    conditions.push(lte(oracleCards.cmc, parsed.cmcMax));
  }

  // Keywords field - stored as JSON array like ["Haste","First strike"]
  if (parsed.keyword) {
    const keywordLower = parsed.keyword.toLowerCase();
    conditions.push(
      like(sql`lower(${oracleCards.keywords})`, `%"${keywordLower}"%`)
    );
  }

  if (parsed.plainText) {
    const text = parsed.plainText.toLowerCase();
    conditions.push(
      or(
        like(sql`lower(${oracleCards.name})`, `%${text}%`),
        like(sql`lower(${oracleCards.oracleText})`, `%${text}%`)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select()
    .from(oracleCards)
    .where(whereClause)
    .limit(limit);

  return results;
}

/**
 * Search collection (inventory) with same query syntax
 */
export async function searchCollection(
  query: string,
  limit: number = 20
): Promise<any[]> {
  const parsed = parseQuery(query);
  let conditions: any[] = [];

  // Build conditions similar to oracle search
  if (parsed.type) {
    conditions.push(like(sql`lower(${oracleCards.typeLine})`, `%${parsed.type.toLowerCase()}%`));
  }

  if (parsed.oracleText) {
    conditions.push(
      like(sql`lower(${oracleCards.oracleText})`, `%${parsed.oracleText.toLowerCase()}%`)
    );
  }

  // Colors field (c:)
  if (parsed.colors) {
    conditions.push(
      like(sql`lower(${oracleCards.colors})`, `%"${parsed.colors.toLowerCase()}"%`)
    );
  }

  // Color identity field (ci:)
  if (parsed.colorIdentity) {
    conditions.push(
      like(sql`lower(${oracleCards.colorIdentity})`, `%"${parsed.colorIdentity.toLowerCase()}"%`)
    );
  }

  if (parsed.cmcMin !== undefined) {
    conditions.push(gte(oracleCards.cmc, parsed.cmcMin));
  }

  if (parsed.cmcMax !== undefined) {
    conditions.push(lte(oracleCards.cmc, parsed.cmcMax));
  }

  // Keywords field
  if (parsed.keyword) {
    const keywordLower = parsed.keyword.toLowerCase();
    conditions.push(
      like(sql`lower(${oracleCards.keywords})`, `%"${keywordLower}"%`)
    );
  }

  if (parsed.plainText) {
    const text = parsed.plainText.toLowerCase();
    conditions.push(
      or(
        like(sql`lower(${oracleCards.name})`, `%${text}%`),
        like(sql`lower(${oracleCards.oracleText})`, `%${text}%`)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      oracleId: oracleCards.oracleId,
      name: oracleCards.name,
      manaCost: oracleCards.manaCost,
      cmc: oracleCards.cmc,
      typeLine: oracleCards.typeLine,
      oracleText: oracleCards.oracleText,
      colors: oracleCards.colors,
      colorIdentity: oracleCards.colorIdentity,
      keywords: oracleCards.keywords,
      qty: inventory.qty,
      tags: inventory.tags,
      location: inventory.location,
    })
    .from(inventory)
    .innerJoin(oracleCards, eq(inventory.oracleId, oracleCards.oracleId))
    .where(whereClause)
    .limit(limit);

  return results;
}
