# Oracle Lens - MTG MCP Server

A Model Context Protocol (MCP) server for Magic: The Gathering oracle card search and collection management.

## Features

- **Oracle Card Search**: Search all MTG cards using Scryfall-like syntax
- **Collection Management**: Search and manage your personal MTG collection
- **Dual Dataset Support**: Load both Oracle Cards (rules-based) and Default Cards
  (printing-based) from Scryfall bulk data API
- **Collection Import**: Import collections from MTGGoldfish format (coming soon)

## Setup

1. Install dependencies:

```bash
npm install
```

1. Build the project:

```bash
npm run build
```

1. Run the server:

The server supports two transport modes:

**Stdio Mode (default)** - For use with MCP clients like Claude Desktop:

```bash
npm start
```

**HTTP Mode** - For exposing the server on a network port:

```bash
MCP_PORT=3000 npm start
```

Or run in development mode:

```bash
npm run dev
# or for HTTP mode:
MCP_PORT=3000 npm run dev
```

## Usage

### Stdio Mode (Default)

Stdio mode is designed for use with MCP clients that communicate via standard
input/output. This is the default mode when `MCP_PORT` is not set.

**Use Cases:**

- Claude Desktop
- Other MCP clients that spawn processes
- Local development and testing

**Running:**

```bash
npm start
# or
npm run dev
```

The server will communicate via stdin/stdout. No network port is exposed.

### HTTP Mode

HTTP mode exposes the server as an HTTP endpoint using the MCP Streamable HTTP
protocol. This allows remote clients to connect over the network.

**Use Cases:**

- Remote MCP clients
- Web applications
- Microservices architecture
- Docker containers
- Cloud deployments

**Running:**

```bash
# Default port 3000
MCP_PORT=3000 npm start

# Custom port
MCP_PORT=8080 npm start

# Development mode
MCP_PORT=3000 npm run dev
```

**Endpoint:**
The server will be available at `http://localhost:PORT/mcp` (e.g., `http://localhost:3000/mcp`)

**Connecting to HTTP Server:**

The HTTP server implements the MCP Streamable HTTP protocol:

1. **Initialize Session** - Send a POST request to `/mcp` with an `initialize` JSON-RPC message:

   ```bash
   curl -X POST http://localhost:3000/mcp \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 1,
       "method": "initialize",
       "params": {
         "protocolVersion": "2024-11-05",
         "capabilities": {},
         "clientInfo": {
           "name": "example-client",
           "version": "1.0.0"
         }
       }
     }'
   ```

2. **Session ID** - The server will respond with a `Mcp-Session-Id` header. Include this header in all subsequent requests:

   ```bash
   curl -X POST http://localhost:3000/mcp \
     -H "Content-Type: application/json" \
     -H "Mcp-Session-Id: YOUR_SESSION_ID" \
     -d '{
       "jsonrpc": "2.0",
       "id": 2,
       "method": "tools/list"
     }'
   ```

3. **SSE Stream** - For streaming responses, connect to the SSE endpoint:

   ```bash
   curl -N http://localhost:3000/mcp \
     -H "Mcp-Session-Id: YOUR_SESSION_ID"
   ```

4. **Terminate Session** - Send a DELETE request to close the session:

   ```bash
   curl -X DELETE http://localhost:3000/mcp \
     -H "Mcp-Session-Id: YOUR_SESSION_ID"
   ```

**Session Management:**

- Each client connection gets a unique session ID
- Sessions are automatically cleaned up when closed
- Multiple concurrent sessions are supported

## Database Setup

The server uses SQLite with Drizzle ORM. The database will be automatically
created at `db/mtg.db` on first run, and tables will be created automatically if
migrations don't exist.

The database contains two main tables:

- **oracle_cards**: One record per Oracle card (unique rules object) - used for
  text/rules-based queries
- **default_cards**: One record per card printing - used for set-specific and printing-level queries

### Loading Data

To load both Oracle Cards and Default Cards from Scryfall:

```bash
npm run load-data
```

This script will:

1. Fetch the latest Oracle Cards bulk data metadata from Scryfall
2. Download and load Oracle Cards (~160MB, ~36k cards)
3. Fetch the latest Default Cards bulk data metadata from Scryfall
4. Download and load Default Cards (~495MB, all card printings)
5. Drop and reload existing data if run again

**Note:** The first run will take several minutes to download and process both
datasets. Oracle Cards are loaded first since Default Cards reference them via
`oracle_id`.

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

#### Basic Fields

- **Name**: `n:` or `name:` - Search card names

  - Example: `n:Lightning`, `name:Bolt`

- **Type**: `t:` or `type:` - Search by card type

  - Example: `t:creature`, `t:enchantment`, `t:legendary`

- **Oracle Text**: `o:` or `oracle:` - Search oracle text

  - Example: `o:"draw a card"`, `o:destroy` (use quotes for phrases)

- **Keywords**: `k:`, `kw:`, or `keyword:` - Search by keyword ability
  - Example: `k:haste`, `kw:flying`, `keyword:lifelink`

#### Colors and Color Identity

- **Colors**: `c:`, `color:`, or `colors:` - Search by card colors

  - Supports: `c:red`, `c:R`, `c:WUBRG`
  - Operators: `=`, `<=` (subset), `>=` (superset), `!=` (not equal)
  - Example: `c:red`, `c>=W`, `c<=WUG`

- **Color Identity**: `ci:`, `id:`, `identity:`, or `color_identity:` - Search by color identity

  - Same syntax as colors
  - Example: `ci:WUG`, `id:esper`, `identity<=azorius`

- **Named Color Combinations** (guilds, shards, wedges, etc.):

  - Guilds: `azorius`, `dimir`, `rakdos`, `gruul`, `selesnya`, `orzhov`, `izzet`, `golgari`, `boros`, `simic`
  - Shards: `bant`, `esper`, `grixis`, `jund`, `naya`
  - Wedges: `abzan`, `jeskai`, `sultai`, `mardu`, `temur`
  - Four-color: `chaos`, `aggression`, `altruism`, `growth`, `artifice`
  - Colleges: `quandrix`, `silverquill`, `witherbloom`, `prismari`, `lorehold`
  - Example: `c:esper`, `ci<=azorius`, `id:bant`

- **Special Values**: `c:colorless` or `c:c` for colorless, `c:multicolor` or `c:m` for multicolor

#### Mana Costs

- **Converted Mana Cost**: `cmc:`, `mv:`, or `manavalue:` - Search by mana value

  - Operators: `=`, `<=`, `>=`, `<`, `>`, `!=`
  - Special values: `cmc:even`, `cmc:odd`
  - Example: `cmc:3`, `cmc<=2`, `mv>=5`, `cmc:even`

- **Mana Cost**: `m:` or `mana:` - Search by actual mana cost string
  - Example: `m:{R}{R}`, `mana:2WW`, `m:{G}{U}`

#### Format Legality

- **Format**: `f:` or `format:` - Find cards legal in a format

  - Example: `f:modern`, `f:commander`, `f:standard`

- **Banned**: `banned:` - Find cards banned in a format

  - Example: `banned:legacy`, `banned:modern`

- **Restricted**: `restricted:` - Find cards restricted in a format
  - Example: `restricted:vintage`

#### Logical Operators

- **AND** (implicit): Space-separated terms are ANDed together

  - Example: `t:creature c:red k:haste`

- **OR** (explicit): Use `OR` keyword

  - Example: `t:creature OR t:enchantment`

- **NOT** (prefix): Use `-` prefix

  - Example: `-t:land`, `t:creature -c:blue`

- **Parentheses**: Group conditions

  - Example: `(t:creature OR t:enchantment) c:red`

- **Plain Text**: If no field is specified, searches both name and oracle text
  - Example: `Lightning` matches cards with "Lightning" in name or text

**Complex Query Examples:**

```json
{
  "query": "t:enchantment ci:WUG",
  "limit": 10
}
```

```json
{
  "query": "t:creature c:red k:haste cmc<=3",
  "limit": 20
}
```

```json
{
  "query": "(t:instant OR t:sorcery) c:blue o:counter",
  "limit": 15
}
```

```json
{
  "query": "f:modern -banned:modern cmc>=4",
  "limit": 10
}
```

```json
{
  "query": "id:esper t:instant cmc:even",
  "limit": 20
}
```

```json
{
  "query": "m:{R}{R} cmc<=4 t:creature",
  "limit": 15
}
```

### `collection_search`

Same syntax as `oracle_search`, but only returns cards in your collection.

### `import_collection`

Import a collection from MTGGoldfish format (coming soon).

## Resources

- `mcp://mtg/schema/oracle_cards` - Schema documentation for oracle_cards table
- `mcp://mtg/collection/summary` - Collection summary

## Configuration

### Environment Variables

| Variable   | Description                                                       | Default        |
| ---------- | ----------------------------------------------------------------- | -------------- |
| `MCP_PORT` | Port number for HTTP mode. If not set, server runs in stdio mode. | (none - stdio) |
| `DB_PATH`  | Path to SQLite database file                                      | `db/mtg.db`    |

### Transport Mode Selection

The server automatically selects the transport based on the `MCP_PORT`
environment variable:

- **Stdio Mode** (default): Used when `MCP_PORT` is not set. Communicates via
  stdin/stdout, suitable for MCP clients like Claude Desktop.
- **HTTP Mode**: Used when `MCP_PORT` is set. Exposes the server on the specified
  port using the MCP Streamable HTTP protocol.

**Examples:**

```bash
# Stdio mode (default)
npm start

# HTTP mode on port 3000
MCP_PORT=3000 npm start

# HTTP mode on custom port
MCP_PORT=8080 npm start

# Custom database path
DB_PATH=/custom/path/mtg.db npm start

# Combine options
MCP_PORT=3000 DB_PATH=/custom/path/mtg.db npm start
```

## Connecting MCP Clients

### Claude Desktop

Claude Desktop uses stdio mode. Add to your `claude_desktop_config.json`:

**macOS:**

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

**Windows:**

```json
{
  "mcpServers": {
    "oracle-lens": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\oracle-lens\\build\\index.js"]
    }
  }
}
```

**Linux:**

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

### Other MCP Clients (HTTP Mode)

For clients that support HTTP transport, configure them to connect to your HTTP server:

```json
{
  "mcpServers": {
    "oracle-lens": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Make sure the server is running in HTTP mode:

```bash
MCP_PORT=3000 npm start
```

## Project Status

- [x] Implement Scryfall Oracle bulk data importer
- [x] Implement Scryfall Default bulk data importer
- [x] Basic search with Scryfall-like syntax
- [x] Support for type, color, color identity, CMC, keyword, and oracle text filters
- [x] Color name mapping (red→R, blue→U, etc.)
- [x] Support for mana cost queries (`m:`, `mana:`)
- [x] Support for format legality queries (`f:`, `format:`, `banned:`, `restricted:`)
- [x] Support for guild/shard/wedge color names (azorius, esper, etc.)
- [x] Support for complex query logic (AND, OR, NOT, parentheses)
- [x] Support for CMC even/odd and additional operators (`!=`)
- [ ] Implement MTGGoldfish collection importer
- [ ] Add `suggest_additions` tool
- [ ] Add collection summary resource implementation
- [ ] Add tools to search Default Cards (printings) by set, collector number, etc.
- [ ] Add support for power/toughness queries (requires Default Cards data)
- [ ] Add support for rarity queries (requires Default Cards data)

## Troubleshooting

### Search returns empty results

- Make sure you've loaded the data: `npm run load-data`
- Check that color filters use the correct format: `c:red` or `c:R` (not `c:Red`)
- Keywords are case-insensitive: `k:haste` works the same as `k:Haste`

### Database not found

The database is automatically created on first run. If you need to reset it, delete `db/mtg.db` and restart the server.
