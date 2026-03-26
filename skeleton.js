const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const fs = require('fs');
const path = require('path');

const parser = new Parser();

// * --- Helper Utilities ---

function lineRef(node) {
  const start = node.startPosition.row + 1;
  const end = node.endPosition.row + 1;
  return start === end ? `[Line ${start}]` : `[Lines ${start}-${end}]`;
}

function extractMembers(bodyNode) {
  if (!bodyNode) return '';
  const names = [];
  for (const child of bodyNode.children) {
    // Interface: property_signature, method_signature
    // Enum: enum_assignment, property_identifier
    const nameNode = child.childForFieldName('name');
    if (nameNode) {
      names.push(nameNode.text);
    }
  }
  return names.length > 0 ? `{ ${names.join(', ')} }` : '';
}

function extractAccessModifier(node) {
  for (const child of node.children) {
    if (child.type === 'accessibility_modifier') {
      return child.text + ' ';
    }
  }
  return '';
}

function extractReturnType(node) {
  for (const child of node.children) {
    if (child.type === 'type_annotation') {
      return child.text;
    }
  }
  return '';
}

function isAsync(node) {
  for (const child of node.children) {
    if (child.type === 'async') return true;
  }
  return false;
}

function squashImports(rootNode) {
  const imports = [];
  let startLine = Infinity;
  let endLine = 0;

  for (const child of rootNode.children) {
    if (child.type === 'import_statement') {
      const start = child.startPosition.row + 1;
      const end = child.endPosition.row + 1;
      if (start < startLine) startLine = start;
      if (end > endLine) endLine = end;

      // Extract the import clause and source
      const text = child.text.replace(/\s+/g, ' ').replace(/^import /, '').replace(/;$/, '');
      imports.push(text);
    }
  }

  if (imports.length === 0) return '';
  const ref = startLine === endLine ? `[Line ${startLine}]` : `[Lines ${startLine}-${endLine}]`;
  return `${ref} Imports: ${imports.join(', ')}`;
}

// * --- Framework Pattern Registry ---

// * --- Helper: extracts the actual call expression function name from a variable declarator ---
// ? Used to verify a lexical_declaration is genuinely CALLING a hook, not just mentioning it in text.
function getCallExpressionName(node) {
  for (const child of node.children) {
    if (child.type === 'variable_declarator') {
      const value = child.childForFieldName('value');
      if (value && value.type === 'call_expression') {
        return value.childForFieldName('function')?.text || null;
      }
    }
  }
  return null;
}

// * --- Helper: extracts the method name from an expression_statement call ---
// ? e.g. useEffect(...) → 'useEffect', app.get(...) → 'app.get'
function getExpressionCallName(node) {
  const expr = node.children.find(c => c.type === 'call_expression' || c.type === 'await_expression');
  if (!expr) return null;
  const call = expr.type === 'await_expression'
    ? expr.children.find(c => c.type === 'call_expression')
    : expr;
  if (!call) return null;
  return call.childForFieldName('function')?.text || null;
}

const FRAMEWORK_PATTERNS = [
  // React State: const [x, setX] = useState(...)
  {
    test(node) {
      if (node.type !== 'lexical_declaration') return false;
      // FIX: Check the actual AST call expression name, not raw text.
      // Prevents false-positive on any node whose text merely *mentions* useState (e.g. this array itself).
      const callName = getCallExpressionName(node);
      return callName === 'useState' || callName === 'useReducer';
    },
    label(node) {
      const decl = node.text.replace(/\s+/g, ' ').replace(/;$/, '').trim();
      return `State: ${decl}`;
    }
  },
  // React Effects: useEffect(() => {...}, [deps])
  {
    test(node) {
      if (node.type !== 'expression_statement') return false;
      // FIX: Check actual call expression name in AST, not raw text match.
      const callName = getExpressionCallName(node);
      return callName === 'useEffect' || callName === 'useLayoutEffect';
    },
    label(node) {
      const match = node.text.match(/\b(useEffect|useLayoutEffect)/);
      const hookName = match ? match[1] : 'useEffect';
      const depsMatch = node.text.match(/,\s*\[([^\]]*)\]\s*\)\s*;?\s*$/);
      const deps = depsMatch ? depsMatch[1].trim() : '';
      return `Effect: ${hookName}(() => {...}, [${deps}])`;
    }
  },
  // Vue Reactivity: const x = ref(...) / reactive(...) / computed(...)
  {
    test(node) {
      if (node.type !== 'lexical_declaration') return false;
      // FIX: Check actual call expression name in AST, not raw text match.
      // Prevents false-positive on variables whose text contains 'ref' or 'computed' as strings.
      const callName = getCallExpressionName(node);
      return callName === 'ref' || callName === 'reactive' || callName === 'computed';
    },
    label(node) {
      const decl = node.text.replace(/\s+/g, ' ').replace(/;$/, '').trim();
      return `Reactive: ${decl}`;
    }
  },
  // Express/Nest Routing: app.get('/path', handler)
  {
    test(node) {
      if (node.type !== 'expression_statement') return false;
      // FIX: Check actual call expression name in AST, not raw text match.
      const callName = getExpressionCallName(node);
      if (!callName) return false;
      return /^(app|router)\.(get|post|put|patch|delete|use|all|options|head)$/.test(callName);
    },
    label(node) {
      const match = node.text.match(/\b(app|router)\.(get|post|put|patch|delete|use|all|options|head)\s*\(\s*['"`]([^'"`]*)['"`]/);
      if (match) {
        return `Route: ${match[1]}.${match[2]}('${match[3]}')`;
      }
      const methodMatch = node.text.match(/\b(app|router)\.(get|post|put|patch|delete|use|all|options|head)/);
      if (methodMatch) {
        return `Route: ${methodMatch[1]}.${methodMatch[2]}(...)`;
      }
      return 'Route: unknown';
    }
  },
];

function matchFrameworkPattern(node) {
  for (const pattern of FRAMEWORK_PATTERNS) {
    if (pattern.test(node)) {
      return pattern.label(node);
    }
  }
  return null;
}

// * --- Core Walker ---

function generateSkeleton(node, depth, ctx) {
  let output = '';
  const indent = '  '.repeat(depth);
  const ref = lineRef(node);

  // 1. Skip imports (handled by squashImports)
  if (node.type === 'import_statement') return '';

  // 2. Accumulate decorators
  if (node.type === 'decorator') {
    ctx.pendingDecorators.push(node.text);
    return '';
  }

  // 3. JSDoc comments
  if (node.type === 'comment' && node.text.startsWith('/**')) {
    const lines = node.text.split('\n');
    const summary = lines[0].replace('/**', '').replace(/\*\/\s*$/, '').trim();
    const tags = lines
      .filter(l => /@(deprecated|param|returns|throws|see|todo)/.test(l))
      .map(l => l.trim().replace(/^\*\s*/, ''));
    let jsdoc = summary ? `/** ${summary}` : '/**';
    if (tags.length) jsdoc += ' ' + tags.join(' ');
    jsdoc += ' */';
    output += `${indent}${ref} ${jsdoc}\n`;
    return output;
  }

  // 4. Check framework patterns (before generic handling)
  const patternLabel = matchFrameworkPattern(node);
  if (patternLabel) {
    output += `${indent}${ref} ${patternLabel}\n`;
    return output;
  }

  // 5. Flush pending decorators when we hit a decorated target
  if (ctx.pendingDecorators.length > 0 &&
      ['class_declaration', 'abstract_class_declaration', 'method_definition',
       'function_declaration'].includes(node.type)) {
    for (const dec of ctx.pendingDecorators) {
      output += `${indent}${ref} ${dec}\n`;
    }
    ctx.pendingDecorators = [];
  }

  // 6. Export statement — pass prefix to child, flatten into one line
  if (node.type === 'export_statement') {
    const isDefault = node.children.some(c => c.type === 'default');
    const prefix = isDefault ? 'export default ' : 'export ';

    for (const child of node.children) {
      if (['class_declaration', 'abstract_class_declaration', 'function_declaration',
           'lexical_declaration', 'variable_declaration',
           'interface_declaration', 'type_alias_declaration', 'enum_declaration'
          ].includes(child.type)) {
        output += generateSkeleton(child, depth, { ...ctx, pendingDecorators: [], exportPrefix: prefix });
      }
    }
    // If export has no recognized child (e.g., export { foo, bar })
    if (output === '') {
      const clause = node.text.replace(/\s+/g, ' ').replace(/;$/, '').trim();
      output += `${indent}${ref} ${clause}\n`;
    }
    return output;
  }

  // 7. Enum declaration
  if (node.type === 'enum_declaration') {
    const name = node.childForFieldName('name')?.text || 'Unknown';
    const body = node.childForFieldName('body');
    const members = extractMembers(body);
    const prefix = ctx.exportPrefix || '';
    output += `${indent}${ref} ${prefix}enum ${name} ${members}\n`;
    return output;
  }

  // 8. Interface declaration
  if (node.type === 'interface_declaration') {
    const name = node.childForFieldName('name')?.text || 'Unknown';
    const body = node.childForFieldName('body');
    const members = extractMembers(body);
    const prefix = ctx.exportPrefix || '';
    output += `${indent}${ref} ${prefix}interface ${name} ${members}\n`;
    return output;
  }

  // 9. Type alias
  if (node.type === 'type_alias_declaration') {
    const name = node.childForFieldName('name')?.text || 'Unknown';
    const prefix = ctx.exportPrefix || '';
    output += `${indent}${ref} ${prefix}type ${name}\n`;
    return output;
  }

  // 10. Class declaration
  if (node.type === 'class_declaration' || node.type === 'abstract_class_declaration') {
    const name = node.childForFieldName('name')?.text || 'Unknown';
    const prefix = ctx.exportPrefix || '';
    const abstractLabel = node.type === 'abstract_class_declaration' ? 'abstract ' : '';
    output += `${indent}${ref} ${prefix}${abstractLabel}class ${name} {\n`;

    const body = node.children.find(c => c.type === 'class_body');
    if (body) {
      const childCtx = { pendingDecorators: [], exportPrefix: '' };
      for (const child of body.children) {
        output += generateSkeleton(child, depth + 1, childCtx);
      }
    }
    output += `${indent}}\n`;
    return output;
  }

  // 11. Method definition
  if (node.type === 'method_definition') {
    const name = node.childForFieldName('name')?.text || 'anonymous';
    const params = node.childForFieldName('parameters')?.text || '()';
    const asyncLabel = isAsync(node) ? 'async ' : '';
    const access = extractAccessModifier(node);
    const returnType = extractReturnType(node);
    output += `${indent}${ref} ${access}${asyncLabel}${name}${params}${returnType}\n`;
    return output;
  }

  // 12. Function declaration — emit header, then recurse body for nested patterns
  if (node.type === 'function_declaration') {
    const name = node.childForFieldName('name')?.text || 'anonymous';
    const params = node.childForFieldName('parameters')?.text || '()';
    const asyncLabel = isAsync(node) ? 'async ' : '';
    const returnType = extractReturnType(node);
    const prefix = ctx.exportPrefix || '';
    const body = node.childForFieldName('body');
    const hasInnerContent = body && body.children.some(c =>
      c.type !== '{' && c.type !== '}' &&
      (matchFrameworkPattern(c) !== null ||
       c.type === 'function_declaration' || c.type === 'class_declaration' ||
       c.type === 'lexical_declaration' || c.type === 'expression_statement')
    );
    if (hasInnerContent) {
      output += `${indent}${ref} ${prefix}${asyncLabel}function ${name}${params}${returnType} {\n`;
      const childCtx = { pendingDecorators: [], exportPrefix: '' };
      for (const child of body.children) {
        output += generateSkeleton(child, depth + 1, childCtx);
      }
      output += `${indent}}\n`;
    } else {
      output += `${indent}${ref} ${prefix}${asyncLabel}function ${name}${params}${returnType}\n`;
    }
    return output;
  }

  // 13. Arrow function / function expression in variable declaration
  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    for (const child of node.children) {
      if (child.type === 'variable_declarator') {
        const value = child.childForFieldName('value');
        if (value && (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function')) {
          const name = child.childForFieldName('name')?.text || 'anonymous';
          const params = value.childForFieldName('parameters')?.text || '()';
          const asyncLabel = isAsync(value) ? 'async ' : '';
          const returnType = extractReturnType(value);
          const keyword = node.children[0]?.text || 'const';
          const prefix = ctx.exportPrefix || '';
          if (value.type === 'arrow_function') {
            output += `${indent}${ref} ${prefix}${keyword} ${name} = ${asyncLabel}${params}${returnType} =>\n`;
          } else {
            output += `${indent}${ref} ${prefix}${keyword} ${name} = ${asyncLabel}function${params}${returnType}\n`;
          }
          return output;
        }
      }
    }
    // Not an arrow/function expression — fall through to default recursion
  }

  // 14. Default: recurse into children
  for (const child of node.children) {
    output += generateSkeleton(child, depth, ctx);
  }
  return output;
}

// * --- Public API ---

function generateSemanticMap(filePath) {
  const ext = path.extname(filePath);
  parser.setLanguage(ext === '.ts' || ext === '.tsx' ? TypeScript : JavaScript);
  const source = fs.readFileSync(filePath, 'utf8');
  const tree = parser.parse(source);
  const root = tree.rootNode;

  let output = '';
  const ctx = { pendingDecorators: [], exportPrefix: '' };

  // Phase 1: Squash imports into single line
  const importLine = squashImports(root);
  if (importLine) output += importLine + '\n';

  // Phase 2: Walk all non-import children
  for (const child of root.children) {
    if (child.type === 'import_statement') continue;
    output += generateSkeleton(child, 0, ctx);
  }

  return output;
}

module.exports = { generateSemanticMap };
