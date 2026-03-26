const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const fs = require('fs');
const { generateSemanticMap } = require('./skeleton');

// * --- 5-Line Rate Limiter (The Circuit Breaker) ---
// ? Prevents the AI from spamming the server and overwhelming system resources.
let lastCallTime = 0;
const MIN_INTERVAL = 2000;

function checkRateLimit() {
  const now = Date.now();
  if (now - lastCallTime < MIN_INTERVAL) {
    // ! Explicitly throw an error to force the AI to wait.
    throw new Error("RATE_LIMIT_EXCEEDED: You are calling tools too fast. Slow down.");
  }
  lastCallTime = now;
}

// * --- MCP Server Initialization ---
const server = new Server({
  name: "mcp-forge-compressor",
  version: "2.0.0",
}, {
  capabilities: { tools: {} },
});

// * --- Tool Definitions ---
// ? This tells the AI what tools are available and what inputs they need.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_file_skeleton",
      description: "CRITICAL FIRST STEP: Generates a semantic map (V2 AST skeleton) of a codebase file. Recognizes framework patterns (React hooks, Express routes, Vue reactivity, decorators), squashes imports, extracts TypeScript types with members, and labels exports. Use this BEFORE reading any full file to prevent context bloat. Returns class names, method signatures with access modifiers, framework-specific labels, and precise line numbers.",
      inputSchema: {
        type: "object",
        properties: { filepath: { type: "string" } },
        required: ["filepath"],
      },
    },
    {
      name: "read_function_range",
      description: "Surgically extracts a specific range of lines from a file. ONLY use this after calling get_file_skeleton to zoom in on the exact lines you need to fix a bug, rather than reading the entire file.",
      inputSchema: {
        type: "object",
        properties: {
          filepath: { type: "string" },
          startLine: { type: "number" },
          endLine: { type: "number" }
        },
        required: ["filepath", "startLine", "endLine"],
      },
    }
  ],
}));

// * --- Core Tool Execution Logic ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ? 1. Check Rate Limit first for all requests
  try {
    checkRateLimit();
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }

  // * --- Tool: get_file_skeleton ---
  if (name === "get_file_skeleton") {
    try {
      const result = generateSemanticMap(args.filepath);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to get skeleton: ${error.message}` }]
      };
    }
  }

  // * --- Tool: read_function_range ---
  if (name === "read_function_range") {
    try {
      const lines = fs.readFileSync(args.filepath, 'utf8').split('\n');
      const selection = lines.slice(args.startLine - 1, args.endLine).join('\n');
      return { content: [{ type: "text", text: selection }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to read lines: ${error.message}` }]
      };
    }
  }
});

// * --- Boot Sequence ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
