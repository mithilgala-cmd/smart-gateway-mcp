import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "redis";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const PORT = process.env.PORT || 8001;
const TRANSPORT = process.env.TRANSPORT || "stdio"; // 'stdio' or 'sse'

// Initialize Redis client
const redisClient = createClient({ url: REDIS_URL });
redisClient.on("error", (err) => console.error("Redis Client Error", err));

// Create MCP Server instance
const server = new Server(
  {
    name: "apishield-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register Tool Listing Handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_gateway_metrics",
        description: "Fetch live operational telemetry metrics from the API gateway (total requests, rate-limited counts, logs).",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_blacklist",
        description: "Retrieve the list of currently blacklisted/blocked IP addresses.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "block_ip",
        description: "Add an IP address to the gateway blacklist to block all subsequent incoming traffic.",
        inputSchema: {
          type: "object",
          properties: {
            ip: {
              type: "string",
              description: "The IP address to blacklist (e.g. '192.168.1.50').",
            },
          },
          required: ["ip"],
        },
      },
      {
        name: "unblock_ip",
        description: "Remove an IP address from the gateway blacklist to restore its access.",
        inputSchema: {
          type: "object",
          properties: {
            ip: {
              type: "string",
              description: "The IP address to unblock.",
            },
          },
          required: ["ip"],
        },
      },
      {
        name: "update_key_quota",
        description: "Dynamically update the rate limit quota (requests per minute) for an active API Key.",
        inputSchema: {
          type: "object",
          properties: {
            apiKey: {
              type: "string",
              description: "The API Key to modify.",
            },
            limit: {
              type: "number",
              description: "The new rate limit quota per minute (e.g., 120).",
            },
          },
          required: ["apiKey", "limit"],
        },
      },
    ],
  };
});

// Register Tool Execution Handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_gateway_metrics": {
        const totalRequests = await redisClient.get("telemetry:total_requests") || 0;
        const rateLimited = await redisClient.get("telemetry:rate_limited_requests") || 0;
        const unauthorized = await redisClient.get("telemetry:unauthorized_requests") || 0;
        
        // Retrieve recent requests log
        const recentLogs = await redisClient.lRange("telemetry:recent_requests", 0, 9);
        const parsedLogs = recentLogs.map((log) => JSON.parse(log));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                summary: {
                  totalRequests: parseInt(totalRequests, 10),
                  rateLimitedRequests: parseInt(rateLimited, 10),
                  unauthorizedRequests: parseInt(unauthorized, 10),
                },
                recentRequests: parsedLogs,
              }, null, 2),
            },
          ],
        };
      }

      case "get_blacklist": {
        const blacklist = await redisClient.sMembers("blacklist:ips");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ blockedIps: blacklist }, null, 2),
            },
          ],
        };
      }

      case "block_ip": {
        const { ip } = args;
        await redisClient.sAdd("blacklist:ips", ip);
        return {
          content: [
            {
              type: "text",
              text: `Successfully blacklisted IP: ${ip}. Downstream access from this IP is now forbidden.`,
            },
          ],
        };
      }

      case "unblock_ip": {
        const { ip } = args;
        const removed = await redisClient.sRem("blacklist:ips", ip);
        if (removed) {
          return {
            content: [
              {
                type: "text",
                text: `Successfully removed IP ${ip} from the blacklist. Downstream access restored.`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `IP ${ip} was not found in the blacklist.`,
              },
            ],
          };
        }
      }

      case "update_key_quota": {
        const { apiKey, limit } = args;
        const keyExists = await redisClient.exists(`apikey:${apiKey}`);
        if (!keyExists) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `API Key '${apiKey}' does not exist. Quota could not be updated.`,
              },
            ],
          };
        }

        await redisClient.hSet(`apikey:${apiKey}`, "limit", limit.toString());
        return {
          content: [
            {
              type: "text",
              text: `Successfully updated quota for API Key '${apiKey}' to ${limit} requests per minute.`,
            },
          ],
        };
      }

      default:
        throw new Error(`Tool not found: ${name}`);
    }
  } catch (error) {
    console.error(`Error running tool ${name}:`, error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error executing tool: ${error.message}`,
        },
      ],
    };
  }
});

// Start Transport
async function run() {
  await redisClient.connect();
  console.log("MCP Server connected to Redis");

  if (TRANSPORT === "sse") {
    const app = express();
    let sseTransport;

    app.get("/sse", async (req, res) => {
      console.log("Received SSE connection request");
      sseTransport = new SSEServerTransport("/messages", res);
      await server.connect(sseTransport);
      console.log("MCP Server connected via SSE transport");
    });

    app.post("/messages", async (req, res) => {
      if (sseTransport) {
        await sseTransport.handlePostMessage(req, res);
      } else {
        res.status(400).send("No active SSE transport session established.");
      }
    });

    app.listen(PORT, () => {
      console.log(`MCP SSE Server listening on port ${PORT}`);
      console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
      console.log(`Message endpoint: http://localhost:${PORT}/messages`);
    });
  } else {
    // stdio transport (standard for local IDE extensions and CLI tools)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP Server running over stdio transport");
  }
}

run().catch((err) => {
  console.error("Critical error running MCP Server:", err);
  process.exit(1);
});
