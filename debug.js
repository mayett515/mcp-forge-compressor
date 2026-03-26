const Parser = require('tree-sitter');
const TypeScript = require('tree-sitter-typescript').typescript;
const p = new Parser();
p.setLanguage(TypeScript);
const t = p.parse(`@Injectable()\nclass UserService { getUser() {} }`);
t.rootNode.children.forEach(c => {
  console.log('NODE TYPE:', c.type);
  console.log('CHILDREN:', c.children.map(x => x.type));
  console.log('---');
});