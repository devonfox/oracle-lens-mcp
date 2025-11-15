import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Oracle cards table - stores Scryfall Oracle bulk data
 * One record per Oracle card (unique rules object)
 */
export const oracleCards = sqliteTable("oracle_cards", {
  oracleId: text("oracle_id").primaryKey(),
  name: text("name").notNull(),
  manaCost: text("mana_cost"),
  cmc: integer("cmc"),
  typeLine: text("type_line").notNull(),
  oracleText: text("oracle_text"),
  colors: text("colors"), // JSON array as string
  colorIdentity: text("color_identity"), // JSON array as string
  keywords: text("keywords"), // JSON array as string
  legalities: text("legalities"), // JSON object as string
});

/**
 * Default cards table - stores Scryfall Default bulk data
 * One record per card printing (set-specific data)
 */
export const defaultCards = sqliteTable("default_cards", {
  id: text("id").primaryKey(), // Scryfall card UUID
  oracleId: text("oracle_id").references(() => oracleCards.oracleId),
  name: text("name").notNull(),
  set: text("set"), // Set code (e.g., "cmm", "m21")
  setName: text("set_name"), // Full set name
  collectorNumber: text("collector_number"),
  rarity: text("rarity"),
  lang: text("lang"), // Language code
  releasedAt: text("released_at"), // ISO date string
  frame: text("frame"), // Frame version (e.g., "2015", "1993")
  borderColor: text("border_color"), // Border color (e.g., "black", "white")
  securityStamp: text("security_stamp"), // Security stamp (e.g., "oval", "triangle")
  data: text("data"), // Full card object as JSON string for additional fields
});

/**
 * Inventory table - stores user's collection
 */
export const inventory = sqliteTable("inventory", {
  oracleId: text("oracle_id")
    .primaryKey()
    .references(() => oracleCards.oracleId),
  qty: integer("qty").notNull().default(1),
  tags: text("tags"), // JSON array as string, optional
  location: text("location"), // Optional location identifier
});

export type OracleCard = typeof oracleCards.$inferSelect;
export type NewOracleCard = typeof oracleCards.$inferInsert;
export type DefaultCard = typeof defaultCards.$inferSelect;
export type NewDefaultCard = typeof defaultCards.$inferInsert;
export type InventoryItem = typeof inventory.$inferSelect;
export type NewInventoryItem = typeof inventory.$inferInsert;
