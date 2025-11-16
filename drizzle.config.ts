import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://localhost:5432/mtg",
  },
  migrations: {
    prefix: "index", // Options: "index" (0001_name), "timestamp" (20240101120000_name), "unix" (1704067200_name), or "none" (name)
  },
} satisfies Config;
