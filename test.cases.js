// ==========================================
// test.cases.js
// Test suite for the AST Skeleton Generator
//
// * --- RESPONSIBILITIES ---
//   1. Verify AST parsing for native JS/TS structures
//   2. Ensure framework patterns (React, Vue, Express) match correctly
//   3. Prevent regressions during major architecture refactors
//
// ? --- HOW IT WORKS ---
//   We create a temporary file with the test code, run the skeleton
//   generator on it, assert the output, and then immediately delete
//   the temporary file.
// ==========================================

const { generateSemanticMap } = require('./skeleton');
const fs = require('fs');
const path = require('path');

// ==========================================
// TEST RUNNER ENGINE
// ==========================================

let passed = 0;
let failed = 0;

/**
 * * Executes a single test case safely.
 * @param {string} name - The readable name of the test
 * @param {Function} fn - The test logic to execute
 */
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

/**
 * * Validates a condition and throws a detailed error if it fails.
 */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * * Helper: Writes code to a temp file, parses it, and cleans up.
 * ! WARNING: Ensure this process has write permissions in the current directory.
 * * @param {string} code - The raw source code to analyze
 * @param {string} ext  - The file extension (determines if we parse as JS or TS)
 * @returns {string} The generated semantic skeleton
 */
function getSkeletonOf(code, ext = '.js') {
  const tmpFile = path.join(__dirname, `__tmp_test${ext}`);
  fs.writeFileSync(tmpFile, code, 'utf8');
  try {
    return generateSemanticMap(tmpFile);
  } finally {
    // ? Always clean up the temp file even if the generator crashes
    fs.unlinkSync(tmpFile);
  }
}

// ==========================================
// NATIVE JAVASCRIPT TESTS
// ==========================================

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
  // ! We do not want to flood the AI agent with basic variable assignments
  assert(!out.includes('const x'), `Plain const should be silent, got: ${out}`);
});

test('array variable shows summary line only', () => {
  const out = getSkeletonOf(`const PATTERNS = [{ test() {}, label() {} }];`);
  assert(out.includes('const PATTERNS'), `Got: ${out}`);
  // * Ensure we don't accidentally parse functions hidden inside data arrays
  assert(!out.includes('test()') && !out.includes('label()'), `Internals leaked: ${out}`);
});

// ==========================================
// MODULE & EXPORT TESTS
// ==========================================

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

// ==========================================
// TYPESCRIPT TESTS
// ==========================================

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

// ==========================================
// FRAMEWORK PATTERN TESTS (YAML)
// ==========================================

test('React useState', () => {
  const out = getSkeletonOf(`
    import { useState } from 'react';
    function Counter() {
      const [count, setCount] = useState(0);
      return count;
    }
  `);
  assert(out.includes('State:'), `Got: ${out}`);
});

test('React useEffect', () => {
  const out = getSkeletonOf(`
    import { useEffect } from 'react';
    function App() {
      useEffect(() => { console.log('mounted'); }, []);
    }
  `);
  assert(out.includes('Effect:'), `Got: ${out}`);
});

test('Express route', () => {
  const out = getSkeletonOf(`
    const express = require('express');
    const app = express();
    app.get('/users', (req, res) => { res.json([]); });
  `);
  assert(out.includes("Route:"), `Got: ${out}`);
});

test('Vue ref', () => {
  const out = getSkeletonOf(`
    import { ref } from 'vue';
    const count = ref(0);
  `);
  
  // FIX: Updated expected string to match the more precise vue.logic.yaml
  // Legacy code grouped this as 'Reactive:', but the YAML correctly labels it 'Ref:'
  assert(out.includes('Ref:'), `Got: ${out}`);
});

// ==========================================
// DECORATOR TESTS
// ==========================================

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

// ==========================================
// EDGE CASE TESTS
// ==========================================

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
  // * Inner logic is generally skipped unless it contains a framework pattern
  assert(out.includes('function outer'), `Got: ${out}`);
});

test('FRAMEWORK_PATTERNS self-match regression', () => {
  const out = getSkeletonOf(`
    const PATTERNS = [
      { test(node) { return /useState/.test(node.text); }, label() { return 'State'; } }
    ];
  `);
  assert(out.includes('const PATTERNS'), `Got: ${out}`);
  // ! Ensure the word "useState" in a string doesn't falsely trigger our React patterns
  assert(!out.includes('State:'), `False positive regression: ${out}`);
});

// ==========================================
// EXECUTE RESULTS
// ==========================================

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);