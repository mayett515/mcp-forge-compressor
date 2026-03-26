const { generateSemanticMap } = require('./skeleton');
const fs = require('fs');
const path = require('path');

// * --- Test Runner ---
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}`);
    console.log(`   → ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getSkeletonOf(code, ext = '.js') {
  const tmpFile = path.join(__dirname, `__tmp_test${ext}`);
  fs.writeFileSync(tmpFile, code, 'utf8');
  try {
    return generateSemanticMap(tmpFile);
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

// * --- BASIC JS TESTS ---

test('plain function declaration', () => {
  const out = getSkeletonOf(`function greet(name) { return "hello " + name; }`);
  assert(out.includes('function greet(name)'), `Got: ${out}`);
});

test('async function declaration', () => {
  const out = getSkeletonOf(`async function fetchData(url) { return await fetch(url); }`);
  assert(out.includes('async function fetchData(url)'), `Got: ${out}`);
});

test('arrow function', () => {
  const out = getSkeletonOf(`const greet = (name) => { return name; }`);
  assert(out.includes('const greet =') && out.includes('=>'), `Got: ${out}`);
});

test('async arrow function', () => {
  const out = getSkeletonOf(`const fetchData = async (url) => { return await fetch(url); }`);
  assert(out.includes('async') && out.includes('fetchData'), `Got: ${out}`);
});

test('class with methods', () => {
  const out = getSkeletonOf(`
    class Database {
      constructor(url) { this.url = url; }
      async connect() { return true; }
      disconnect() {}
    }
  `);
  assert(out.includes('class Database'), `Got: ${out}`);
  assert(out.includes('constructor'), `Got: ${out}`);
  assert(out.includes('async connect'), `Got: ${out}`);
  assert(out.includes('disconnect'), `Got: ${out}`);
});

test('plain const variable is silent', () => {
  const out = getSkeletonOf(`const x = 42;`);
  assert(!out.includes('const x'), `Plain const should be silent, got: ${out}`);
});

test('array variable shows summary line only', () => {
  const out = getSkeletonOf(`const PATTERNS = [{ test() {}, label() {} }];`);
  assert(out.includes('const PATTERNS'), `Got: ${out}`);
  assert(!out.includes('test()') && !out.includes('label()'), `Internals leaked: ${out}`);
});

// * --- MODULE PATTERN TESTS ---

test('module.exports object', () => {
  const out = getSkeletonOf(`
    function getUser() {}
    function createUser() {}
    module.exports = { getUser, createUser };
  `);
  assert(out.includes('function getUser'), `Got: ${out}`);
  assert(out.includes('function createUser'), `Got: ${out}`);
});

test('export named function', () => {
  const out = getSkeletonOf(`export function getUser(id) { return id; }`);
  assert(out.includes('export') && out.includes('function getUser'), `Got: ${out}`);
});

test('export default function', () => {
  const out = getSkeletonOf(`export default function App() { return null; }`);
  assert(out.includes('export default') && out.includes('function App'), `Got: ${out}`);
});

test('export default class', () => {
  const out = getSkeletonOf(`export default class App { render() {} }`);
  assert(out.includes('export default') && out.includes('class App'), `Got: ${out}`);
});

test('re-export', () => {
  const out = getSkeletonOf(`export { getUser, createUser } from './users';`);
  assert(out.includes('getUser') || out.includes('export'), `Got: ${out}`);
});

// * --- TYPESCRIPT TESTS ---

test('TS interface', () => {
  const out = getSkeletonOf(`
    interface User {
      id: string;
      name: string;
      role: 'admin' | 'user';
    }
  `, '.ts');
  assert(out.includes('interface User'), `Got: ${out}`);
  assert(out.includes('id') && out.includes('name') && out.includes('role'), `Got: ${out}`);
});

test('TS enum', () => {
  const out = getSkeletonOf(`
    enum Direction { Up, Down, Left, Right }
  `, '.ts');
  assert(out.includes('enum Direction'), `Got: ${out}`);
});

test('TS type alias', () => {
  const out = getSkeletonOf(`
    type UserId = string | number;
  `, '.ts');
  assert(out.includes('type UserId'), `Got: ${out}`);
});

test('TS generic function', () => {
  const out = getSkeletonOf(`
    function identity<T>(arg: T): T { return arg; }
  `, '.ts');
  assert(out.includes('function identity'), `Got: ${out}`);
});

test('TS class with access modifiers', () => {
  const out = getSkeletonOf(`
    class AuthService {
      private users: string[] = [];
      public async isAdmin(id: string): Promise<boolean> { return true; }
      protected log(msg: string): void {}
    }
  `, '.ts');
  assert(out.includes('class AuthService'), `Got: ${out}`);
  assert(out.includes('public async isAdmin'), `Got: ${out}`);
  assert(out.includes('Promise<boolean>'), `Got: ${out}`);
});

test('TS abstract class', () => {
  const out = getSkeletonOf(`
    abstract class Animal {
      abstract makeSound(): void;
      move(): void {}
    }
  `, '.ts');
  assert(out.includes('abstract class Animal'), `Got: ${out}`);
});

test('TS export interface', () => {
  const out = getSkeletonOf(`
    export interface ApiResponse {
      data: unknown;
      status: number;
    }
  `, '.ts');
  assert(out.includes('export') && out.includes('interface ApiResponse'), `Got: ${out}`);
});

// * --- FRAMEWORK PATTERN TESTS ---

test('React useState', () => {
  const out = getSkeletonOf(`
    function Counter() {
      const [count, setCount] = useState(0);
      return count;
    }
  `);
  assert(out.includes('State:'), `Got: ${out}`);
});

test('React useEffect', () => {
  const out = getSkeletonOf(`
    function App() {
      useEffect(() => { console.log('mounted'); }, []);
    }
  `);
  assert(out.includes('Effect:'), `Got: ${out}`);
});

test('Express route', () => {
  const out = getSkeletonOf(`
    app.get('/users', (req, res) => { res.json([]); });
  `);
  assert(out.includes("Route: app.get('/users')"), `Got: ${out}`);
});

test('Vue ref', () => {
  const out = getSkeletonOf(`
    const count = ref(0);
  `);
  assert(out.includes('Reactive:'), `Got: ${out}`);
});

// * --- DECORATOR TESTS ---

test('TS decorator on class', () => {
  const out = getSkeletonOf(`
    @Injectable()
    class UserService {
      getUser() {}
    }
  `, '.ts');
  assert(out.includes('@Injectable()'), `Got: ${out}`);
  assert(out.includes('class UserService'), `Got: ${out}`);
});

test('TS decorator on method', () => {
  const out = getSkeletonOf(`
    class UserController {
      @Get('/users')
      getUsers() {}
    }
  `, '.ts');
  assert(out.includes('@Get') && out.includes('getUsers'), `Got: ${out}`);
});

// * --- EDGE CASE TESTS ---

test('empty file', () => {
  const out = getSkeletonOf(``);
  assert(out === '' || out.trim() === '', `Got: ${out}`);
});

test('file with only comments', () => {
  const out = getSkeletonOf(`// just a comment\n/* block comment */`);
  assert(!out.includes('function') && !out.includes('class'), `Got: ${out}`);
});

test('nested functions', () => {
  const out = getSkeletonOf(`
    function outer() {
      function inner() { return true; }
      return inner;
    }
  `);
  assert(out.includes('function outer'), `Got: ${out}`);
});

test('FRAMEWORK_PATTERNS self-match regression', () => {
  const out = getSkeletonOf(`
    const PATTERNS = [
      { test(node) { return /useState/.test(node.text); }, label() { return 'State'; } }
    ];
  `);
  assert(out.includes('const PATTERNS'), `Got: ${out}`);
  assert(!out.includes('State:'), `False positive regression: ${out}`);
});

// * --- RESULTS ---
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);