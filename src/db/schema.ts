import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Oracle cards table - stores Scryfall Oracle bulk data
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
export type InventoryItem = typeof inventory.$inferSelect;
export type NewInventoryItem = typeof inventory.$inferInsert;
