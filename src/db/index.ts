import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";

// Database connection URL
// Note: dotenv should be loaded in index.ts before this module is imported
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://localhost:5432/mtg";

// Log the database URL (without password) for debugging
if (process.env.DATABASE_URL) {
  const urlObj = new URL(process.env.DATABASE_URL);
  const safeUrl = `${urlObj.protocol}//${
    urlObj.username ? urlObj.username + "@" : ""
  }${urlObj.host}${urlObj.pathname}`;
  console.error(`Using DATABASE_URL: ${safeUrl}`);
} else {
  console.error(
    "DATABASE_URL not set, using default: postgresql://localhost:5432/mtg"
  );
  console.error(
    "Note: If you see authentication errors, create a .env file with DATABASE_URL"
  );
}

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
    } catch (connError: any) {
      // Provide helpful error message for connection issues
      if (connError?.code === "28000" || connError?.message?.includes("role")) {
        console.error("\n=== DATABASE CONNECTION ERROR ===");
        console.error(`Authentication failed: ${connError?.message}`);
        console.error(
          "\nTo fix this, create a .env file in the project root with:"
        );
        console.error(
          "  DATABASE_URL=postgresql://YOUR_USERNAME@localhost:5432/mtg"
        );
        console.error("\nOr if your PostgreSQL requires a password:");
        console.error(
          "  DATABASE_URL=postgresql://YOUR_USERNAME:YOUR_PASSWORD@localhost:5432/mtg"
        );
        console.error("\nTo find your PostgreSQL username, try:");
        console.error("  psql -l  # or: whoami");
        console.error("===========================\n");
      }
      throw connError;
    } finally {
      testClient.release();
    }

    // Resolve migrations path - handle both source and build directories
    const migrationsPath = path.join(process.cwd(), "db/migrations");
    console.error(`Looking for migrations at: ${migrationsPath}`);

    await migrate(db, {
      migrationsFolder: migrationsPath,
    });
    console.error("Database initialized successfully");
  } catch (error: any) {
    // Check if this is a migration file error (missing _journal.json or migrations folder)
    const isMigrationError =
      error?.code === "ENOENT" ||
      error?.message?.includes("migrations") ||
      error?.message?.includes("_journal.json") ||
      error?.message?.includes("Can't find meta");

    if (isMigrationError) {
      console.error(
        "Migrations not found or incomplete, creating tables directly..."
      );
      console.error(`Migration error: ${error?.message}`);
      try {
        await createTables();
        console.error("Tables created successfully");
        return; // Successfully created tables, exit early
      } catch (createError: any) {
        // If createTables fails, check if tables already exist
        if (
          createError?.code === "42P07" ||
          createError?.message?.includes("already exists")
        ) {
          console.error("Tables already exist, skipping creation");
          return; // Tables exist, that's fine
        }
        // Re-throw if it's a different error
        throw createError;
      }
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
