import { db } from "../db/index.js";
import { oracleCards, defaultCards, inventory } from "../db/schema.js";
import {
  eq,
  and,
  or,
  not,
  like,
  lte,
  gte,
  lt,
  gt,
  sql,
  SQL,
  desc,
} from "drizzle-orm";

/**
 * Map color names to their single-letter codes
 * Supports full names, abbreviations, and special values
 */
const COLOR_MAP: Record<string, string> = {
  // Basic colors
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
  // Special values
  colorless: "C",
  c: "C",
  multicolor: "M",
  m: "M",
};

/**
 * Map guild/shard/wedge names to color combinations
 */
const COLOR_COMBINATION_MAP: Record<string, string[]> = {
  // Guilds (two-color)
  azorius: ["W", "U"],
  dimir: ["U", "B"],
  rakdos: ["B", "R"],
  gruul: ["R", "G"],
  selesnya: ["G", "W"],
  orzhov: ["W", "B"],
  izzet: ["U", "R"],
  golgari: ["B", "G"],
  boros: ["R", "W"],
  simic: ["G", "U"],
  // Shards (three-color, centered)
  bant: ["G", "W", "U"],
  esper: ["W", "U", "B"],
  grixis: ["U", "B", "R"],
  jund: ["B", "R", "G"],
  naya: ["R", "G", "W"],
  // Wedges (three-color, enemy pair + ally)
  abzan: ["W", "B", "G"],
  jeskai: ["U", "R", "W"],
  sultai: ["B", "G", "U"],
  mardu: ["R", "W", "B"],
  temur: ["G", "U", "R"],
  // Four-color
  chaos: ["R", "G", "W", "U"], // Not black
  aggression: ["R", "G", "W", "B"], // Not blue
  altruism: ["G", "W", "U", "B"], // Not red
  growth: ["R", "W", "U", "B"], // Not green
  artifice: ["R", "G", "U", "B"], // Not white
  // Colleges (Strixhaven)
  quandrix: ["G", "U"],
  silverquill: ["W", "B"],
  witherbloom: ["B", "G"],
  prismari: ["U", "R"],
  lorehold: ["R", "W"],
};

/**
 * Normalize color string to uppercase single letters
 */
function normalizeColor(color: string): string {
  const lower = color.toLowerCase();
  return COLOR_MAP[lower] || color.toUpperCase();
}

/**
 * Parse a color set string (e.g., "wbg", "WUBRG", "azorius", "esper") into an array of normalized colors
 */
function parseColorSet(colorStr: string): string[] {
  const normalized = colorStr.toLowerCase();

  // Check if it's a named combination (guild, shard, wedge, etc.)
  if (COLOR_COMBINATION_MAP[normalized]) {
    return [...COLOR_COMBINATION_MAP[normalized]].sort();
  }

  // Check if it's a special value
  if (normalized === "colorless" || normalized === "c") {
    return ["C"];
  }
  if (normalized === "multicolor" || normalized === "m") {
    return ["M"];
  }

  // Parse individual color letters
  const colors: string[] = [];
  for (const char of normalized) {
    const normalizedColor = normalizeColor(char);
    if (normalizedColor && !colors.includes(normalizedColor)) {
      colors.push(normalizedColor);
    }
  }

  return colors.sort();
}

/**
 * Token types for the query parser
 */
type TokenType =
  | "FIELD"
  | "OPERATOR"
  | "VALUE"
  | "AND"
  | "OR"
  | "NOT"
  | "LPAREN"
  | "RPAREN"
  | "QUOTED_STRING"
  | "PLAIN_TEXT";

interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

/**
 * AST node types
 */
type ASTNode =
  | { type: "AND"; left: ASTNode; right: ASTNode }
  | { type: "OR"; left: ASTNode; right: ASTNode }
  | { type: "NOT"; operand: ASTNode }
  | { type: "FIELD"; field: string; operator?: string; value: string }
  | { type: "PLAIN_TEXT"; value: string };

/**
 * Tokenize the query string
 */
function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = query.length;

  while (i < len) {
    // Skip whitespace
    if (/\s/.test(query[i])) {
      i++;
      continue;
    }

    const start = i;

    // Handle quoted strings
    if (query[i] === '"') {
      i++; // Skip opening quote
      let value = "";
      while (i < len && query[i] !== '"') {
        if (query[i] === "\\" && i + 1 < len) {
          i++; // Skip escape character
          value += query[i];
        } else {
          value += query[i];
        }
        i++;
      }
      if (i < len) i++; // Skip closing quote
      tokens.push({ type: "QUOTED_STRING", value, start, end: i });
      continue;
    }

    // Handle parentheses
    if (query[i] === "(") {
      tokens.push({ type: "LPAREN", value: "(", start, end: i + 1 });
      i++;
      continue;
    }
    if (query[i] === ")") {
      tokens.push({ type: "RPAREN", value: ")", start, end: i + 1 });
      i++;
      continue;
    }

    // Handle NOT operator (unary minus)
    if (
      query[i] === "-" &&
      (i === 0 || /\s/.test(query[i - 1]) || query[i - 1] === "(")
    ) {
      tokens.push({ type: "NOT", value: "-", start, end: i + 1 });
      i++;
      continue;
    }

    // Handle fielded terms (e.g., t:creature, ci<=wbg, cmc>=3, o:"draw a card", pow>tou)
    // First try with colon: field:value or field:operator:value
    const fieldMatchWithColon = query.slice(i).match(/^([a-z]+)([<>=!]+)?:/i);
    if (fieldMatchWithColon) {
      const fieldName = fieldMatchWithColon[1].toLowerCase();
      const operator = fieldMatchWithColon[2] || "";
      i += fieldMatchWithColon[0].length;

      // Extract value - handle quoted strings or unquoted values
      let value = "";

      // Check if value starts with a quote
      if (i < len && query[i] === '"') {
        i++; // Skip opening quote
        while (i < len && query[i] !== '"') {
          if (query[i] === "\\" && i + 1 < len) {
            i++; // Skip escape character
            value += query[i];
          } else {
            value += query[i];
          }
          i++;
        }
        if (i < len) i++; // Skip closing quote
      } else {
        // Extract unquoted value (until whitespace, parenthesis, or end)
        while (
          i < len &&
          !/\s/.test(query[i]) &&
          query[i] !== "(" &&
          query[i] !== ")"
        ) {
          value += query[i];
          i++;
        }
      }

      tokens.push({
        type: "FIELD",
        value: fieldName + (operator ? operator : "") + ":" + value,
        start,
        end: i,
      });
      continue;
    }

    // Handle fielded terms without colon (e.g., pow>tou, pow>=3)
    // Pattern: field operator value (where operator is >, <, >=, <=, =, !=)
    const fieldMatchNoColon = query
      .slice(i)
      .match(/^([a-z]+)([<>=!]+)([a-z0-9*]+)/i);
    if (fieldMatchNoColon) {
      const fieldName = fieldMatchNoColon[1].toLowerCase();
      const operator = fieldMatchNoColon[2];
      const value = fieldMatchNoColon[3];
      i += fieldMatchNoColon[0].length;

      tokens.push({
        type: "FIELD",
        value: fieldName + operator + ":" + value,
        start,
        end: i,
      });
      continue;
    }

    // Handle OR operator (must be uppercase and surrounded by whitespace or parentheses)
    const orMatch = query.slice(i).match(/^\bOR\b/i);
    if (orMatch) {
      tokens.push({
        type: "OR",
        value: "OR",
        start,
        end: i + orMatch[0].length,
      });
      i += orMatch[0].length;
      continue;
    }

    // Handle plain text (word)
    let word = "";
    while (
      i < len &&
      !/\s/.test(query[i]) &&
      query[i] !== "(" &&
      query[i] !== ")"
    ) {
      word += query[i];
      i++;
    }

    if (word) {
      tokens.push({ type: "PLAIN_TEXT", value: word, start, end: i });
    }
  }

  return tokens;
}

/**
 * Parse tokens into an AST
 */
function parse(tokens: Token[]): ASTNode {
  let index = 0;

  function parseExpression(): ASTNode {
    return parseOr();
  }

  function parseOr(): ASTNode {
    let left = parseAnd();

    while (index < tokens.length && tokens[index].type === "OR") {
      index++; // consume OR
      const right = parseAnd();
      left = { type: "OR", left, right };
    }

    return left;
  }

  function parseAnd(): ASTNode {
    let left = parseNot();

    // Implicit AND: if we have another term without an explicit OR, it's AND
    while (
      index < tokens.length &&
      tokens[index].type !== "OR" &&
      tokens[index].type !== "RPAREN"
    ) {
      const right = parseNot();
      left = { type: "AND", left, right };
    }

    return left;
  }

  function parseNot(): ASTNode {
    if (index < tokens.length && tokens[index].type === "NOT") {
      index++; // consume NOT
      const operand = parseNot(); // Right-associative
      return { type: "NOT", operand };
    }

    return parseTerm();
  }

  function parseTerm(): ASTNode {
    if (index >= tokens.length) {
      throw new Error("Unexpected end of query");
    }

    const token = tokens[index];

    if (token.type === "LPAREN") {
      index++; // consume (
      const expr = parseExpression();
      if (index >= tokens.length || tokens[index].type !== "RPAREN") {
        throw new Error("Unmatched opening parenthesis");
      }
      index++; // consume )
      return expr;
    }

    if (token.type === "FIELD") {
      index++;
      // Parse field:value or field:operator:value
      const match = token.value.match(/^([a-z]+)([<>=!]+)?:(.+)$/i);
      if (!match) {
        throw new Error(`Invalid field syntax: ${token.value}`);
      }
      const [, field, operator = "", value] = match;
      return { type: "FIELD", field: field.toLowerCase(), operator, value };
    }

    if (token.type === "QUOTED_STRING" || token.type === "PLAIN_TEXT") {
      index++;
      return { type: "PLAIN_TEXT", value: token.value };
    }

    throw new Error(
      `Unexpected token: ${token.type} at position ${token.start}`
    );
  }

  const ast = parseExpression();

  if (index < tokens.length) {
    throw new Error(`Unexpected token at position ${tokens[index].start}`);
  }

  return ast;
}

/**
 * Convert a field AST node to a SQL condition
 * Works with either oracle_cards or default_cards (joined with oracle_cards)
 */
function fieldToCondition(
  node: Extract<ASTNode, { type: "FIELD" }>,
  oracleTable: typeof oracleCards,
  defaultTable?: typeof defaultCards
): SQL | null {
  const { field, operator, value } = node;

  // Field aliases - supports Scryfall syntax
  const fieldMap: Record<string, string> = {
    // Name
    n: "name",
    name: "name",
    // Type
    t: "type",
    type: "type",
    // Oracle text
    o: "oracle",
    oracle: "oracle",
    // Colors
    c: "colors",
    color: "colors",
    colors: "colors",
    // Color identity
    ci: "color_identity",
    id: "color_identity",
    identity: "color_identity",
    color_identity: "color_identity",
    // Converted mana cost / mana value
    cmc: "cmc",
    mv: "cmc",
    manavalue: "cmc",
    // Mana cost (actual cost string)
    m: "mana_cost",
    mana: "mana_cost",
    // Keywords
    k: "keyword",
    kw: "keyword",
    keyword: "keyword",
    // Format legality
    f: "format",
    format: "format",
    banned: "banned",
    restricted: "restricted",
    // Power/Toughness (only in default_cards)
    pow: "power",
    power: "power",
    tou: "toughness",
    toughness: "toughness",
    pt: "power_toughness", // Combined power/toughness
    powtou: "power_toughness",
  };

  const normalizedField = fieldMap[field];
  if (!normalizedField) {
    return null; // Unknown field, skip
  }

  // Handle name field
  if (normalizedField === "name") {
    const searchValue = value.toLowerCase();
    if (defaultTable) {
      // Use alias when joined
      return like(sql`lower(oc.name)`, `%${searchValue}%`);
    }
    return like(sql`lower(${oracleTable.name})`, `%${searchValue}%`);
  }

  // Handle type field
  if (normalizedField === "type") {
    const searchValue = value.toLowerCase();
    if (defaultTable) {
      return like(sql`lower(oc.type_line)`, `%${searchValue}%`);
    }
    return like(sql`lower(${oracleTable.typeLine})`, `%${searchValue}%`);
  }

  // Handle oracle text field
  if (normalizedField === "oracle") {
    const searchValue = value.toLowerCase();
    if (defaultTable) {
      return like(sql`lower(oc.oracle_text)`, `%${searchValue}%`);
    }
    return like(sql`lower(${oracleTable.oracleText})`, `%${searchValue}%`);
  }

  // Handle CMC field
  if (normalizedField === "cmc") {
    // Support special values like "even" and "odd"
    if (value.toLowerCase() === "even") {
      // Use oc.cmc from oracle_cards
      if (defaultTable) {
        return sql`(oc.cmc % 2) = 0`;
      }
      return sql`${oracleTable.cmc} % 2 = 0`;
    }
    if (value.toLowerCase() === "odd") {
      if (defaultTable) {
        return sql`(oc.cmc % 2) = 1`;
      }
      return sql`${oracleTable.cmc} % 2 = 1`;
    }

    const numValue = parseInt(value, 10);
    if (isNaN(numValue)) {
      return null;
    }

    if (defaultTable) {
      // Use oc.cmc from oracle_cards (consistent across printings)
      switch (operator) {
        case "=":
          return sql`oc.cmc = ${numValue}`;
        case "<=":
          return sql`oc.cmc <= ${numValue}`;
        case ">=":
          return sql`oc.cmc >= ${numValue}`;
        case "<":
          return sql`oc.cmc < ${numValue}`;
        case ">":
          return sql`oc.cmc > ${numValue}`;
        case "!=":
          return sql`oc.cmc != ${numValue}`;
        default:
          return sql`oc.cmc = ${numValue}`;
      }
    }

    switch (operator) {
      case "=":
        return eq(oracleTable.cmc, numValue);
      case "<=":
        return lte(oracleTable.cmc, numValue);
      case ">=":
        return gte(oracleTable.cmc, numValue);
      case "<":
        return lt(oracleTable.cmc, numValue);
      case ">":
        return gt(oracleTable.cmc, numValue);
      case "!=":
        return sql`${oracleTable.cmc} != ${numValue}`;
      default:
        return eq(oracleTable.cmc, numValue);
    }
  }

  // Handle mana cost field (actual cost string like "{1}{R}{R}")
  if (normalizedField === "mana_cost") {
    const searchValue = value.toLowerCase();
    // Mana cost is stored as string like "{1}{R}{R}" or "{G}{U}"
    // Support partial matching for mana symbols
    if (defaultTable) {
      return like(sql`lower(oc.mana_cost)`, `%${searchValue}%`);
    }
    return like(sql`lower(${oracleTable.manaCost})`, `%${searchValue}%`);
  }

  // Handle power field
  if (normalizedField === "power" || normalizedField === "pow") {
    if (!defaultTable) {
      return null; // Power only available in default_cards
    }
    // Power can be numeric or special values like "*", "1+*", "?"
    // For comparisons, we'll handle numeric values only
    // Use a safe cast that filters out non-numeric values
    if (value.toLowerCase() === "tou" || value.toLowerCase() === "toughness") {
      // Special case: pow>tou means power > toughness
      // Only compare when both are numeric
      return sql`(
        (dc.data->>'power') ~ '^[0-9]+(\.[0-9]+)?$' AND
        (dc.data->>'toughness') ~ '^[0-9]+(\.[0-9]+)?$' AND
        (dc.data->>'power')::numeric > (dc.data->>'toughness')::numeric
      )`;
    }
    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
      return null;
    }
    // Only compare numeric power values (filter out "*", "1+*", "?", etc.)
    const numericCheck = sql`(dc.data->>'power') ~ '^[0-9]+(\.[0-9]+)?$'`;
    switch (operator) {
      case "=":
        return sql`${numericCheck} AND (dc.data->>'power')::numeric = ${numValue}`;
      case "<=":
        return sql`${numericCheck} AND (dc.data->>'power')::numeric <= ${numValue}`;
      case ">=":
        return sql`${numericCheck} AND (dc.data->>'power')::numeric >= ${numValue}`;
      case "<":
        return sql`${numericCheck} AND (dc.data->>'power')::numeric < ${numValue}`;
      case ">":
        return sql`${numericCheck} AND (dc.data->>'power')::numeric > ${numValue}`;
      case "!=":
        return sql`${numericCheck} AND (dc.data->>'power')::numeric != ${numValue}`;
      default:
        return sql`${numericCheck} AND (dc.data->>'power')::numeric = ${numValue}`;
    }
  }

  // Handle toughness field
  if (normalizedField === "toughness" || normalizedField === "tou") {
    if (!defaultTable) {
      return null; // Toughness only available in default_cards
    }
    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
      return null;
    }
    // Only compare numeric toughness values (filter out "*", "1+*", "?", etc.)
    const numericCheck = sql`(dc.data->>'toughness') ~ '^[0-9]+(\.[0-9]+)?$'`;
    switch (operator) {
      case "=":
        return sql`${numericCheck} AND (dc.data->>'toughness')::numeric = ${numValue}`;
      case "<=":
        return sql`${numericCheck} AND (dc.data->>'toughness')::numeric <= ${numValue}`;
      case ">=":
        return sql`${numericCheck} AND (dc.data->>'toughness')::numeric >= ${numValue}`;
      case "<":
        return sql`${numericCheck} AND (dc.data->>'toughness')::numeric < ${numValue}`;
      case ">":
        return sql`${numericCheck} AND (dc.data->>'toughness')::numeric > ${numValue}`;
      case "!=":
        return sql`${numericCheck} AND (dc.data->>'toughness')::numeric != ${numValue}`;
      default:
        return sql`${numericCheck} AND (dc.data->>'toughness')::numeric = ${numValue}`;
    }
  }

  // Handle colors field
  if (normalizedField === "colors") {
    const colorSet = parseColorSet(value);
    if (colorSet.length === 0) {
      return null;
    }

    // Colors are stored as JSONB array like ["W","U","B"]
    // Use PostgreSQL JSONB operators
    const colorSetJson = JSON.stringify(colorSet);

    // Use oracle_cards for colors (consistent across printings)
    if (defaultTable) {
      // Use alias when joined
      switch (operator) {
        case "=":
          return sql`oc.colors = ${colorSetJson}::jsonb`;
        case "<=":
          return sql`(
            oc.colors IS NULL OR
            NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(oc.colors) AS card_color
              WHERE card_color NOT IN (${sql.raw(
                colorSet.map((c) => `'${c}'`).join(",")
              )})
            )
          )`;
        case ">=":
          return sql`(
            NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(${sql.raw(
                `'${colorSetJson}'`
              )}::jsonb) AS search_color
              WHERE search_color NOT IN (
                SELECT jsonb_array_elements_text(oc.colors)
                WHERE oc.colors IS NOT NULL
              )
            )
          )`;
        case "!":
        case "!=":
          return sql`oc.colors != ${colorSetJson}::jsonb`;
        default:
          return sql`oc.colors ?| ${sql.raw(
            `ARRAY[${colorSet.map((c) => `'${c}'`).join(",")}]`
          )}`;
      }
    }

    const colorsField = oracleTable.colors;
    switch (operator) {
      case "=":
        return sql`${colorsField} = ${colorSetJson}::jsonb`;
      case "<=":
        return sql`(
          ${colorsField} IS NULL OR
          NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(${colorsField}) AS card_color
            WHERE card_color NOT IN (${sql.raw(
              colorSet.map((c) => `'${c}'`).join(",")
            )})
          )
        )`;
      case ">=":
        return sql`(
          NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(${sql.raw(
              `'${colorSetJson}'`
            )}::jsonb) AS search_color
            WHERE search_color NOT IN (
              SELECT jsonb_array_elements_text(${colorsField})
              WHERE ${colorsField} IS NOT NULL
            )
          )
        )`;
      case "!":
      case "!=":
        return sql`${colorsField} != ${colorSetJson}::jsonb`;
      default:
        return sql`${colorsField} ?| ${sql.raw(
          `ARRAY[${colorSet.map((c) => `'${c}'`).join(",")}]`
        )}`;
    }
  }

  // Handle color_identity field (same logic as colors)
  if (normalizedField === "color_identity") {
    const colorSet = parseColorSet(value);
    if (colorSet.length === 0) {
      return null;
    }

    const colorSetJson = JSON.stringify(colorSet);

    if (defaultTable) {
      // Use alias when joined
      switch (operator) {
        case "=":
          return sql`oc.color_identity = ${colorSetJson}::jsonb`;
        case "<=":
          return sql`(
            oc.color_identity IS NULL OR
            NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(oc.color_identity) AS card_color
              WHERE card_color NOT IN (${sql.raw(
                colorSet.map((c) => `'${c}'`).join(",")
              )})
            )
          )`;
        case ">=":
          return sql`(
            NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(${sql.raw(
                `'${colorSetJson}'`
              )}::jsonb) AS search_color
              WHERE search_color NOT IN (
                SELECT jsonb_array_elements_text(oc.color_identity)
                WHERE oc.color_identity IS NOT NULL
              )
            )
          )`;
        case "!":
        case "!=":
          return sql`oc.color_identity != ${colorSetJson}::jsonb`;
        default:
          return sql`oc.color_identity ?| ${sql.raw(
            `ARRAY[${colorSet.map((c) => `'${c}'`).join(",")}]`
          )}`;
      }
    }

    const colorIdentityField = oracleTable.colorIdentity;
    switch (operator) {
      case "=":
        return sql`${colorIdentityField} = ${colorSetJson}::jsonb`;
      case "<=":
        return sql`(
          ${colorIdentityField} IS NULL OR
          NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(${colorIdentityField}) AS card_color
            WHERE card_color NOT IN (${sql.raw(
              colorSet.map((c) => `'${c}'`).join(",")
            )})
          )
        )`;
      case ">=":
        return sql`(
          NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(${sql.raw(
              `'${colorSetJson}'`
            )}::jsonb) AS search_color
            WHERE search_color NOT IN (
              SELECT jsonb_array_elements_text(${colorIdentityField})
              WHERE ${colorIdentityField} IS NOT NULL
            )
          )
        )`;
      case "!":
      case "!=":
        return sql`${colorIdentityField} != ${colorSetJson}::jsonb`;
      default:
        return sql`${colorIdentityField} ?| ${sql.raw(
          `ARRAY[${colorSet.map((c) => `'${c}'`).join(",")}]`
        )}`;
    }
  }

  // Handle keyword field
  if (normalizedField === "keyword") {
    const keywordLower = value.toLowerCase();
    // Keywords are stored as JSONB array like ["Haste","First strike"]
    // Use PostgreSQL JSONB contains operator
    if (defaultTable) {
      return sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(oc.keywords) AS keyword
        WHERE lower(keyword) = ${keywordLower}
      )`;
    }
    return sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(${oracleTable.keywords}) AS keyword
      WHERE lower(keyword) = ${keywordLower}
    )`;
  }

  // Handle format legality fields
  // Common format names (whitelist to prevent SQL injection)
  const validFormats = [
    "standard",
    "future",
    "historic",
    "gladiator",
    "pioneer",
    "explorer",
    "modern",
    "legacy",
    "pauper",
    "vintage",
    "penny",
    "commander",
    "oathbreaker",
    "brawl",
    "historicbrawl",
    "alchemy",
    "paupercommander",
    "duel",
    "oldschool",
    "premodern",
    "predh",
  ];

  if (normalizedField === "format") {
    const formatLower = value.toLowerCase();
    if (!validFormats.includes(formatLower)) {
      return null;
    }
    if (defaultTable) {
      return sql`oc.legalities->>${sql.raw(`'${formatLower}'`)} = 'legal'`;
    }
    return sql`${oracleTable.legalities}->>${sql.raw(
      `'${formatLower}'`
    )} = 'legal'`;
  }

  if (normalizedField === "banned") {
    const formatLower = value.toLowerCase();
    if (!validFormats.includes(formatLower)) {
      return null;
    }
    if (defaultTable) {
      return sql`oc.legalities->>${sql.raw(`'${formatLower}'`)} = 'banned'`;
    }
    return sql`${oracleTable.legalities}->>${sql.raw(
      `'${formatLower}'`
    )} = 'banned'`;
  }

  if (normalizedField === "restricted") {
    const formatLower = value.toLowerCase();
    if (!validFormats.includes(formatLower)) {
      return null;
    }
    if (defaultTable) {
      return sql`oc.legalities->>${sql.raw(`'${formatLower}'`)} = 'restricted'`;
    }
    return sql`${oracleTable.legalities}->>${sql.raw(
      `'${formatLower}'`
    )} = 'restricted'`;
  }

  return null;
}

/**
 * Convert plain text AST node to SQL condition
 */
function plainTextToCondition(
  node: Extract<ASTNode, { type: "PLAIN_TEXT" }>,
  oracleTable: typeof oracleCards,
  defaultTable?: typeof defaultCards
): SQL {
  const searchValue = node.value.toLowerCase();
  if (defaultTable) {
    return or(
      like(sql`lower(oc.name)`, `%${searchValue}%`),
      like(sql`lower(oc.oracle_text)`, `%${searchValue}%`)
    )!;
  }
  return or(
    like(sql`lower(${oracleTable.name})`, `%${searchValue}%`),
    like(sql`lower(${oracleTable.oracleText})`, `%${searchValue}%`)
  )!;
}

/**
 * Convert AST to SQL condition
 */
function astToCondition(
  ast: ASTNode,
  oracleTable: typeof oracleCards,
  defaultTable?: typeof defaultCards
): SQL | null {
  switch (ast.type) {
    case "AND":
      const leftAnd = astToCondition(ast.left, oracleTable, defaultTable);
      const rightAnd = astToCondition(ast.right, oracleTable, defaultTable);
      if (!leftAnd) return rightAnd;
      if (!rightAnd) return leftAnd;
      return and(leftAnd, rightAnd)!;

    case "OR":
      const leftOr = astToCondition(ast.left, oracleTable, defaultTable);
      const rightOr = astToCondition(ast.right, oracleTable, defaultTable);
      if (!leftOr) return rightOr;
      if (!rightOr) return leftOr;
      return or(leftOr, rightOr)!;

    case "NOT":
      const operand = astToCondition(ast.operand, oracleTable, defaultTable);
      if (!operand) return null;
      return not(operand);

    case "FIELD":
      return fieldToCondition(ast, oracleTable, defaultTable);

    case "PLAIN_TEXT":
      return plainTextToCondition(ast, oracleTable, defaultTable);

    default:
      return null;
  }
}

/**
 * Parse Scryfall-like query syntax into an AST
 */
export function parseQuery(query: string): ASTNode {
  if (!query || query.trim().length === 0) {
    throw new Error("Query cannot be empty");
  }

  try {
    const tokens = tokenize(query.trim());
    if (tokens.length === 0) {
      throw new Error("Query contains no valid tokens");
    }
    const ast = parse(tokens);
    console.error(
      `[SEARCH] Parsed query "${query}" into AST:`,
      JSON.stringify(ast, null, 2)
    );
    return ast;
  } catch (error) {
    const errorMsg = `Query parsing error: ${
      error instanceof Error ? error.message : String(error)
    }`;
    console.error(`[SEARCH] Parse error for query "${query}":`, errorMsg);
    throw new Error(errorMsg);
  }
}

/**
 * Search oracle cards with parsed query
 * Always uses default_cards joined with oracle_cards
 */
export async function searchOracleCards(
  query: string,
  limit: number = 20
): Promise<any[]> {
  console.error(
    `[SEARCH] Starting searchOracleCards with query: "${query}", limit: ${limit}`
  );

  try {
    const ast = parseQuery(query);

    // Always use default_cards joined with oracle_cards
    const condition = astToCondition(ast, oracleCards, defaultCards);

    if (!condition) {
      console.error(`[SEARCH] No condition generated for query: "${query}"`);
      return [];
    }

    console.error(`[SEARCH] Generated condition for query: "${query}"`);

    // Join default_cards with oracle_cards
    // Use DISTINCT on oracle_id to avoid duplicates from multiple printings
    // We'll use a raw SQL approach for better control
    console.error(`[SEARCH] Executing SQL query...`);
    let results;
    try {
      results = await db.execute(sql`
        SELECT DISTINCT
          oc.oracle_id as "oracleId",
          oc.name,
          oc.mana_cost as "manaCost",
          oc.cmc,
          oc.type_line as "typeLine",
          oc.oracle_text as "oracleText",
          oc.colors,
          oc.color_identity as "colorIdentity",
          oc.keywords,
          oc.legalities,
          dc.id as "setId",
          dc."set",
          dc.set_name as "setName",
          dc.rarity,
          (dc.data->>'power') as power,
          (dc.data->>'toughness') as toughness
        FROM default_cards dc
        INNER JOIN oracle_cards oc ON dc.oracle_id = oc.oracle_id
        WHERE ${condition}
        LIMIT ${limit}
      `);
      console.error(
        `[SEARCH] SQL query executed successfully, got ${results.rows.length} rows`
      );
    } catch (dbError: any) {
      console.error(`[SEARCH] Database error executing query:`, {
        error: dbError?.message,
        code: dbError?.code,
        detail: dbError?.detail,
        stack: dbError?.stack,
      });
      throw new Error(
        `Database query failed: ${dbError?.message || String(dbError)}`
      );
    }

    // Convert raw results to objects
    const mappedResults = results.rows.map((row: any) => ({
      oracleId: row.oracleId,
      name: row.name,
      manaCost: row.manaCost,
      cmc: row.cmc,
      typeLine: row.typeLine,
      oracleText: row.oracleText,
      colors: row.colors,
      colorIdentity: row.colorIdentity,
      keywords: row.keywords,
      legalities: row.legalities,
      setId: row.setId,
      set: row.set,
      setName: row.setName,
      rarity: row.rarity,
      power: row.power,
      toughness: row.toughness,
    }));

    console.error(
      `[SEARCH] Query "${query}" returned ${mappedResults.length} results`
    );
    return mappedResults;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[SEARCH] Error in searchOracleCards for query "${query}":`,
      errorMsg
    );
    throw error;
  }
}

/**
 * Check if the AST contains fields that require default_cards (power, toughness)
 */
function checkNeedsDefaultCards(ast: ASTNode): boolean {
  switch (ast.type) {
    case "AND":
    case "OR":
      return (
        checkNeedsDefaultCards(ast.left) || checkNeedsDefaultCards(ast.right)
      );
    case "NOT":
      return checkNeedsDefaultCards(ast.operand);
    case "FIELD":
      const field = ast.field.toLowerCase();
      return (
        field === "power" ||
        field === "pow" ||
        field === "toughness" ||
        field === "tou"
      );
    case "PLAIN_TEXT":
      return false;
    default:
      return false;
  }
}

/**
 * Search collection (inventory) with same query syntax
 */
export async function searchCollection(
  query: string,
  limit: number = 20
): Promise<any[]> {
  const ast = parseQuery(query);
  const condition = astToCondition(ast, oracleCards);

  if (!condition) {
    // If no valid conditions, return empty results
    return [];
  }

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
    .where(condition)
    .limit(limit);

  return results;
}
