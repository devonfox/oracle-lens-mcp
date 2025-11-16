import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import express from "express";
import { initializeDatabase } from "./db/index.js";
import { searchOracleCards, searchCollection } from "./services/search.js";

// Create server instance
function createServer() {
  return new McpServer(
    {
      name: "oracle-lens",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );
}

// Initialize database on startup
try {
  await initializeDatabase();
} catch (error) {
  console.error("FATAL: Failed to initialize database:", error);
  console.error(
    "Please check your DATABASE_URL and ensure PostgreSQL is running."
  );
  process.exit(1);
}

// Setup server handlers
function setupServerHandlers(server: McpServer) {
  // List available tools
  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "oracle_search",
          description:
            "Search all Oracle cards using Scryfall-like syntax. Supports field queries, operators, logical operators, and named color combinations.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: `Search query using Scryfall syntax. 

BASIC FIELDS:
- Name: n: or name: (e.g., n:Lightning, name:Bolt)
- Type: t: or type: (e.g., t:creature, t:enchantment, t:legendary)
- Oracle Text: o: or oracle: (e.g., o:"draw a card", o:destroy) - use quotes for phrases
- Keywords: k:, kw:, or keyword: (e.g., k:haste, kw:flying, keyword:lifelink)

COLORS AND COLOR IDENTITY:
- Colors: c:, color:, or colors: (e.g., c:red, c:R, c:WUBRG)
  Operators: =, <= (subset), >= (superset), != (not equal)
  Examples: c:red, c>=W, c<=WUG, c!=blue
- Color Identity: ci:, id:, identity:, or color_identity: (same syntax as colors)
  Examples: ci:WUG, id:esper, identity<=azorius
- Named Combinations: Use guild/shard/wedge names directly
  Guilds: azorius, dimir, rakdos, gruul, selesnya, orzhov, izzet, golgari, boros, simic
  Shards: bant, esper, grixis, jund, naya
  Wedges: abzan, jeskai, sultai, mardu, temur
  Four-color: chaos, aggression, altruism, growth, artifice
  Colleges: quandrix, silverquill, witherbloom, prismari, lorehold
  Examples: c:esper, ci<=azorius, id:bant
- Special Values: c:colorless or c:c, c:multicolor or c:m

MANA COSTS:
- Converted Mana Cost: cmc:, mv:, or manavalue:
  Operators: =, <=, >=, <, >, !=
  Special values: cmc:even, cmc:odd
  Examples: cmc:3, cmc<=2, mv>=5, cmc:even
- Mana Cost: m: or mana: (actual cost string)
  Examples: m:{R}{R}, mana:2WW, m:{G}{U}

FORMAT LEGALITY:
- Format: f: or format: (e.g., f:modern, f:commander, f:standard)
- Banned: banned: (e.g., banned:legacy, banned:modern)
- Restricted: restricted: (e.g., restricted:vintage)

LOGICAL OPERATORS:
- AND: Implicit (space-separated terms) - e.g., t:creature c:red k:haste
- OR: Explicit OR keyword - e.g., t:creature OR t:enchantment
- NOT: Prefix with - - e.g., -t:land, t:creature -c:blue
- Parentheses: Group conditions - e.g., (t:creature OR t:enchantment) c:red
- Plain Text: If no field specified, searches name and oracle text - e.g., Lightning

EXAMPLES:
- "t:creature c:red k:haste cmc<=3"
- "f:modern -banned:modern cmc>=4"
- "(t:instant OR t:sorcery) c:blue o:counter"
- "id:esper t:instant cmc:even"
- "m:{R}{R} cmc<=4 t:creature"`,
              },
              limit: {
                type: "number",
                description: "Maximum number of results to return",
                default: 20,
              },
            },
            required: ["query"],
          },
        },
        {
          name: "collection_search",
          description:
            "Search cards in your collection using the same Scryfall-like syntax as oracle_search. Only returns cards that are in the user's collection inventory.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: `Search query using Scryfall syntax (same as oracle_search). 

BASIC FIELDS:
- Name: n: or name: (e.g., n:Lightning, name:Bolt)
- Type: t: or type: (e.g., t:creature, t:enchantment, t:legendary)
- Oracle Text: o: or oracle: (e.g., o:"draw a card", o:destroy) - use quotes for phrases
- Keywords: k:, kw:, or keyword: (e.g., k:haste, kw:flying, keyword:lifelink)

COLORS AND COLOR IDENTITY:
- Colors: c:, color:, or colors: (e.g., c:red, c:R, c:WUBRG)
  Operators: =, <= (subset), >= (superset), != (not equal)
  Examples: c:red, c>=W, c<=WUG, c!=blue
- Color Identity: ci:, id:, identity:, or color_identity: (same syntax as colors)
  Examples: ci:WUG, id:esper, identity<=azorius
- Named Combinations: Use guild/shard/wedge names directly
  Guilds: azorius, dimir, rakdos, gruul, selesnya, orzhov, izzet, golgari, boros, simic
  Shards: bant, esper, grixis, jund, naya
  Wedges: abzan, jeskai, sultai, mardu, temur
  Four-color: chaos, aggression, altruism, growth, artifice
  Colleges: quandrix, silverquill, witherbloom, prismari, lorehold
  Examples: c:esper, ci<=azorius, id:bant
- Special Values: c:colorless or c:c, c:multicolor or c:m

MANA COSTS:
- Converted Mana Cost: cmc:, mv:, or manavalue:
  Operators: =, <=, >=, <, >, !=
  Special values: cmc:even, cmc:odd
  Examples: cmc:3, cmc<=2, mv>=5, cmc:even
- Mana Cost: m: or mana: (actual cost string)
  Examples: m:{R}{R}, mana:2WW, m:{G}{U}

FORMAT LEGALITY:
- Format: f: or format: (e.g., f:modern, f:commander, f:standard)
- Banned: banned: (e.g., banned:legacy, banned:modern)
- Restricted: restricted: (e.g., restricted:vintage)

LOGICAL OPERATORS:
- AND: Implicit (space-separated terms) - e.g., t:creature c:red k:haste
- OR: Explicit OR keyword - e.g., t:creature OR t:enchantment
- NOT: Prefix with - - e.g., -t:land, t:creature -c:blue
- Parentheses: Group conditions - e.g., (t:creature OR t:enchantment) c:red
- Plain Text: If no field specified, searches name and oracle text - e.g., Lightning

EXAMPLES:
- "t:creature c:red k:haste cmc<=3"
- "f:modern -banned:modern cmc>=4"
- "(t:instant OR t:sorcery) c:blue o:counter"
- "id:esper t:instant cmc:even"
- "m:{R}{R} cmc<=4 t:creature"`,
              },
              limit: {
                type: "number",
                description: "Maximum number of results to return",
                default: 20,
              },
            },
            required: ["query"],
          },
        },
        {
          name: "import_collection",
          description: "Import a collection from MTGGoldfish format",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path to the collection file",
              },
              format: {
                type: "string",
                description: "Collection format (default: 'goldfish')",
                default: "goldfish",
              },
            },
            required: ["path"],
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Log the request for debugging
    console.error(
      `[MCP] Tool call: ${name}`,
      JSON.stringify({ name, args }, null, 2)
    );

    // Validate arguments exist
    if (!args || typeof args !== "object") {
      console.error(`[MCP] Invalid arguments for tool ${name}:`, args);
      return {
        content: [
          {
            type: "text",
            text: `Error: Invalid arguments provided for tool ${name}. Expected an object, got: ${typeof args}`,
          },
        ],
        isError: true,
      };
    }

    try {
      switch (name) {
        case "oracle_search": {
          const { query, limit = 20 } = args as {
            query?: string;
            limit?: number;
          };

          if (!query || typeof query !== "string") {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Missing or invalid 'query' parameter. Expected a string.`,
                },
              ],
              isError: true,
            };
          }

          console.error(
            `[MCP] Executing oracle_search with query: "${query}", limit: ${limit}`
          );
          const results = await searchOracleCards(query, limit);
          console.error(
            `[MCP] oracle_search returned ${results.length} results`
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(results, null, 2),
              },
            ],
          };
        }

        case "collection_search": {
          const { query, limit = 20 } = args as {
            query?: string;
            limit?: number;
          };

          if (!query || typeof query !== "string") {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Missing or invalid 'query' parameter. Expected a string.`,
                },
              ],
              isError: true,
            };
          }

          console.error(
            `[MCP] Executing collection_search with query: "${query}", limit: ${limit}`
          );
          const results = await searchCollection(query, limit);
          console.error(
            `[MCP] collection_search returned ${results.length} results`
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(results, null, 2),
              },
            ],
          };
        }

        case "import_collection": {
          const { path: filePath, format = "goldfish" } = args as {
            path?: string;
            format?: string;
          };

          if (!filePath || typeof filePath !== "string") {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Missing or invalid 'path' parameter. Expected a string.`,
                },
              ],
              isError: true,
            };
          }

          // TODO: Implement collection import
          return {
            content: [
              {
                type: "text",
                text: `Collection import not yet implemented. Would import from: ${filePath} (format: ${format})`,
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error(`[MCP] Error in tool ${name}:`, errorMessage);
      if (errorStack) {
        console.error(`[MCP] Stack trace:`, errorStack);
      }

      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}${
              errorStack ? `\n\nStack: ${errorStack}` : ""
            }`,
          },
        ],
        isError: true,
      };
    }
  });

  // List available resources
  server.server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "mcp://mtg/schema/oracle_cards",
          name: "Oracle Cards Schema",
          description: "Schema documentation for the oracle_cards table",
          mimeType: "application/json",
        },
        {
          uri: "mcp://mtg/collection/summary",
          name: "Collection Summary",
          description: "Summary of your MTG collection",
          mimeType: "application/json",
        },
      ],
    };
  });

  // Handle resource reads
  server.server.setRequestHandler(
    ReadResourceRequestSchema,
    async (request) => {
      const { uri } = request.params;

      switch (uri) {
        case "mcp://mtg/schema/oracle_cards": {
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(
                  {
                    schema: {
                      oracle_id: "string (primary key)",
                      name: "string",
                      mana_cost: "string",
                      cmc: "number",
                      type_line: "string",
                      oracle_text: "string",
                      colors: "string (JSON array)",
                      color_identity: "string (JSON array)",
                      keywords: "string (JSON array)",
                      legalities: "string (JSON object)",
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "mcp://mtg/collection/summary": {
          // TODO: Implement collection summary
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(
                  {
                    totalCards: 0,
                    totalUnique: 0,
                    message: "Collection summary not yet implemented",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown resource: ${uri}`);
      }
    }
  );
}

// Main function - stdio transport
async function runStdioServer() {
  const server = createServer();
  setupServerHandlers(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Oracle Lens MCP Server running on stdio");
}

// Main function - HTTP transport
async function runHttpServer() {
  const port = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000;
  const app = express();

  // Add error handler for JSON parsing errors
  app.use(
    express.json({
      strict: false, // Allow non-objects
    })
  );

  // Handle JSON parsing errors
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (err instanceof SyntaxError && "body" in err) {
        console.error(`[HTTP] JSON parsing error:`, err.message);
        return res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: "Parse error: Invalid JSON",
          },
          id: null,
        });
      }
      next(err);
    }
  );

  console.error(`[HTTP] Starting HTTP server on port ${port}...`);
  console.error(
    `[HTTP] Database URL: ${
      process.env.DATABASE_URL ? "set" : "not set (using default)"
    }`
  );

  // Map to store transports by session ID
  const transports: Map<string, StreamableHTTPServerTransport> = new Map();

  // MCP POST endpoint
  const mcpPostHandler = async (
    req: express.Request,
    res: express.Response
  ) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const method = req.body?.method;
    const requestId = req.body?.id;

    console.error(
      `[HTTP] POST /mcp - Session: ${sessionId || "none"}, Method: ${
        method || "unknown"
      }, ID: ${requestId || "none"}`
    );
    console.error(`[HTTP] Request body:`, JSON.stringify(req.body, null, 2));
    console.error(`[HTTP] Available sessions:`, Array.from(transports.keys()));

    try {
      let transport: StreamableHTTPServerTransport;

      // Helper function to create a new session
      const createNewSession = async () => {
        console.error(
          `[HTTP] Creating new session${
            sessionId ? ` (replacing unknown session ${sessionId})` : ""
          }`
        );
        try {
          const server = createServer();
          console.error(
            `[HTTP] Server instance created, setting up handlers...`
          );
          setupServerHandlers(server);
          console.error(`[HTTP] Handlers set up, creating transport...`);

          const newTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              console.error(`[HTTP] Session initialized with ID: ${sid}`);
              transports.set(sid, newTransport);
            },
            onsessionclosed: (sid) => {
              console.error(`[HTTP] Session closed: ${sid}`);
              transports.delete(sid);
            },
          });

          // Set up onclose handler to clean up transport when closed
          newTransport.onclose = () => {
            const sid = newTransport.sessionId;
            if (sid && transports.has(sid)) {
              console.error(
                `[HTTP] Transport closed for session ${sid}, removing from transports map`
              );
              transports.delete(sid);
            }
          };

          // Connect the transport to the MCP server
          console.error(`[HTTP] Connecting transport to server...`);
          await server.connect(newTransport);
          console.error(`[HTTP] Transport connected successfully`);
          return newTransport;
        } catch (sessionError: any) {
          console.error(`[HTTP] Error creating new session:`, {
            error: sessionError?.message,
            code: sessionError?.code,
            stack: sessionError?.stack,
          });
          throw sessionError;
        }
      };

      // Check if this is an initialize request - always create new session for initialize
      if (isInitializeRequest(req.body)) {
        transport = await createNewSession();
        await transport.handleRequest(req, res, req.body);
        return; // Already handled
      } else if (sessionId && transports.has(sessionId)) {
        // Reuse existing transport for non-initialize requests
        console.error(
          `[HTTP] Using existing transport for session: ${sessionId}`
        );
        transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      } else if (sessionId && !transports.has(sessionId)) {
        // Session ID provided but doesn't exist (server restarted) - create new session automatically
        // This allows clients to continue in the same window after server restart
        console.error(
          `[HTTP] Session ID ${sessionId} not found, creating new session automatically`
        );
        transport = await createNewSession();
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        // No session ID provided and not an initialize request
        const errorMsg =
          "No session ID provided. Please send an initialize request first or include a session ID header.";

        console.error(`[HTTP] Bad Request: ${errorMsg}`);
        if (!res.headersSent) {
          res.status(400).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: `Bad Request: ${errorMsg}`,
            },
            id: requestId || null,
          });
        }
        return;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error("Error handling MCP request:", {
        error: errorMessage,
        stack: errorStack,
        body: req.body,
        headers: Object.keys(req.headers),
      });
      if (!res.headersSent) {
        // If it's a validation error, return 400 instead of 500
        if (
          errorMessage.includes("Bad Request") ||
          errorMessage.includes("validation")
        ) {
          res.status(400).json({
            jsonrpc: "2.0",
            error: {
              code: -32600,
              message: `Bad Request: ${errorMessage}`,
            },
            id: requestId || null,
          });
        } else {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error",
              data: errorMessage,
            },
            id: requestId || null,
          });
        }
      }
    }
  };

  // Handle GET requests for SSE streams
  const mcpGetHandler = async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  };

  // Handle DELETE requests for session termination
  const mcpDeleteHandler = async (
    req: express.Request,
    res: express.Response
  ) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    try {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling session termination:", error);
      if (!res.headersSent) {
        res.status(500).send("Error processing session termination");
      }
    }
  };

  app.post("/mcp", mcpPostHandler);
  app.get("/mcp", mcpGetHandler);
  app.delete("/mcp", mcpDeleteHandler);

  app.listen(port, () => {
    console.error(`Oracle Lens MCP Server running on HTTP port ${port}`);
    console.error(`MCP endpoint: http://localhost:${port}/mcp`);
  });

  // Handle server shutdown
  process.on("SIGINT", async () => {
    console.error("Shutting down server...");
    // Close all active transports
    for (const [sessionId, transport] of transports.entries()) {
      try {
        console.error(`Closing transport for session ${sessionId}`);
        await transport.close();
        transports.delete(sessionId);
      } catch (error) {
        console.error(
          `Error closing transport for session ${sessionId}:`,
          error
        );
      }
    }
    console.error("Server shutdown complete");
    process.exit(0);
  });
}

// Main function - choose transport based on environment
async function main() {
  // Use HTTP transport if MCP_PORT is set, otherwise use stdio
  if (process.env.MCP_PORT) {
    await runHttpServer();
  } else {
    await runStdioServer();
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
