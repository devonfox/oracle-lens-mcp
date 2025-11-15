import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { initializeDatabase } from "./db/index.js";
import { searchOracleCards, searchCollection } from "./services/search.js";

// Create server instance
const server = new Server(
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

// Initialize database on startup
await initializeDatabase();

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "oracle_search",
        description: "Search all Oracle cards using Scryfall-like syntax (t:type, o:text, ci:colors, cmc<=X, cmc>=X, k:keyword)",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query using Scryfall syntax or plain text",
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
        description: "Search cards in your collection using the same syntax as oracle_search",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query using Scryfall syntax or plain text",
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
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "oracle_search": {
        const { query, limit = 20 } = args as {
          query: string;
          limit?: number;
        };
        const results = await searchOracleCards(query, limit);
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
          query: string;
          limit?: number;
        };
        const results = await searchCollection(query, limit);
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
          path: string;
          format?: string;
        };
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
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
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
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
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
});

// Main function
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Oracle Lens MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
