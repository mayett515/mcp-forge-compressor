const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript; 
const fs = require('fs');
const path = require('path');

const parser = new Parser();

function getSkeleton(node) {
  let skeleton = "";
  if (node.type === 'class_declaration') {
    const name = node.childForFieldName('name')?.text || "Unknown";
    skeleton += `[Lines ${node.startPosition.row + 1}-${node.endPosition.row + 1}] class ${name} {\n`;
    node.children.forEach(child => skeleton += getSkeleton(child));
    skeleton += `}\n`;
  } 
  else if (node.type === 'method_definition' || node.type === 'function_declaration') {
    const name = node.childForFieldName('name')?.text || "anonymous";
    const params = node.childForFieldName('parameters')?.text || "()";
    const isAsync = node.text.startsWith('async') ? 'async ' : '';
    skeleton += `  [Lines ${node.startPosition.row + 1}-${node.endPosition.row + 1}] ${isAsync}${name}${params}\n`;
  }
  else {
    node.children.forEach(child => { skeleton += getSkeleton(child); });
  }
  return skeleton;
}

const server = new Server({
  name: "mcp-forge-compressor",
  version: "1.1.0",
}, {
  capabilities: { tools: {} },
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_file_skeleton",
      description: "Returns only class/function signatures with line numbers.",
      inputSchema: {
        type: "object",
        properties: { filepath: { type: "string" } },
        required: ["filepath"],
      },
    },
    {
      name: "read_function_range",
      description: "Reads specific lines. Use this after finding line numbers in the skeleton.",
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  if (name === "get_file_skeleton") {
    const ext = path.extname(args.filepath);
    parser.setLanguage(ext === '.ts' ? TypeScript : JavaScript);
    const tree = parser.parse(fs.readFileSync(args.filepath, 'utf8'));
    return { content: [{ type: "text", text: getSkeleton(tree.rootNode) }] };
  }

  if (name === "read_function_range") {
    const lines = fs.readFileSync(args.filepath, 'utf8').split('\n');
    const selection = lines.slice(args.startLine - 1, args.endLine).join('\n');
    return { content: [{ type: "text", text: selection }] };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);