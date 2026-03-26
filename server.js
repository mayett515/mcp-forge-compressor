const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const fs = require('fs');
const path = require('path');
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const { generateSemanticMap } = require('./skeleton');

// * --- Parser instance for import resolution ---
const parser = new Parser();

// * --- 5-Line Rate Limiter (The Circuit Breaker) ---
// ? Prevents the AI from spamming the server and overwhelming system resources.
let lastCallTime = 0;
const MIN_INTERVAL = 2000;

// * --- Import Path Resolver ---
// ? Resolves relative import strings (e.g., './auth') to absolute file paths.
// ? Handles TypeScript and JavaScript extension dropping.
function resolveModulePath(baseFilePath, importPath) {
  const baseDir = path.dirname(baseFilePath);
  const targetPath = path.resolve(baseDir, importPath);
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
  for (const ext of extensions) {
    if (fs.existsSync(targetPath + ext)) {
      return targetPath + ext;
    }
  }
  return null;
}

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
    },
    {
      name: "find_symbol_definition",
      description: "X-RAY VISION: Traces an imported symbol (function, class, variable) across files. Pass the symbol name and the file where you see it imported. The engine resolves the import path via AST and returns the absolute path of the source file. Call get_file_skeleton on the returned path to continue mapping.",
      inputSchema: {
        type: "object",
        properties: {
          symbolName: { type: "string", description: "The imported symbol name (e.g., 'AuthService')" },
          currentFilePath: { type: "string", description: "Absolute path of the file containing the import" }
        },
        required: ["symbolName", "currentFilePath"],
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

  // * --- Tool: find_symbol_definition (X-Ray Vision) ---
  if (name === "find_symbol_definition") {
    try {
      const { symbolName, currentFilePath } = args;

      if (!fs.existsSync(currentFilePath)) {
        return { content: [{ type: "text", text: `Error: File not found at ${currentFilePath}` }] };
      }

      // 1. Parse the current file's AST
      const sourceCode = fs.readFileSync(currentFilePath, 'utf8');
      const ext = path.extname(currentFilePath);
      parser.setLanguage(['.ts', '.tsx'].includes(ext) ? TypeScript : JavaScript);
      const tree = parser.parse(sourceCode);

      // 2. Scan top-level imports — supports both ES modules and CommonJS require()
      let importSource = null;
      for (const child of tree.rootNode.children) {
        // ES Module: import { Foo } from './path'
        if (child.type === 'import_statement' && child.text.includes(symbolName)) {
          const stringNode = child.children.find(c => c.type === 'string');
          if (stringNode) {
            importSource = stringNode.text.replace(/['"]/g, '');
            break;
          }
        }
        // CommonJS: const { Foo } = require('./path')
        if (child.type === 'lexical_declaration' && child.text.includes(symbolName) && child.text.includes('require(')) {
          const declarator = child.children.find(c => c.type === 'variable_declarator');
          if (declarator) {
            const callExpr = declarator.children.find(c => c.type === 'call_expression');
            if (callExpr && callExpr.children[0]?.text === 'require') {
              const argsNode = callExpr.children.find(c => c.type === 'arguments');
              const stringNode = argsNode?.children.find(c => c.type === 'string');
              if (stringNode) {
                importSource = stringNode.text.replace(/['"]/g, '');
                break;
              }
            }
          }
        }
      }

      if (!importSource) {
        return {
          content: [{ type: "text", text: `No import found for '${symbolName}' in ${currentFilePath}. It may be defined locally or globally.` }]
        };
      }

      // 3. Resolve the physical file path
      const resolved = resolveModulePath(currentFilePath, importSource);
      if (!resolved) {
        return {
          content: [{ type: "text", text: `Import '${importSource}' found but could not resolve to a physical file. It may be a node_modules package.` }]
        };
      }

      // 4. Return the bridge — the AI calls get_file_skeleton next
      return {
        content: [{ type: "text", text: `${resolved}\n\nNext: call get_file_skeleton on this path to map its structure.` }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error tracing symbol: ${error.message}` }]
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
