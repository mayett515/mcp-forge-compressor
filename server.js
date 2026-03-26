const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const fs = require('fs');

// Initialize the AST Engine (Your "Engine")
const parser = new Parser();
parser.setLanguage(JavaScript);

// Your "Pruning" logic from index.js
function getSkeleton(node) {
  let skeleton = "";
  if (node.type === 'class_declaration') {
    const name = node.childForFieldName('name')?.text || "Unknown";
    skeleton += `class ${name} {\n`;
    node.children.forEach(child => skeleton += getSkeleton(child));
    skeleton += `}\n`;
  } 
  else if (node.type === 'method_definition' || node.type === 'function_declaration') {
    const name = node.childForFieldName('name')?.text || "anonymous";
    const params = node.childForFieldName('parameters')?.text || "()";
    const isAsync = node.text.startsWith('async') ? 'async ' : '';
    skeleton += `  ${isAsync}${name}${params}\n`;
  }
  else {
    node.children.forEach(child => { skeleton += getSkeleton(child); });
  }
  return skeleton;
}

// Create the MCP Server (Your "Interface")
const server = new Server({
  name: "mcp-forge-compressor",
  version: "1.0.0",
}, {
  capabilities: { tools: {} },
});

// Tool 1: Define the "get_file_skeleton" tool for the AI
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "get_file_skeleton",
    description: "Parses a JS/TS file and returns only the class and function signatures to save context tokens.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
      },
      required: ["path"],
    },
  }],
}));

// Tool Execution: What happens when the AI calls the tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_file_skeleton") {
    const filePath = request.params.arguments.path;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const tree = parser.parse(content);
      const skeleton = getSkeleton(tree.rootNode);
      return { content: [{ type: "text", text: skeleton }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error reading file: ${error.message}` }], isError: true };
    }
  }
});

// Start the server using Standard I/O (STDIO)
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Forge Compressor Server running on stdio");
}

main().catch(console.error);