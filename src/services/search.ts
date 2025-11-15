import { db } from "../db/index.js";
import { oracleCards, inventory } from "../db/schema.js";
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
} from "drizzle-orm";

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
 * Parse a color set string (e.g., "wbg", "WUBRG") into an array of normalized colors
 */
function parseColorSet(colorStr: string): string[] {
  const colors: string[] = [];
  const normalized = colorStr.toLowerCase();

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

    // Handle fielded terms (e.g., t:creature, ci<=wbg, cmc>=3, o:"draw a card")
    const fieldMatch = query.slice(i).match(/^([a-z]+)([<>=!]+)?:/i);
    if (fieldMatch) {
      const fieldName = fieldMatch[1].toLowerCase();
      const operator = fieldMatch[2] || "";
      i += fieldMatch[0].length;

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
 */
function fieldToCondition(
  node: Extract<ASTNode, { type: "FIELD" }>,
  table: typeof oracleCards
): SQL | null {
  const { field, operator, value } = node;

  // Field aliases
  const fieldMap: Record<string, string> = {
    n: "name",
    name: "name",
    t: "type",
    type: "type",
    o: "oracle",
    oracle: "oracle",
    c: "colors",
    colors: "colors",
    ci: "color_identity",
    color_identity: "color_identity",
    cmc: "cmc",
    mv: "cmc",
    mana: "cmc",
    k: "keyword",
    keyword: "keyword",
  };

  const normalizedField = fieldMap[field];
  if (!normalizedField) {
    return null; // Unknown field, skip
  }

  // Handle name field
  if (normalizedField === "name") {
    const searchValue = value.toLowerCase();
    return like(sql`lower(${table.name})`, `%${searchValue}%`);
  }

  // Handle type field
  if (normalizedField === "type") {
    const searchValue = value.toLowerCase();
    return like(sql`lower(${table.typeLine})`, `%${searchValue}%`);
  }

  // Handle oracle text field
  if (normalizedField === "oracle") {
    const searchValue = value.toLowerCase();
    return like(sql`lower(${table.oracleText})`, `%${searchValue}%`);
  }

  // Handle CMC field
  if (normalizedField === "cmc") {
    const numValue = parseInt(value, 10);
    if (isNaN(numValue)) {
      return null;
    }

    switch (operator) {
      case "=":
        return eq(table.cmc, numValue);
      case "<=":
        return lte(table.cmc, numValue);
      case ">=":
        return gte(table.cmc, numValue);
      case "<":
        return lt(table.cmc, numValue);
      case ">":
        return gt(table.cmc, numValue);
      default:
        // Default to = if no operator
        return eq(table.cmc, numValue);
    }
  }

  // Handle colors field
  if (normalizedField === "colors") {
    const colorSet = parseColorSet(value);
    if (colorSet.length === 0) {
      return null;
    }

    // Colors are stored as JSON array string like ["W","U","B"]
    // We need to check if the card's colors match the operator
    const colorSetStr = JSON.stringify(colorSet);
    const colorSetLower = colorSet.map((c) => c.toLowerCase());

    switch (operator) {
      case "=":
        // Exact match: card colors must exactly equal the set
        // Compare normalized JSON arrays
        return sql`lower(${table.colors}) = lower(${colorSetStr})`;
      case "<=":
        // Subset: card colors must be a subset of the given set
        // Check that all card colors are in the given set
        // If card has no colors, it's a subset of any set
        return sql`(
          ${table.colors} IS NULL OR
          (SELECT COUNT(*) FROM json_each(${table.colors}) 
           WHERE lower(trim(json_each.value, '"')) NOT IN (${sql.raw(
             colorSetLower.map((c) => `'${c}'`).join(",")
           )})) = 0
        )`;
      case ">=":
        // Superset: card colors must contain all colors in the set
        // Check that all colors in the set are in the card's colors
        return sql`(
          SELECT COUNT(*) FROM json_each(${sql.raw(`'${colorSetStr}'`)})
          WHERE lower(trim(json_each.value, '"')) NOT IN (
            SELECT lower(trim(value, '"')) FROM json_each(${table.colors})
            WHERE ${table.colors} IS NOT NULL
          )
        ) = 0`;
      case "!":
        // Not equal: card colors must not equal the set
        return sql`lower(${table.colors}) != lower(${colorSetStr})`;
      default:
        // Default: check if any color matches (contains)
        return sql`(
          SELECT COUNT(*) FROM json_each(${sql.raw(`'${colorSetStr}'`)})
          WHERE lower(trim(json_each.value, '"')) IN (
            SELECT lower(trim(value, '"')) FROM json_each(${table.colors})
            WHERE ${table.colors} IS NOT NULL
          )
        ) > 0`;
    }
  }

  // Handle color_identity field (same logic as colors)
  if (normalizedField === "color_identity") {
    const colorSet = parseColorSet(value);
    if (colorSet.length === 0) {
      return null;
    }

    const colorSetStr = JSON.stringify(colorSet);
    const colorSetLower = colorSet.map((c) => c.toLowerCase());

    switch (operator) {
      case "=":
        return sql`lower(${table.colorIdentity}) = lower(${colorSetStr})`;
      case "<=":
        return sql`(
          ${table.colorIdentity} IS NULL OR
          (SELECT COUNT(*) FROM json_each(${table.colorIdentity}) 
           WHERE lower(trim(json_each.value, '"')) NOT IN (${sql.raw(
             colorSetLower.map((c) => `'${c}'`).join(",")
           )})) = 0
        )`;
      case ">=":
        return sql`(
          SELECT COUNT(*) FROM json_each(${sql.raw(`'${colorSetStr}'`)})
          WHERE lower(trim(json_each.value, '"')) NOT IN (
            SELECT lower(trim(value, '"')) FROM json_each(${
              table.colorIdentity
            })
            WHERE ${table.colorIdentity} IS NOT NULL
          )
        ) = 0`;
      case "!":
        return sql`lower(${table.colorIdentity}) != lower(${colorSetStr})`;
      default:
        return sql`(
          SELECT COUNT(*) FROM json_each(${sql.raw(`'${colorSetStr}'`)})
          WHERE lower(trim(json_each.value, '"')) IN (
            SELECT lower(trim(value, '"')) FROM json_each(${
              table.colorIdentity
            })
            WHERE ${table.colorIdentity} IS NOT NULL
          )
        ) > 0`;
    }
  }

  // Handle keyword field
  if (normalizedField === "keyword") {
    const keywordLower = value.toLowerCase();
    // Keywords are stored as JSON array string like ["Haste","First strike"]
    return like(sql`lower(${table.keywords})`, `%"${keywordLower}"%`);
  }

  return null;
}

/**
 * Convert plain text AST node to SQL condition
 */
function plainTextToCondition(
  node: Extract<ASTNode, { type: "PLAIN_TEXT" }>,
  table: typeof oracleCards
): SQL {
  const searchValue = node.value.toLowerCase();
  return or(
    like(sql`lower(${table.name})`, `%${searchValue}%`),
    like(sql`lower(${table.oracleText})`, `%${searchValue}%`)
  )!;
}

/**
 * Convert AST to SQL condition
 */
function astToCondition(ast: ASTNode, table: typeof oracleCards): SQL | null {
  switch (ast.type) {
    case "AND":
      const leftAnd = astToCondition(ast.left, table);
      const rightAnd = astToCondition(ast.right, table);
      if (!leftAnd) return rightAnd;
      if (!rightAnd) return leftAnd;
      return and(leftAnd, rightAnd)!;

    case "OR":
      const leftOr = astToCondition(ast.left, table);
      const rightOr = astToCondition(ast.right, table);
      if (!leftOr) return rightOr;
      if (!rightOr) return leftOr;
      return or(leftOr, rightOr)!;

    case "NOT":
      const operand = astToCondition(ast.operand, table);
      if (!operand) return null;
      return not(operand);

    case "FIELD":
      return fieldToCondition(ast, table);

    case "PLAIN_TEXT":
      return plainTextToCondition(ast, table);

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
    return parse(tokens);
  } catch (error) {
    throw new Error(
      `Query parsing error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Search oracle cards with parsed query
 */
export async function searchOracleCards(
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
    .select()
    .from(oracleCards)
    .where(condition)
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
