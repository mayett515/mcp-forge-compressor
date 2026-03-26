const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');

const parser = new Parser();
parser.setLanguage(JavaScript);

const sourceCode = `
  class Database {
    constructor(url) { this.url = url; }
    async connect() { 
      console.log("Connecting...");
      return true; 
    }
    async query(sql, params) { return []; }
  }
  function standaloneHelper(a, b) { return a + b; }
`;

const tree = parser.parse(sourceCode);

// This function "walks" the tree and picks out only the structural definitions
function getSkeleton(node) {
  let skeleton = "";

  // We only care about Classes, Methods, and Functions
  if (node.type === 'class_declaration') {
    const name = node.childForFieldName('name').text;
    skeleton += `class ${name} {\n`;
    // Walk the children of the class
    node.children.forEach(child => skeleton += getSkeleton(child));
    skeleton += `}\n`;
  } 
  else if (node.type === 'method_definition' || node.type === 'function_declaration') {
    const name = node.childForFieldName('name').text;
    const params = node.childForFieldName('parameters').text;
    const isAsync = node.text.startsWith('async') ? 'async ' : '';
    skeleton += `  ${isAsync}${name}${params}\n`;
  }
  else {
    // If it's not a definition, keep walking down to find nested definitions
    node.children.forEach(child => {
      skeleton += getSkeleton(child);
    });
  }

  return skeleton;
}

console.log("--- COMPRESSED SKELETON ---");
console.log(getSkeleton(tree.rootNode));