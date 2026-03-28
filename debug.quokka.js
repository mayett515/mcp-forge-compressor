const Parser = require("tree-sitter");
const JS = require("tree-sitter-javascript");

const p = new Parser();
p.setLanguage(JS);

const t = p.parse("async function fetchData(url) { return await fetch(url); }");
const fn = t.rootNode.children[0];

const type = 'async';
type === 'async'; // Should be true
type === "async"; // Should also be true

// Check what children types actually are
const childTypes = fn.children.map((c) => c.type);
childTypes; // What types do we see?

// Check each child
fn.children.forEach((c) => {
  c.type; // Show each type
});

// Manual isAsync check
const hasAsync = fn.children.some((c) => c.type === "async");
hasAsync; // Is there an async child?

// Check isAsync
function isAsync(node) {
  for (const child of node.children) {
    if (child.type === "async") return true;
  }
  return false;
}

// Check what step 12 produces
const name = fn.childForFieldName("name")?.text;
const params = fn.childForFieldName("parameters")?.text;
const asyncLabel = isAsync(fn) ? "async " : "";
const returnType = "";
const prefix = "";

const result = `${prefix}${asyncLabel}function ${name}${params}${returnType}`;


result; // Should show: async function fetchData(url)
isAsync(fn); // Should show: true
asyncLabel; // Should show: 'async '
