// ==========================================
// server.js
// MCP Server entry point for mcp-forge-compressor.
//
// * --- USAGE ---
//   node server.js [allowed-dir-1] [allowed-dir-2] ...
//
//   If no directories are passed, ALL paths are allowed (development mode).
//   In production, always pass allowed directories to restrict file access.
//
// * --- EXAMPLE ---
//   node server.js /home/user/my-project /home/user/other-project
//
// * --- TOOLS EXPOSED ---
//   get_file_skeleton       — compressed AST skeleton of a file
//   read_function_range     — extract exact line range from a file
//   find_symbol_definition  — trace imported symbols across files
//   get_project_tree        — visual directory map
// ==========================================

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const fs = require('fs/promises');
const path = require('path');
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const { generateSemanticMap } = require('./skeleton');

// * --- Parser instance for import resolution ---
const parser = new Parser();

// * --- Rate Limiter (Circuit Breaker) ---
// ? Prevents the AI from spamming the server and overwhelming system resources.
//deleted it fuck those limiter functions it was only because of a bug

// * --- Noise Filter: Directories that cause Token Bloat ---
const IGNORE_DIRS = [
  'node_modules', '.git', 'dist', 'build', '.next',
  '.idea', '__pycache__', 'coverage', '.cache', '.turbo'
];

// ==========================================
// SECURITY: PATH TRAVERSAL PROTECTION
// ==========================================

// * Parse allowed directories from command line arguments.
// ? e.g. node server.js /home/user/project1 /home/user/project2
// ? If none provided, runs in open mode (development only).
const allowedDirectories = process.argv.slice(2).map(d => path.resolve(d));

if (allowedDirectories.length > 0) {
  console.log('[server] [OK] Allowed directories:');
  allowedDirectories.forEach(d => console.log(`  - ${d}`));
} else {
  console.log('[server] [WARN] No allowed directories specified — running in open mode.');
  console.log('[server] [WARN] Pass allowed directories as arguments for production use:');
  console.log('[server] [WARN]   node server.js /path/to/project');
}

/**
 * * Checks if a requested path is within any of the allowed directories.
 *
 * ! FIX: Uses path.relative() instead of startsWith() to prevent path traversal.
 * ! startsWith() is exploitable: if allowed dir is /project, then
 * ! /project-hacked/passwords.txt passes the check. path.relative() does not.
 *
 * ! FIX: relative === '' explicitly allowed — means the requested path IS
 * ! the allowed directory root itself. Without this, path.relative('/p', '/p')
 * ! returns "" which is falsy, causing root directory access to be wrongly denied.
 *
 * @param {string} requestedPath - The path being requested
 * @returns {boolean} True if the path is within an allowed directory
 */
function isPathAllowed(requestedPath) {
  // If no restrictions configured, allow all (development mode)
  if (allowedDirectories.length === 0) return true;

  const absoluteRequested = path.resolve(requestedPath);

  return allowedDirectories.some(allowedDir => {
    const relative = path.relative(allowedDir, absoluteRequested);
    // relative === '' means path IS the allowed dir root (must be explicitly allowed)
    // !startsWith('..') means path is inside the allowed dir (not escaping up)
    // !isAbsolute means path is not on a completely different root
    return (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)));
  });
}

// ==========================================
// PROJECT TREE GENERATOR (Workspace Radar)
// ==========================================

/**
 * * Recursively builds a token-friendly text map of the project directory.
 * ? Draws visual tree lines (├── / └──) and caps depth to prevent runaway scanning.
 * ! Now fully async — uses fs/promises to avoid blocking the event loop.
 */

// TODO V2.1: Replace sequential stat() calls with Promise.all() for
// concurrent file stat checking — significant performance improvement
// on directories with 1000+ files.
async function generateProjectTree(dir, prefix = '', depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return prefix + '...\n';

  let items;
  try {
    items = await fs.readdir(dir);
  } catch (err) {
    return prefix + '[Access Denied]\n';
  }

  // Sort: folders first, then files. Skip ignored and hidden dirs.
  const dirs = [];
  const files = [];
  for (const item of items) {
    if (IGNORE_DIRS.includes(item) || item.startsWith('.')) continue;
    const fullPath = path.join(dir, item);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) dirs.push(item);
      else files.push(item);
    } catch (e) { /* broken symlink — skip silently */ }
  }

  let treeStr = '';

  // ! Must use for loop (not forEach) to properly await recursive async calls
  for (let i = 0; i < dirs.length; i++) {
    const d = dirs[i];
    const isLast = (i === dirs.length - 1) && (files.length === 0);
    treeStr += `${prefix}${isLast ? '└── ' : '├── '}${d}/\n`;
    treeStr += await generateProjectTree(
      path.join(dir, d),
      prefix + (isLast ? '    ' : '│   '),
      depth + 1,
      maxDepth
    );
  }

  files.forEach((f, i) => {
    const isLast = i === files.length - 1;
    treeStr += `${prefix}${isLast ? '└── ' : '├── '}${f}\n`;
  });

  return treeStr;
}

// ==========================================
// IMPORT PATH RESOLVER
// ==========================================

/**
 * * Resolves relative import strings (e.g., './auth') to absolute file paths.
 * ? Handles TypeScript and JavaScript extension dropping.
 * ! Now async — uses fs.access() instead of fs.existsSync().
 */
async function resolveModulePath(baseFilePath, importPath) {
  const baseDir = path.dirname(baseFilePath);
  const targetPath = path.resolve(baseDir, importPath);
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
  for (const ext of extensions) {
    try {
      await fs.access(targetPath + ext);
      return targetPath + ext;
    } catch (e) { /* not found, try next extension */ }
  }
  return null;
}

// ==========================================
// RATE LIMITER
// ==========================================

///deleted the shitty ass rate limiter that was only here because of a fucking bug

// ==========================================
// MCP SERVER INITIALIZATION
// ==========================================

const server = new Server({
  name: "mcp-forge-compressor",
  version: "2.0.0",
}, {
  capabilities: { tools: {} },
});

// ==========================================
// TOOL DEFINITIONS
// ? Tells the AI what tools are available and what inputs they need.
// ==========================================

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
    },
    {
      name: "get_project_tree",
      description: "WORKSPACE RADAR: Generates a token-optimized visual map of the project's directory structure. Use this FIRST when dropped into an unknown codebase to identify entry points, source folders, and config files. Automatically filters out node_modules, .git, dist, build, and other noisy directories. Max depth: 4 levels.",
      inputSchema: {
        type: "object",
        properties: {
          absolutePath: { type: "string", description: "The absolute path of the root directory to map" }
        },
        required: ["absolutePath"],
      },
    }
  ],
}));

// ==========================================
// TOOL EXECUTION LOGIC
// ==========================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ? Check rate limit first for all requests
  //deleted the fucking check rate limit 

  // * --- Tool: get_file_skeleton ---
  if (name === "get_file_skeleton") {
    try {
      // SECURITY: Validate path is within allowed directories
      if (!isPathAllowed(args.filepath)) {
        return {
          isError: true,
          content: [{ type: "text", text: `[ERROR] Access denied: ${args.filepath} is outside the allowed directories.` }]
        };
      }

      // ? generateSemanticMap is sync (tree-sitter is sync by nature)
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

      // SECURITY: Validate path is within allowed directories
      if (!isPathAllowed(currentFilePath)) {
        return {
          isError: true,
          content: [{ type: "text", text: `[ERROR] Access denied: ${currentFilePath} is outside the allowed directories.` }]
        };
      }

      try {
        await fs.access(currentFilePath);
      } catch (e) {
        return { content: [{ type: "text", text: `Error: File not found at ${currentFilePath}` }] };
      }

      // Parse the current file's AST
      const sourceCode = await fs.readFile(currentFilePath, 'utf8');
      const ext = path.extname(currentFilePath);
      parser.setLanguage(['.ts', '.tsx'].includes(ext) ? TypeScript : JavaScript);
      const tree = parser.parse(sourceCode);

      // Scan top-level imports — supports both ES modules and CommonJS require()
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

      // Resolve the physical file path
      const resolved = await resolveModulePath(currentFilePath, importSource);
      if (!resolved) {
        return {
          content: [{ type: "text", text: `Import '${importSource}' found but could not resolve to a physical file. It may be a node_modules package.` }]
        };
      }

      // Return the bridge — the AI calls get_file_skeleton next
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

  // * --- Tool: get_project_tree (Workspace Radar) ---
  if (name === "get_project_tree") {
    try {
      const { absolutePath } = args;

      // SECURITY: Validate path is within allowed directories
      if (!isPathAllowed(absolutePath)) {
        return {
          isError: true,
          content: [{ type: "text", text: `[ERROR] Access denied: ${absolutePath} is outside the allowed directories.` }]
        };
      }

      let stat;
      try {
        stat = await fs.stat(absolutePath);
      } catch (e) {
        return { content: [{ type: "text", text: `Error: Directory not found at ${absolutePath}` }] };
      }

      if (!stat.isDirectory()) {
        return { content: [{ type: "text", text: `Error: ${absolutePath} is a file, not a directory. Pass a folder path.` }] };
      }

      const treeVisual = await generateProjectTree(absolutePath);

      return {
        content: [{
          type: "text",
          text: `PROJECT WORKSPACE MAP:\n\n${absolutePath}\n${treeVisual}\nNext: choose a relevant file and call get_file_skeleton to map its internal structure.`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error generating project tree: ${error.message}` }]
      };
    }
  }

  // * --- Tool: read_function_range ---
  if (name === "read_function_range") {
    try {
      // SECURITY: Validate path is within allowed directories
      if (!isPathAllowed(args.filepath)) {
        return {
          isError: true,
          content: [{ type: "text", text: `[ERROR] Access denied: ${args.filepath} is outside the allowed directories.` }]
        };
      }

      const content = await fs.readFile(args.filepath, 'utf8');
      const lines = content.split('\n');
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

// ==========================================
// BOOT SEQUENCE
// ==========================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);