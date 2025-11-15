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

Stdio mode is designed for use with MCP clients that communicate via standard input/output. This is the default mode when `MCP_PORT` is not set.

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

HTTP mode exposes the server as an HTTP endpoint using the MCP Streamable HTTP protocol. This allows remote clients to connect over the network.

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

### Environment Variables

| Variable   | Description                                                       | Default             |
| ---------- | ----------------------------------------------------------------- | ------------------- |
| `MCP_PORT` | Port number for HTTP mode. If not set, server runs in stdio mode. | (none - stdio mode) |
| `DB_PATH`  | Path to SQLite database file                                      | `db/mtg.db`         |

### Transport Mode Selection

The server automatically selects the transport based on the `MCP_PORT` environment variable:

- **Stdio Mode** (default): Used when `MCP_PORT` is not set. Communicates via stdin/stdout, suitable for MCP clients like Claude Desktop.
- **HTTP Mode**: Used when `MCP_PORT` is set. Exposes the server on the specified port using the MCP Streamable HTTP protocol.

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
