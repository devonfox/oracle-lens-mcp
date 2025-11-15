import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database file path
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../../db/mtg.db");

// Create database directory if it doesn't exist
const dbDir = path.dirname(DB_PATH);
try {
  mkdirSync(dbDir, { recursive: true });
} catch (error) {
  // Directory might already exist, ignore
}

// Initialize database
const sqlite: Database.Database = new Database(DB_PATH);
export const db = drizzle({ client: sqlite, schema });
export { sqlite };

// Run migrations
export async function initializeDatabase() {
  try {
    const migrationsPath = path.join(process.cwd(), "db/migrations");
    migrate(db, {
      migrationsFolder: migrationsPath,
    });
    console.error("Database initialized successfully");
  } catch (error: any) {
    // If migrations folder doesn't exist yet, create tables manually
    if (error?.code === "ENOENT" || error?.message?.includes("migrations")) {
      console.error("Migrations folder not found, creating tables...");
      createTables();
    } else {
      console.error("Error initializing database:", error);
    }
  }
}

// Create tables if migrations don't exist
function createTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS oracle_cards (
      oracle_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mana_cost TEXT,
      cmc INTEGER,
      type_line TEXT NOT NULL,
      oracle_text TEXT,
      colors TEXT,
      color_identity TEXT,
      keywords TEXT,
      legalities TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory (
      oracle_id TEXT PRIMARY KEY,
      qty INTEGER NOT NULL DEFAULT 1,
      tags TEXT,
      location TEXT,
      FOREIGN KEY (oracle_id) REFERENCES oracle_cards(oracle_id)
    );

    CREATE INDEX IF NOT EXISTS idx_oracle_cards_name ON oracle_cards(name);
    CREATE INDEX IF NOT EXISTS idx_oracle_cards_type ON oracle_cards(type_line);
    CREATE INDEX IF NOT EXISTS idx_oracle_cards_cmc ON oracle_cards(cmc);
  `);
  console.error("Tables created successfully");
}
