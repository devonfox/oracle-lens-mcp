import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";

// Database connection URL
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://localhost:5432/mtg";

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Initialize database
export const db = drizzle({ client: pool, schema });
export { pool };

// Run migrations
export async function initializeDatabase() {
  try {
    // Test database connection first
    console.error("Testing database connection...");
    const testClient = await pool.connect();
    try {
      await testClient.query("SELECT 1");
      console.error("Database connection successful");
    } finally {
      testClient.release();
    }

    const migrationsPath = path.join(process.cwd(), "db/migrations");
    await migrate(db, {
      migrationsFolder: migrationsPath,
    });
    console.error("Database initialized successfully");
  } catch (error: any) {
    // If migrations folder doesn't exist yet, create tables manually
    if (error?.code === "ENOENT" || error?.message?.includes("migrations")) {
      console.error("Migrations folder not found, creating tables...");
      await createTables();
    } else if (
      error?.code === "42P07" ||
      error?.message?.includes("already exists")
    ) {
      // Table already exists (PostgreSQL error code 42P07)
      console.error("Migration skipped: table already exists");
    } else {
      console.error("Error initializing database:", error);
      console.error("Error details:", {
        code: error?.code,
        message: error?.message,
        stack: error?.stack,
      });
      throw error;
    }
  }
}

// Create tables if migrations don't exist
async function createTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS oracle_cards (
        oracle_id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(500) NOT NULL,
        mana_cost VARCHAR(100),
        cmc INTEGER,
        type_line VARCHAR(500) NOT NULL,
        oracle_text VARCHAR(10000),
        colors JSONB,
        color_identity JSONB,
        keywords JSONB,
        legalities JSONB
      );

      CREATE TABLE IF NOT EXISTS default_cards (
        id VARCHAR(255) PRIMARY KEY,
        oracle_id VARCHAR(255),
        name VARCHAR(500) NOT NULL,
        "set" VARCHAR(50),
        set_name VARCHAR(500),
        collector_number VARCHAR(50),
        rarity VARCHAR(50),
        lang VARCHAR(10),
        released_at DATE,
        frame VARCHAR(50),
        border_color VARCHAR(50),
        security_stamp VARCHAR(50),
        data JSONB,
        FOREIGN KEY (oracle_id) REFERENCES oracle_cards(oracle_id)
      );

      CREATE TABLE IF NOT EXISTS inventory (
        oracle_id VARCHAR(255) PRIMARY KEY,
        qty INTEGER NOT NULL DEFAULT 1,
        tags JSONB,
        location VARCHAR(255),
        FOREIGN KEY (oracle_id) REFERENCES oracle_cards(oracle_id)
      );

      CREATE INDEX IF NOT EXISTS idx_oracle_cards_name ON oracle_cards(name);
      CREATE INDEX IF NOT EXISTS idx_oracle_cards_type ON oracle_cards(type_line);
      CREATE INDEX IF NOT EXISTS idx_oracle_cards_cmc ON oracle_cards(cmc);
      CREATE INDEX IF NOT EXISTS idx_default_cards_oracle_id ON default_cards(oracle_id);
      CREATE INDEX IF NOT EXISTS idx_default_cards_set ON default_cards("set");
      CREATE INDEX IF NOT EXISTS idx_default_cards_name ON default_cards(name);
    `);
    console.error("Tables created successfully");
  } finally {
    client.release();
  }
}
