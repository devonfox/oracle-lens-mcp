import { pgTable, varchar, integer, jsonb, date } from "drizzle-orm/pg-core";

/**
 * Oracle cards table - stores Scryfall Oracle bulk data
 * One record per Oracle card (unique rules object)
 */
export const oracleCards = pgTable("oracle_cards", {
  oracleId: varchar("oracle_id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 500 }).notNull(),
  manaCost: varchar("mana_cost", { length: 100 }),
  cmc: integer("cmc"),
  typeLine: varchar("type_line", { length: 500 }).notNull(),
  oracleText: varchar("oracle_text", { length: 10000 }),
  colors: jsonb("colors"), // JSON array
  colorIdentity: jsonb("color_identity"), // JSON array
  keywords: jsonb("keywords"), // JSON array
  legalities: jsonb("legalities"), // JSON object
});

/**
 * Default cards table - stores Scryfall Default bulk data
 * One record per card printing (set-specific data)
 */
export const defaultCards = pgTable("default_cards", {
  id: varchar("id", { length: 255 }).primaryKey(), // Scryfall card UUID
  oracleId: varchar("oracle_id", { length: 255 }).references(
    () => oracleCards.oracleId
  ),
  name: varchar("name", { length: 500 }).notNull(),
  set: varchar("set", { length: 50 }), // Set code (e.g., "cmm", "m21")
  setName: varchar("set_name", { length: 500 }), // Full set name
  collectorNumber: varchar("collector_number", { length: 50 }),
  rarity: varchar("rarity", { length: 50 }),
  lang: varchar("lang", { length: 10 }), // Language code
  releasedAt: date("released_at"), // Date
  frame: varchar("frame", { length: 50 }), // Frame version (e.g., "2015", "1993")
  borderColor: varchar("border_color", { length: 50 }), // Border color
  securityStamp: varchar("security_stamp", { length: 50 }), // Security stamp
  data: jsonb("data"), // Full card object as JSONB for additional fields
});

/**
 * Inventory table - stores user's collection
 */
export const inventory = pgTable("inventory", {
  oracleId: varchar("oracle_id", { length: 255 })
    .primaryKey()
    .references(() => oracleCards.oracleId),
  qty: integer("qty").notNull().default(1),
  tags: jsonb("tags"), // JSON array, optional
  location: varchar("location", { length: 255 }), // Optional location identifier
});

export type OracleCard = typeof oracleCards.$inferSelect;
export type NewOracleCard = typeof oracleCards.$inferInsert;
export type DefaultCard = typeof defaultCards.$inferSelect;
export type NewDefaultCard = typeof defaultCards.$inferInsert;
export type InventoryItem = typeof inventory.$inferSelect;
export type NewInventoryItem = typeof inventory.$inferInsert;
