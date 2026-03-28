// ==========================================
// skeleton.js
// Core AST walker and skeleton generator.
//
// * --- RESPONSIBILITIES ---
//   1. Parse source files into AST using tree-sitter
//   2. Walk the AST and extract structural landmarks
//   3. Squash imports into a single summary line
//   4. Detect language and frameworks from file
//   5. Match nodes against compiled patterns via pattern-loader
//   6. Return a compressed skeleton string with line references
//
// * --- ARCHITECTURE ---
//   generateSemanticMap(filePath)      <- public API, called by server.js
//     └── squashImports(root)          <- phase 1: compress imports
//     └── generateSkeleton(node, depth, ctx) <- phase 2: walk AST
//           └── pattern-loader.matchPattern() <- check compiled patterns
//           └── structural handlers (class, function, method, etc.)
// ==========================================

"use strict";

const Parser     = require("tree-sitter");
const JavaScript = require("tree-sitter-javascript");
const TypeScript = require("tree-sitter-typescript").typescript;
const fs         = require("fs");
const path       = require("path");
const {
  matchPattern,
  detectLanguage,
  detectFrameworks,
} = require("./pattern-loader");

const parser = new Parser();

// ==========================================
// HELPER UTILITIES
// ==========================================

/**
 * * Returns a line reference string for a node.
 * Single line -> "[Line N]", multi-line -> "[Lines N-M]"
 */
function lineRef(node) {
  const start = node.startPosition.row + 1;
  const end   = node.endPosition.row + 1;
  return start === end ? `[Line ${start}]` : `[Lines ${start}-${end}]`;
}

/**
 * * Extracts member names from an interface or enum body node.
 * FIX: Added fallback find for property_identifier/identifier because 
 * tree-sitter-typescript does not always map 'name' as a field.
 */
function extractMembers(bodyNode) {
  if (!bodyNode) return "";
  const names = [];
  for (const child of bodyNode.children) {
    const nameNode =
      child.childForFieldName("name") ||
      child.children.find(
        (c) => c.type === "property_identifier" || c.type === "identifier",
      );
    if (nameNode) names.push(nameNode.text);
  }
  return names.length > 0 ? `{ ${names.join(", ")} }` : "";
}

/**
 * * Extracts the access modifier from a method or field node.
 */
function extractAccessModifier(node) {
  for (const child of node.children) {
    if (child.type === "accessibility_modifier") return child.text + " ";
  }
  return "";
}

/**
 * * Extracts the TypeScript return type annotation from a node.
 */
function extractReturnType(node) {
  for (const child of node.children) {
    if (child.type === "type_annotation") return child.text;
  }
  return "";
}

/**
 * * Checks if a node represents an async function or method.
 * FIX: Added c.text === "async" and absolute Regex fallback for edge cases 
 * where 'async' is an un-noded string text depending on the parser version.
 */
function isAsync(node) {
  if (!node) return false;
  if (node.children.some((c) => c.type === "async" || c.text === "async")) return true;
  return typeof node.text === "string" && /^async\b/.test(node.text);
}

/**
 * * Squashes all import statements at the root level into a single summary line.
 * ? WHY: This dramatically reduces token usage for the AI agent.
 */
function squashImports(rootNode) {
  const imports = [];
  let startLine = Infinity;
  let endLine   = 0;

  for (const child of rootNode.children) {
    if (child.type === "import_statement") {
      const start = child.startPosition.row + 1;
      const end   = child.endPosition.row + 1;
      if (start < startLine) startLine = start;
      if (end > endLine)     endLine   = end;

      const text = child.text
        .replace(/\s+/g, " ")
        .replace(/^import /, "")
        .replace(/;$/, "");
      imports.push(text);
    }
  }

  if (imports.length === 0) return "";
  const ref =
    startLine === endLine
      ? `[Line ${startLine}]`
      : `[Lines ${startLine}-${endLine}]`;
  return `${ref} Imports: ${imports.join(", ")}`;
}

// ==========================================
// CORE WALKER
// ==========================================

/**
 * * Recursively walks an AST node and returns a skeleton string.
 */
function generateSkeleton(node, depth, ctx) {
  let output    = "";
  const indent  = "  ".repeat(depth);
  const ref     = lineRef(node);

  // 1. Skip imports — handled by squashImports in phase 1
  if (node.type === "import_statement") return "";

  // 2. Accumulate decorators — flushed in step 5
  if (node.type === "decorator") {
    ctx.pendingDecorators.push(node.text);
    return "";
  }

  // 3. JSDoc comments — extract summary line and relevant tags
  if (node.type === "comment" && node.text.startsWith("/**")) {
    const lines   = node.text.split("\n");
    const summary = lines[0].replace("/**", "").replace(/\*\/\s*$/, "").trim();
    const tags    = lines
      .filter((l) => /@(deprecated|param|returns|throws|see|todo)/.test(l))
      .map((l) => l.trim().replace(/^\*\s*/, ""));
    let jsdoc = summary ? `/** ${summary}` : "/**";
    if (tags.length) jsdoc += " " + tags.join(" ");
    jsdoc += " */";
    output += `${indent}${ref} ${jsdoc}\n`;
    return output;
  }

  // 4. Check compiled YAML patterns via pattern-loader
  // ! isPatternable restricts pattern matching to statement-level nodes.
  // ! This prevents YAML patterns from matching structural blocks (like classes)
  // ! and short-circuiting the walker before methods/decorators are extracted.
  const isPatternable = [
    "lexical_declaration",
    "variable_declaration",
    "expression_statement",
    "return_statement"
  ].includes(node.type);

  if (isPatternable) {
    const patternLabel = ctx.matchPattern ? ctx.matchPattern(node) : null;
    
    // * If the YAML loader found a match, output it and stop recursing!
    if (patternLabel) {
      const prefix = ctx.exportPrefix || "";
      output += `${indent}${ref} ${prefix}${patternLabel}\n`;
      return output;
    }
  }

  // 5. Flush pending decorators when we hit a decorated target node
  if (
    ctx.pendingDecorators.length > 0 &&
    [
      "class_declaration",
      "abstract_class_declaration",
      "method_definition",
      "function_declaration",
      "public_field_definition",
    ].includes(node.type)
  ) {
    for (const dec of ctx.pendingDecorators) {
      output += `${indent}${ref} ${dec}\n`;
    }
    ctx.pendingDecorators = [];
  }

  // 6. Export statement — pass export prefix down to children
  if (node.type === "export_statement") {
    const isDefault = node.children.some((c) => c.type === "default");
    const prefix    = isDefault ? "export default " : "export ";

    for (const child of node.children) {
      if (
        [
          "class_declaration",
          "abstract_class_declaration",
          "function_declaration",
          "lexical_declaration",
          "variable_declaration",
          "interface_declaration",
          "type_alias_declaration",
          "enum_declaration",
        ].includes(child.type)
      ) {
        output += generateSkeleton(child, depth, {
          ...ctx,
          pendingDecorators: [],
          exportPrefix: prefix,
        });
      }
    }
    // Fall back to showing raw export clause if no structural child is found
    if (output === "") {
      const clause = node.text.replace(/\s+/g, " ").replace(/;$/, "").trim();
      output += `${indent}${ref} ${clause}\n`;
    }
    return output;
  }

  // 7. Enum declaration
  if (node.type === "enum_declaration") {
    const nameNode =
      node.childForFieldName("name") ||
      node.children.find((c) => c.type === "identifier");
    const name    = nameNode ? nameNode.text : "Unknown";
    const body    = node.childForFieldName("body");
    const members = extractMembers(body);
    const prefix  = ctx.exportPrefix || "";
    output += `${indent}${ref} ${prefix}enum ${name} ${members}\n`;
    return output;
  }

  // 8. Interface declaration
  if (node.type === "interface_declaration") {
    const nameNode =
      node.childForFieldName("name") ||
      node.children.find(
        (c) => c.type === "type_identifier" || c.type === "identifier",
      );
    const name    = nameNode ? nameNode.text : "Unknown";
    const body    = node.childForFieldName("body");
    const members = extractMembers(body);
    const prefix  = ctx.exportPrefix || "";
    output += `${indent}${ref} ${prefix}interface ${name} ${members}\n`;
    return output;
  }

  // 9. Type alias declaration
  if (node.type === "type_alias_declaration") {
    const nameNode =
      node.childForFieldName("name") ||
      node.children.find(
        (c) => c.type === "type_identifier" || c.type === "identifier",
      );
    const name   = nameNode ? nameNode.text : "Unknown";
    const prefix = ctx.exportPrefix || "";
    output += `${indent}${ref} ${prefix}type ${name}\n`;
    return output;
  }

  // 10. Class declaration (including abstract classes)
  if (
    node.type === "class_declaration" ||
    node.type === "abstract_class_declaration"
  ) {
    const nameNode =
      node.childForFieldName("name") ||
      node.children.find(
        (c) => c.type === "type_identifier" || c.type === "identifier",
      );
    const name          = nameNode ? nameNode.text : "Unknown";
    const prefix        = ctx.exportPrefix || "";
    const abstractLabel =
      node.type === "abstract_class_declaration" ? "abstract " : "";

    // Extract decorators that are direct children of the class node (TypeScript)
    const decorators = node.children.filter((c) => c.type === "decorator");
    for (const dec of decorators) {
      output += `${indent}${ref} ${dec.text}\n`;
    }
    output += `${indent}${ref} ${prefix}${abstractLabel}class ${name} {\n`;

    const body = node.children.find((c) => c.type === "class_body");
    if (body) {
      const childCtx = {
        pendingDecorators: [],
        exportPrefix:      "",
        matchPattern:      ctx.matchPattern,
      };
      for (const child of body.children) {
        output += generateSkeleton(child, depth + 1, childCtx);
      }
    }
    output += `${indent}}\n`;
    return output;
  }

  // 11. Method definition and field definitions
  if (
    [
      "method_definition",
      "method_signature",
      "public_field_definition",
      "field_definition",
    ].includes(node.type)
  ) {
    const nameNode =
      node.childForFieldName("name") ||
      node.children.find(
        (c) => c.type === "property_identifier" || c.type === "identifier",
      );
    const name       = nameNode ? nameNode.text : "anonymous";
    let params       = node.childForFieldName("parameters")?.text || "";
    let asyncLabel   = isAsync(node) ? "async " : "";
    const access     = extractAccessModifier(node);
    const returnType = extractReturnType(node);

    // Check if the field value is an arrow function or function expression
    const value = node.childForFieldName("value");
    let isArrow = false;
    if (
      value &&
      (value.type === "arrow_function" ||
        value.type === "function_expression")
    ) {
      isArrow = true;
      params  = value.childForFieldName("parameters")?.text || "()";
      if (isAsync(value)) asyncLabel = "async ";
    }

    if (
      node.type === "public_field_definition" ||
      node.type === "field_definition"
    ) {
      if (isArrow) {
        output += `${indent}${ref} ${access}${name} = ${asyncLabel}${params} =>${returnType}\n`;
      } else {
        output += `${indent}${ref} ${access}${name}${returnType}\n`;
      }
    } else {
      if (!params) params = "()";
      output += `${indent}${ref} ${access}${asyncLabel}${name}${params}${returnType}\n`;
    }
    return output;
  }

  // 12. Function declaration
  // * Emits the function header. If the body contains nested structural
  // * definitions, the body is expanded with { } so the agent can see what is inside.
  if (node.type === "function_declaration") {
    const name       = node.childForFieldName("name")?.text || "anonymous";
    const params     = node.childForFieldName("parameters")?.text || "()";
    const asyncLabel = isAsync(node) ? "async " : "";
    const returnType = extractReturnType(node);
    const prefix     = ctx.exportPrefix || "";
    const body       = node.childForFieldName("body");

    // ? Check if we should render the inside of the function
    const hasInnerContent =
      body &&
      body.children.some((c) => {
        if (
          c.type === "function_declaration" ||
          c.type === "class_declaration"
        )
          return true;
        
        // Trigger YAML pattern match check
        if (ctx.matchPattern && ctx.matchPattern(c) !== null) return true;
        
        if (
          c.type === "lexical_declaration" ||
          c.type === "variable_declaration"
        ) {
          for (const child of c.children) {
            if (child.type === "variable_declarator") {
              const value = child.childForFieldName("value");
              if (
                value &&
                (value.type === "arrow_function" ||
                  value.type === "function_expression")
              )
                return true;
            }
          }
        }
        return false;
      });

    if (hasInnerContent) {
      output += `${indent}${ref} ${prefix}${asyncLabel}function ${name}${params}${returnType} {\n`;
      const childCtx = {
        pendingDecorators: [],
        exportPrefix:      "",
        matchPattern:      ctx.matchPattern,
      };
      for (const child of body.children) {
        output += generateSkeleton(child, depth + 1, childCtx);
      }
      output += `${indent}}\n`;
    } else {
      output += `${indent}${ref} ${prefix}${asyncLabel}function ${name}${params}${returnType}\n`;
    }
    return output;
  }

  // 13. Variable declaration (Arrow function / function expression)
  if (
    node.type === "lexical_declaration" ||
    node.type === "variable_declaration"
  ) {
    for (const child of node.children) {
      if (child.type === "variable_declarator") {
        const value = child.childForFieldName("value");

        // * 13a. Array or object literal — show summary line, never recurse
        // ! This prevents data structures that contain hook names (like FRAMEWORK_PATTERNS)
        // ! from being falsely detected as framework patterns
        if (
          value &&
          (value.type === "array" ||
            value.type === "array_expression" ||
            value.type === "object")
        ) {
          const name    = child.childForFieldName("name")?.text || "unknown";
          const keyword = node.children[0]?.text || "const";
          const prefix  = ctx.exportPrefix || "";
          output += `${indent}${ref} ${prefix}${keyword} ${name}\n`;
          return output;
        }

        // * 13b. Arrow function or function expression — emit signature
        if (
          value &&
          (value.type === "arrow_function" ||
            value.type === "function_expression" ||
            value.type === "function")
        ) {
          const name       = child.childForFieldName("name")?.text || "anonymous";
          const params     = value.childForFieldName("parameters")?.text || "()";
          const asyncLabel = isAsync(value) ? "async " : "";
          const returnType = extractReturnType(value);
          const keyword    = node.children[0]?.text || "const";
          const prefix     = ctx.exportPrefix || "";
          if (value.type === "arrow_function") {
            output += `${indent}${ref} ${prefix}${keyword} ${name} = ${asyncLabel}${params}${returnType} =>\n`;
          } else {
            output += `${indent}${ref} ${prefix}${keyword} ${name} = ${asyncLabel}function${params}${returnType}\n`;
          }
          return output;
        }
      }
    }
  }

  // 14. Default recursion
  for (const child of node.children) {
    output += generateSkeleton(child, depth, ctx);
  }
  return output;
}

// ==========================================
// PUBLIC API
// ==========================================

/**
 * * Generates a compressed AST skeleton for a source file.
 * This is the main entry point called by server.js MCP tools.
 */
function generateSemanticMap(filePath) {
  const ext = path.extname(filePath);
  parser.setLanguage(ext === ".ts" || ext === ".tsx" ? TypeScript : JavaScript);
  const source = fs.readFileSync(filePath, "utf8");
  const tree   = parser.parse(source);
  const root   = tree.rootNode;

  const lang = detectLanguage(filePath) || "js";
  const frameworks = detectFrameworks(root);

  const boundMatchPattern = (node) => matchPattern(node, lang, frameworks);

  let output = "";
  const ctx  = {
    pendingDecorators: [],
    exportPrefix:      "",
    matchPattern:      boundMatchPattern,
  };

  const importLine = squashImports(root);
  if (importLine) output += importLine + "\n";

  for (const child of root.children) {
    if (child.type === "import_statement") continue;
    output += generateSkeleton(child, 0, ctx);
  }

  return output;
}

module.exports = { generateSemanticMap };