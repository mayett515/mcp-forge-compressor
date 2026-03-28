// ==========================================
// skeleton.test.js
// Vitest test suite for the AST Skeleton Generator
//
// * --- RESPONSIBILITIES ---
//   1. Verify AST parsing for native JS/TS structures
//   2. Ensure framework patterns (React, Vue, Express) match correctly
//   3. Prevent regressions during major architecture refactors
//
// ? --- HOW IT WORKS ---
//   Reuses the getSkeletonOf() helper pattern from test.cases.js.
//   We create a temporary file with test code, run the skeleton
//   generator on it, assert the output, then delete the temp file.
// ==========================================

const { generateSemanticMap } = require('./skeleton');
const fs = require('fs');
const path = require('path');

/**
 * * Helper: Writes code to a temp file, parses it, and cleans up.
 * ! WARNING: Ensure this process has write permissions in the current directory.
 * @param {string} code - The raw source code to analyze
 * @param {string} ext  - The file extension (determines if we parse as JS or TS)
 * @returns {string} The generated semantic skeleton
 */
function getSkeletonOf(code, ext = '.js') {
  const tmpFile = path.join(__dirname, `__tmp_vitest${ext}`);
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

describe('Native JavaScript', () => {
  it('plain function declaration', () => {
    const out = getSkeletonOf(`function greet(name) { return "hello " + name; }`);
    expect(out).toContain('function greet(name)');
  });

  it('async function declaration', () => {
    const out = getSkeletonOf(`async function fetchData(url) { return await fetch(url); }`);
    expect(out).toContain('async function fetchData(url)');
  });

  it('arrow function', () => {
    const out = getSkeletonOf(`const greet = (name) => { return name; }`);
    expect(out).toContain('const greet =');
    expect(out).toContain('=>');
  });

  it('async arrow function', () => {
    const out = getSkeletonOf(`const fetchData = async (url) => { return await fetch(url); }`);
    expect(out).toContain('async');
    expect(out).toContain('fetchData');
  });

  it('class with methods', () => {
    const out = getSkeletonOf(`
      class Database {
        constructor(url) { this.url = url; }
        async connect() { return true; }
        disconnect() {}
      }
    `);
    expect(out).toContain('class Database');
    expect(out).toContain('constructor');
    expect(out).toContain('async connect');
    expect(out).toContain('disconnect');
  });

  it('plain const variable is silent', () => {
    const out = getSkeletonOf(`const x = 42;`);
    // ! We do not want to flood the AI agent with basic variable assignments
    expect(out).not.toContain('const x');
  });

  it('array variable shows summary line only', () => {
    const out = getSkeletonOf(`const PATTERNS = [{ test() {}, label() {} }];`);
    expect(out).toContain('const PATTERNS');
    // * Ensure we don't accidentally parse functions hidden inside data arrays
    expect(out).not.toContain('test()');
    expect(out).not.toContain('label()');
  });
});

// ==========================================
// MODULE & EXPORT TESTS
// ==========================================

describe('Module & Exports', () => {
  it('module.exports object', () => {
    const out = getSkeletonOf(`
      function getUser() {}
      function createUser() {}
      module.exports = { getUser, createUser };
    `);
    expect(out).toContain('function getUser');
    expect(out).toContain('function createUser');
  });

  it('export named function', () => {
    const out = getSkeletonOf(`export function getUser(id) { return id; }`);
    expect(out).toContain('export');
    expect(out).toContain('function getUser');
  });

  it('export default function', () => {
    const out = getSkeletonOf(`export default function App() { return null; }`);
    expect(out).toContain('export default');
    expect(out).toContain('function App');
  });

  it('export default class', () => {
    const out = getSkeletonOf(`export default class App { render() {} }`);
    expect(out).toContain('export default');
    expect(out).toContain('class App');
  });

  it('re-export', () => {
    const out = getSkeletonOf(`export { getUser, createUser } from './users';`);
    expect(out).toMatch(/getUser|export/);
  });
});

// ==========================================
// TYPESCRIPT TESTS
// ==========================================

describe('TypeScript', () => {
  it('TS interface', () => {
    const out = getSkeletonOf(`
      interface User {
        id: string;
        name: string;
        role: 'admin' | 'user';
      }
    `, '.ts');
    expect(out).toContain('interface User');
    expect(out).toContain('id');
    expect(out).toContain('name');
    expect(out).toContain('role');
  });

  it('TS enum', () => {
    const out = getSkeletonOf(`
      enum Direction { Up, Down, Left, Right }
    `, '.ts');
    expect(out).toContain('enum Direction');
  });

  it('TS type alias', () => {
    const out = getSkeletonOf(`
      type UserId = string | number;
    `, '.ts');
    expect(out).toContain('type UserId');
  });

  it('TS generic function', () => {
    const out = getSkeletonOf(`
      function identity<T>(arg: T): T { return arg; }
    `, '.ts');
    expect(out).toContain('function identity');
  });

  it('TS class with access modifiers', () => {
    const out = getSkeletonOf(`
      class AuthService {
        private users: string[] = [];
        public async isAdmin(id: string): Promise<boolean> { return true; }
        protected log(msg: string): void {}
      }
    `, '.ts');
    expect(out).toContain('class AuthService');
    expect(out).toContain('public async isAdmin');
    expect(out).toContain('Promise<boolean>');
  });

  it('TS abstract class', () => {
    const out = getSkeletonOf(`
      abstract class Animal {
        abstract makeSound(): void;
        move(): void {}
      }
    `, '.ts');
    expect(out).toContain('abstract class Animal');
  });

  it('TS export interface', () => {
    const out = getSkeletonOf(`
      export interface ApiResponse {
        data: unknown;
        status: number;
      }
    `, '.ts');
    expect(out).toContain('export');
    expect(out).toContain('interface ApiResponse');
  });
});

// ==========================================
// FRAMEWORK PATTERN TESTS (YAML)
// ==========================================

describe('Framework Patterns (YAML)', () => {
  it('React useState', () => {
    const out = getSkeletonOf(`
      import { useState } from 'react';
      function Counter() {
        const [count, setCount] = useState(0);
        return count;
      }
    `);
    expect(out).toContain('State:');
  });

  it('React useEffect', () => {
    const out = getSkeletonOf(`
      import { useEffect } from 'react';
      function App() {
        useEffect(() => { console.log('mounted'); }, []);
      }
    `);
    expect(out).toContain('Effect:');
  });

  it('Express route', () => {
    const out = getSkeletonOf(`
      const express = require('express');
      const app = express();
      app.get('/users', (req, res) => { res.json([]); });
    `);
    expect(out).toContain('Route:');
  });

  it('Vue ref', () => {
    const out = getSkeletonOf(`
      import { ref } from 'vue';
      const count = ref(0);
    `);
    // FIX: Updated expected string to match the more precise vue.logic.yaml
    // Legacy code grouped this as 'Reactive:', but the YAML correctly labels it 'Ref:'
    expect(out).toContain('Ref:');
  });
});

// ==========================================
// DECORATOR TESTS
// ==========================================

describe('Decorators', () => {
  it('TS decorator on class', () => {
    const out = getSkeletonOf(`
      @Injectable()
      class UserService {
        getUser() {}
      }
    `, '.ts');
    expect(out).toContain('@Injectable()');
    expect(out).toContain('class UserService');
  });

  it('TS decorator on method', () => {
    const out = getSkeletonOf(`
      class UserController {
        @Get('/users')
        getUsers() {}
      }
    `, '.ts');
    expect(out).toContain('@Get');
    expect(out).toContain('getUsers');
  });
});

// ==========================================
// EDGE CASE TESTS
// ==========================================

describe('Edge Cases', () => {
  it('empty file', () => {
    const out = getSkeletonOf(``);
    expect(out.trim()).toBe('');
  });

  it('file with only comments', () => {
    const out = getSkeletonOf(`// just a comment\n/* block comment */`);
    expect(out).not.toContain('function');
    expect(out).not.toContain('class');
  });

  it('nested functions', () => {
    const out = getSkeletonOf(`
      function outer() {
        function inner() { return true; }
        return inner;
      }
    `);
    // * Inner logic is generally skipped unless it contains a framework pattern
    expect(out).toContain('function outer');
  });

  it('FRAMEWORK_PATTERNS self-match regression', () => {
    const out = getSkeletonOf(`
      const PATTERNS = [
        { test(node) { return /useState/.test(node.text); }, label() { return 'State'; } }
      ];
    `);
    expect(out).toContain('const PATTERNS');
    // ! Ensure the word "useState" in a string doesn't falsely trigger our React patterns
    expect(out).not.toContain('State:');
  });
});
