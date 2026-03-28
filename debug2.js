const { generateSemanticMap } = require('./skeleton');
const fs = require('fs');
const Parser = require('tree-sitter');
const JS = require('tree-sitter-javascript');
const p = new Parser();
p.setLanguage(JS);

const code = `import { useEffect } from 'react';
function App() {
  useEffect(() => { console.log('mounted'); }, []);
}`;

const tree = p.parse(code);
const fn = tree.rootNode.children[1]; // function App
const body = fn.childForFieldName('body');
body.children.forEach(c => {
  console.log('child type:', c.type);
  console.log('child text:', c.text);
});