import { db, sqlite, initializeDatabase } from "../db/index.js";
import { oracleCards } from "../db/schema.js";
import { createWriteStream, createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
import { unlink, readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BULK_DATA_API = "https://api.scryfall.com/bulk-data/oracle-cards";
const TEMP_FILE = path.join(__dirname, "../../temp-oracle-cards.json.gz");
const DECOMPRESSED_FILE = path.join(__dirname, "../../temp-oracle-cards.json");

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

interface ScryfallCard {
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

async function fetchBulkDataMetadata(): Promise<BulkDataResponse> {
  console.error("Fetching bulk data metadata...");
  const response = await fetch(BULK_DATA_API, {
    headers: {
      "User-Agent": "OracleLens/1.0",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch bulk data metadata: ${response.statusText}`
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

async function loadCardsIntoDatabase(filePath: string): Promise<void> {
  console.error("Loading cards into database...");

  // Drop existing data
  console.error("Dropping existing oracle_cards data...");
  sqlite.exec("DELETE FROM oracle_cards");

  // Read and parse JSON file
  console.error("Reading JSON file...");
  const fileContent = await readFile(filePath, "utf-8");
  const cards: ScryfallCard[] = JSON.parse(fileContent);

  console.error(`Found ${cards.length} cards to import`);

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
      `Processed ${processed}/${cards.length} cards (${Math.round(
        (processed / cards.length) * 100
      )}%)`
    );
  }

  console.error(`Successfully loaded ${processed} cards into database`);
}

async function cleanup(): Promise<void> {
  console.error("Cleaning up temporary files...");
  try {
    await unlink(TEMP_FILE);
  } catch (error) {
    // File might not exist, ignore
  }
  try {
    await unlink(DECOMPRESSED_FILE);
  } catch (error) {
    // File might not exist, ignore
  }
}

async function main() {
  try {
    // Initialize database (creates tables if they don't exist)
    await initializeDatabase();

    // Fetch metadata
    const metadata = await fetchBulkDataMetadata();
    console.error(`Bulk data: ${metadata.name}`);
    console.error(`Size: ${(metadata.size / 1024 / 1024).toFixed(2)} MB`);
    console.error(`Updated: ${metadata.updated_at}`);

    // Download file
    await downloadFile(metadata.download_uri, TEMP_FILE);

    // Decompress
    await decompressFile(TEMP_FILE, DECOMPRESSED_FILE);

    // Load into database
    await loadCardsIntoDatabase(DECOMPRESSED_FILE);

    // Cleanup
    await cleanup();

    console.error("Done!");
  } catch (error) {
    console.error("Error:", error);
    await cleanup();
    process.exit(1);
  }
}

main();
