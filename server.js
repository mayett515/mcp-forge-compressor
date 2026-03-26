const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript; 
const fs = require('fs');
const path = require('path');

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

const parser = new Parser();

// * --- Skeleton Logic ---
// ? Recursively walks the code tree to find only Class and Function signatures.
function getSkeleton(node, depth = 0) {
  let skeleton = "";
  const indent = "  ".repeat(depth);

  // 1. Capture JSDoc Comments (Heuristic: starts with '/**')
  if (node.type === 'comment' && node.text.startsWith('/**')) {
    const summary = node.text.split('\n')[0].replace('/**', '').trim() + ' ... */';
    skeleton += `${indent}[Lines ${node.startPosition.row + 1}-${node.endPosition.row + 1}] /** ${summary}\n`;
    return skeleton;
  }

  // 2. Capture Imports
  if (node.type === 'import_statement') {
    const cleanImport = node.text.replace(/\s+/g, ' '); 
    skeleton += `${indent}[Lines ${node.startPosition.row + 1}-${node.endPosition.row + 1}] ${cleanImport}\n`;
    return skeleton; 
  }

  // 3. Capture Exports
  if (node.type === 'export_statement') {
    const isDefault = node.text.includes('export default') ? 'default ' : '';
    skeleton += `${indent}[Lines ${node.startPosition.row + 1}-${node.endPosition.row + 1}] export ${isDefault}\n`;
    node.children.forEach(child => skeleton += getSkeleton(child, depth + 1));
    return skeleton;
  }

  // 4. Capture TypeScript Interfaces & Types
  if (node.type === 'interface_declaration' || node.type === 'type_alias_declaration') {
    const name = node.childForFieldName('name')?.text || "Unknown";
    const keyword = node.type === 'interface_declaration' ? 'interface' : 'type';
    skeleton += `${indent}[Lines ${node.startPosition.row + 1}-${node.endPosition.row + 1}] ${keyword} ${name}\n`;
    return skeleton; 
  }

  // 5. Capture Classes
  if (node.type === 'class_declaration') {
    const name = node.childForFieldName('name')?.text || "Unknown";
    skeleton += `${indent}[Lines ${node.startPosition.row + 1}-${node.endPosition.row + 1}] class ${name} {\n`;
    node.children.forEach(child => skeleton += getSkeleton(child, depth + 1));
    skeleton += `${indent}}\n`;
    return skeleton;
  } 
  
  // 6. Capture Methods and Functions
  if (node.type === 'method_definition' || node.type === 'function_declaration') {
    const name = node.childForFieldName('name')?.text || "anonymous";
    const params = node.childForFieldName('parameters')?.text || "()";
    const isAsync = node.text.startsWith('async') ? 'async ' : '';
    skeleton += `${indent}[Lines ${node.startPosition.row + 1}-${node.endPosition.row + 1}] ${isAsync}${name}${params}\n`;
    return skeleton; 
  }
  
  node.children.forEach(child => { 
    skeleton += getSkeleton(child, depth); 
  });
  
  return skeleton;
}

// * --- MCP Server Initialization ---
const server = new Server({
  name: "mcp-forge-compressor",
  version: "1.1.0",
}, {
  capabilities: { tools: {} },
});

// * --- Tool Definitions ---
// ? This tells the AI what tools are available and what inputs they need.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_file_skeleton",
      description: "CRITICAL FIRST STEP: Generates a compressed structural map (AST skeleton) of a codebase file. Use this BEFORE reading any full file to prevent context bloat. Returns class names, method signatures, and precise line numbers.",
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
    // ! TRY block catches errors like "File Not Found" or "Permission Denied"
    try {
      const ext = path.extname(args.filepath);
      parser.setLanguage(ext === '.ts' ? TypeScript : JavaScript);
      const tree = parser.parse(fs.readFileSync(args.filepath, 'utf8'));
      return { content: [{ type: "text", text: getSkeleton(tree.rootNode) }] };
    } catch (error) {
      // ! CATCH block keeps the server running and informs the AI of the failure
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