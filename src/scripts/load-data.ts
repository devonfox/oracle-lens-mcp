import { db, sqlite, initializeDatabase } from "../db/index.js";
import { oracleCards, defaultCards } from "../db/schema.js";
import { createWriteStream, createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
import { unlink, readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BULK_DATA_BASE = "https://api.scryfall.com/bulk-data";

interface BulkDataResponse {
  object: string;
  id: string;
  type: string;
  updated_at: string;
  uri: string;
  name: string;
  description: string;
  size: number;
  download_uri: string;
  content_type: string;
  content_encoding: string;
}

interface ScryfallOracleCard {
  oracle_id: string;
  name: string;
  mana_cost?: string | null;
  cmc?: number | null;
  type_line: string;
  oracle_text?: string | null;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  legalities?: Record<string, string>;
}

interface ScryfallDefaultCard {
  id: string;
  oracle_id?: string | null;
  name: string;
  set?: string | null;
  set_name?: string | null;
  collector_number?: string | null;
  rarity?: string | null;
  lang?: string | null;
  released_at?: string | null;
  frame?: string | null;
  border_color?: string | null;
  security_stamp?: string | null;
  [key: string]: any; // For additional fields stored in data JSON
}

async function fetchBulkDataMetadata(
  type: "oracle_cards" | "default_cards"
): Promise<BulkDataResponse> {
  console.error(`Fetching ${type} bulk data metadata...`);
  const url = `${BULK_DATA_BASE}/${type}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "OracleLens/1.0",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch bulk data metadata for ${type}: ${response.statusText}`
    );
  }
  return await response.json();
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  console.error(`Downloading file from ${url}...`);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "OracleLens/1.0",
      Accept: "*/*",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error("Response body is null");
  }

  const fileStream = createWriteStream(outputPath);
  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(Buffer.from(value));
    }
    fileStream.end();
    await new Promise<void>((resolve, reject) => {
      fileStream.on("finish", () => resolve());
      fileStream.on("error", (err) => reject(err));
    });
  } finally {
    reader.releaseLock();
  }

  console.error(`Downloaded to ${outputPath}`);
}

async function decompressFile(
  inputPath: string,
  outputPath: string
): Promise<void> {
  console.error("Checking if file needs decompression...");
  const { readFileSync } = await import("fs");

  // Check if file is gzipped by reading first two bytes (gzip magic number: 1f 8b)
  const buffer = readFileSync(inputPath);
  const isGzipped =
    buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;

  if (isGzipped) {
    console.error("File is gzipped, decompressing...");
    await pipeline(
      createReadStream(inputPath),
      createGunzip(),
      createWriteStream(outputPath)
    );
    console.error(`Decompressed to ${outputPath}`);
  } else {
    console.error("File is not gzipped, copying as-is...");
    await pipeline(createReadStream(inputPath), createWriteStream(outputPath));
    console.error(`Copied to ${outputPath}`);
  }
}

async function loadOracleCardsIntoDatabase(filePath: string): Promise<void> {
  console.error("Loading Oracle cards into database...");

  // Drop existing data
  console.error("Dropping existing oracle_cards data...");
  sqlite.exec("DELETE FROM oracle_cards");

  // Read and parse JSON file
  console.error("Reading JSON file...");
  const fileContent = await readFile(filePath, "utf-8");
  const cards: ScryfallOracleCard[] = JSON.parse(fileContent);

  console.error(`Found ${cards.length} Oracle cards to import`);

  // Process in batches to avoid memory issues
  const BATCH_SIZE = 1000;
  let processed = 0;

  for (let i = 0; i < cards.length; i += BATCH_SIZE) {
    const batch = cards.slice(i, i + BATCH_SIZE);

    const insertData = batch.map((card) => ({
      oracleId: card.oracle_id,
      name: card.name,
      manaCost: card.mana_cost || null,
      cmc: card.cmc != null ? Math.round(card.cmc) : null,
      typeLine: card.type_line,
      oracleText: card.oracle_text || null,
      colors: card.colors ? JSON.stringify(card.colors) : null,
      colorIdentity: card.color_identity
        ? JSON.stringify(card.color_identity)
        : null,
      keywords: card.keywords ? JSON.stringify(card.keywords) : null,
      legalities: card.legalities ? JSON.stringify(card.legalities) : null,
    }));

    await db.insert(oracleCards).values(insertData);
    processed += batch.length;
    console.error(
      `Processed ${processed}/${cards.length} Oracle cards (${Math.round(
        (processed / cards.length) * 100
      )}%)`
    );
  }

  console.error(`Successfully loaded ${processed} Oracle cards into database`);
}

async function loadDefaultCardsIntoDatabase(filePath: string): Promise<void> {
  console.error("Loading Default cards into database...");

  // Check if table exists, if not create it
  const tableExists = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='default_cards'"
    )
    .get();

  if (!tableExists) {
    console.error("default_cards table does not exist. Creating it...");
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS default_cards (
        id TEXT PRIMARY KEY,
        oracle_id TEXT,
        name TEXT NOT NULL,
        \`set\` TEXT,
        set_name TEXT,
        collector_number TEXT,
        rarity TEXT,
        lang TEXT,
        released_at TEXT,
        frame TEXT,
        border_color TEXT,
        security_stamp TEXT,
        data TEXT,
        FOREIGN KEY (oracle_id) REFERENCES oracle_cards(oracle_id)
      );
      CREATE INDEX IF NOT EXISTS idx_default_cards_oracle_id ON default_cards(oracle_id);
      CREATE INDEX IF NOT EXISTS idx_default_cards_set ON default_cards(\`set\`);
      CREATE INDEX IF NOT EXISTS idx_default_cards_name ON default_cards(name);
    `);
  }

  // Drop existing data
  console.error("Dropping existing default_cards data...");
  sqlite.exec("DELETE FROM default_cards");

  // Read and parse JSON file
  console.error("Reading JSON file...");
  const fileContent = await readFile(filePath, "utf-8");
  const cards: ScryfallDefaultCard[] = JSON.parse(fileContent);

  console.error(`Found ${cards.length} Default cards (printings) to import`);

  // Process in batches to avoid memory issues
  const BATCH_SIZE = 1000;
  let processed = 0;

  for (let i = 0; i < cards.length; i += BATCH_SIZE) {
    const batch = cards.slice(i, i + BATCH_SIZE);

    const insertData = batch.map((card) => {
      // Store the full card object in the data field for additional fields
      const {
        id,
        oracle_id,
        name,
        set,
        set_name,
        collector_number,
        rarity,
        lang,
        released_at,
        frame,
        border_color,
        security_stamp,
        ...rest
      } = card;
      const additionalData = Object.keys(rest).length > 0 ? rest : null;

      return {
        id: card.id,
        oracleId: card.oracle_id || null,
        name: card.name,
        set: card.set || null,
        setName: card.set_name || null,
        collectorNumber: card.collector_number || null,
        rarity: card.rarity || null,
        lang: card.lang || null,
        releasedAt: card.released_at || null,
        frame: card.frame || null,
        borderColor: card.border_color || null,
        securityStamp: card.security_stamp || null,
        data: additionalData ? JSON.stringify(additionalData) : null,
      };
    });

    await db.insert(defaultCards).values(insertData);
    processed += batch.length;
    console.error(
      `Processed ${processed}/${cards.length} Default cards (${Math.round(
        (processed / cards.length) * 100
      )}%)`
    );
  }

  console.error(`Successfully loaded ${processed} Default cards into database`);
}

async function cleanup(files: string[]): Promise<void> {
  console.error("Cleaning up temporary files...");
  for (const file of files) {
    try {
      await unlink(file);
    } catch (error) {
      // File might not exist, ignore
    }
  }
}

async function loadDataset(
  type: "oracle_cards" | "default_cards",
  tempFile: string,
  decompressedFile: string
): Promise<void> {
  console.error(`\n=== Loading ${type} ===`);

  // Fetch metadata
  const metadata = await fetchBulkDataMetadata(type);
  console.error(`Bulk data: ${metadata.name}`);
  console.error(`Size: ${(metadata.size / 1024 / 1024).toFixed(2)} MB`);
  console.error(`Updated: ${metadata.updated_at}`);

  // Download file
  await downloadFile(metadata.download_uri, tempFile);

  // Decompress
  await decompressFile(tempFile, decompressedFile);

  // Load into database
  if (type === "oracle_cards") {
    await loadOracleCardsIntoDatabase(decompressedFile);
  } else {
    await loadDefaultCardsIntoDatabase(decompressedFile);
  }

  // Cleanup
  await cleanup([tempFile, decompressedFile]);
}

async function main() {
  try {
    // Initialize database (creates tables if they don't exist)
    await initializeDatabase();

    const tempDir = path.join(__dirname, "../../");

    // Load Oracle cards first (default_cards references oracle_cards)
    const oracleTempFile = path.join(tempDir, "temp-oracle-cards.json.gz");
    const oracleDecompressedFile = path.join(tempDir, "temp-oracle-cards.json");
    await loadDataset("oracle_cards", oracleTempFile, oracleDecompressedFile);

    // Load Default cards second
    const defaultTempFile = path.join(tempDir, "temp-default-cards.json.gz");
    const defaultDecompressedFile = path.join(
      tempDir,
      "temp-default-cards.json"
    );
    await loadDataset(
      "default_cards",
      defaultTempFile,
      defaultDecompressedFile
    );

    console.error("\n✅ Done! Both datasets loaded successfully.");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
