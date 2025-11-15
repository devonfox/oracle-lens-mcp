# Oracle Lens - MTG MCP Server

A Model Context Protocol (MCP) server for Magic: The Gathering oracle card search and collection management.

## Features

- **Oracle Card Search**: Search all MTG cards using Scryfall-like syntax
- **Collection Management**: Search and manage your personal MTG collection
- **Automatic Data Loading**: Load Oracle Cards from Scryfall bulk data API
- **Collection Import**: Import collections from MTGGoldfish format (coming soon)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Build the project:
```bash
npm run build
```

3. Run the server:
```bash
npm start
```

Or run in development mode:
```bash
npm run dev
```

## Database Setup

The server uses SQLite with Drizzle ORM. The database will be automatically created at `db/mtg.db` on first run, and tables will be created automatically if migrations don't exist.

### Loading Oracle Cards Data

To load the Oracle Cards database from Scryfall:

```bash
npm run load-oracle
```

This script will:
1. Fetch the latest Oracle Cards bulk data metadata from Scryfall
2. Download the ~160MB JSON file (gzipped)
3. Decompress and parse the data
4. Load all cards into the database (~36k cards)
5. Drop and reload existing data if run again

**Note:** The first run will take several minutes to download and process the data.

### Generating Migrations

To generate new migrations after schema changes:
```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

## MCP Tools

### `oracle_search`
Search all Oracle cards using Scryfall-like syntax.

**Query Syntax:**
- `t:enchantment` - Search by type (e.g., `t:creature`, `t:instant`)
- `o:"draw a card"` - Search oracle text (use quotes for phrases)
- `c:red` or `c:R` - Search by colors (maps: red→R, blue→U, black→B, white→W, green→G)
- `ci:WUG` or `ci:red` - Search by color identity (same color mapping)
- `cmc<=3` - Search by converted mana cost (less than or equal)
- `cmc>=5` - Search by converted mana cost (greater than or equal)
- `k:haste` - Search by keyword (e.g., `k:lifelink`, `k:haste`)
- Plain text - Searches card name and oracle text

**Combining Filters:**
You can combine multiple filters: `t:creature ci:red k:haste` finds red creatures with the haste keyword.

**Examples:**
```json
{
  "query": "t:enchantment ci:WUG",
  "limit": 10
}
```

```json
{
  "query": "t:creature c:red k:haste",
  "limit": 20
}
```

```json
{
  "query": "t:creature o:haste cmc<=3",
  "limit": 15
}
```

### `collection_search`
Same syntax as `oracle_search`, but only returns cards in your collection.

### `import_collection`
Import a collection from MTGGoldfish format (coming soon).

## Resources

- `mcp://mtg/schema/oracle_cards` - Schema documentation
- `mcp://mtg/collection/summary` - Collection summary

## Configuration

Set the database path via environment variable:
```bash
DB_PATH=/path/to/db.db npm start
```

## Connecting to Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "oracle-lens": {
      "command": "node",
      "args": ["/absolute/path/to/oracle-lens/build/index.js"]
    }
  }
}
```

## Project Status

- [x] Implement Scryfall Oracle bulk data importer
- [x] Basic search with Scryfall-like syntax
- [x] Support for type, color, color identity, CMC, keyword, and oracle text filters
- [x] Color name mapping (red→R, blue→U, etc.)
- [ ] Implement MTGGoldfish collection importer
- [ ] Add `suggest_additions` tool
- [ ] Enhance query parser with more Scryfall syntax (mana cost, power/toughness, etc.)
- [ ] Add collection summary resource implementation

## Troubleshooting

### Search returns empty results

- Make sure you've loaded the Oracle Cards data: `npm run load-oracle`
- Check that color filters use the correct format: `c:red` or `c:R` (not `c:Red`)
- Keywords are case-insensitive: `k:haste` works the same as `k:Haste`

### Database not found

The database is automatically created on first run. If you need to reset it, delete `db/mtg.db` and restart the server.
