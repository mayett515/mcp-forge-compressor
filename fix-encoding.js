const fs = require('fs');
const path = require('path');

const files = {
  'patterns/js/core.data.yaml': `# ==========================================
# js/core.data.yaml
# Core JavaScript structural patterns
# These apply to ALL JS files regardless of framework
# DO NOT EDIT patterns.compiled.yaml directly
# Run: node compile-patterns.js to recompile
# ==========================================

# --- Functions ---

- id: js-function
  lang: js
  label: "function {name}{params}"
  target:
    kind: function_declaration

- id: js-async-function
  lang: js
  label: "async function {name}{params}"
  target:
    kind: function_declaration
    modifiers: [async]

- id: js-arrow-function
  lang: js
  label: "const {name} = {params} =>"
  target:
    kind: arrow_function

- id: js-async-arrow-function
  lang: js
  label: "const {name} = async {params} =>"
  target:
    kind: arrow_function
    modifiers: [async]

# --- Classes ---

- id: js-class
  lang: js
  label: "class {name}"
  target:
    kind: class_declaration

# --- Modules ---

- id: js-module-exports
  lang: js
  label: "module.exports = {exports}"
  target:
    kind: expression_statement
    object: module
    property: exports
`,

  'patterns/js/react.logic.yaml': `# ==========================================
# js/react.logic.yaml
# React specific patterns for JavaScript
# These only run when react is detected in imports
# DO NOT EDIT patterns.compiled.yaml directly
# Run: node compile-patterns.js to recompile
# ==========================================

# --- Hooks ---

- id: react-state
  lang: js
  framework: react
  # description: "Matches React useState and useReducer hook declarations"
  label: "State: {declaration}"
  target:
    kind: lexical_declaration
  match: |
    ANY declarator IN node.children WHERE (
      declarator.call == useState OR declarator.call == useReducer
    )

- id: react-effect
  lang: js
  framework: react
  # description: "Matches React useEffect and useLayoutEffect hook calls"
  label: "Effect: {call}(() => {...}, [{deps}])"
  target:
    kind: expression_statement
  match: |
    ANY child IN node.children WHERE (
      child.call == useEffect OR child.call == useLayoutEffect
    )

- id: react-context
  lang: js
  framework: react
  # description: "Matches React useContext hook"
  label: "Context: {declaration}"
  target:
    kind: lexical_declaration
  match: |
    ANY declarator IN node.children WHERE (
      declarator.call == useContext
    )

- id: react-ref
  lang: js
  framework: react
  # description: "Matches React useRef hook"
  label: "Ref: {declaration}"
  target:
    kind: lexical_declaration
  match: |
    ANY declarator IN node.children WHERE (
      declarator.call == useRef
    )

- id: react-memo
  lang: js
  framework: react
  # description: "Matches React useMemo and useCallback hooks"
  label: "Memo: {declaration}"
  target:
    kind: lexical_declaration
  match: |
    ANY declarator IN node.children WHERE (
      declarator.call == useMemo OR declarator.call == useCallback
    )

- id: react-custom-hook
  lang: js
  framework: react
  # description: "Matches custom React hooks"
  label: "Hook: {name}{params}"
  target:
    kind: function_declaration
  match: |
    node.name starts_with use AND
    node.name != useEffect AND
    node.name != useState AND
    node.name != useReducer AND
    node.name != useContext AND
    node.name != useRef AND
    node.name != useMemo AND
    node.name != useCallback AND
    node.name != useLayoutEffect

- id: react-component
  lang: js
  framework: react
  # description: "Matches React functional components"
  label: "Component: {name}{params}"
  target:
    kind: function_declaration
  match: |
    node.name starts_with_capital
`,

  'patterns/js/express.logic.yaml': `# ==========================================
# js/express.logic.yaml
# Express specific patterns for JavaScript
# These only run when express is detected in imports
# DO NOT EDIT patterns.compiled.yaml directly
# Run: node compile-patterns.js to recompile
# ==========================================

- id: express-get
  lang: js
  framework: express
  label: "Route: {object}.get({path})"
  target:
    kind: expression_statement
  match: |
    ANY child IN node.children WHERE (
      child.method_call == app.get OR
      child.method_call == router.get
    )

- id: express-post
  lang: js
  framework: express
  label: "Route: {object}.post({path})"
  target:
    kind: expression_statement
  match: |
    ANY child IN node.children WHERE (
      child.method_call == app.post OR
      child.method_call == router.post
    )

- id: express-put
  lang: js
  framework: express
  label: "Route: {object}.put({path})"
  target:
    kind: expression_statement
  match: |
    ANY child IN node.children WHERE (
      child.method_call == app.put OR
      child.method_call == router.put
    )

- id: express-patch
  lang: js
  framework: express
  label: "Route: {object}.patch({path})"
  target:
    kind: expression_statement
  match: |
    ANY child IN node.children WHERE (
      child.method_call == app.patch OR
      child.method_call == router.patch
    )

- id: express-delete
  lang: js
  framework: express
  label: "Route: {object}.delete({path})"
  target:
    kind: expression_statement
  match: |
    ANY child IN node.children WHERE (
      child.method_call == app.delete OR
      child.method_call == router.delete
    )

- id: express-use
  lang: js
  framework: express
  label: "Middleware: {object}.use({path})"
  target:
    kind: expression_statement
  match: |
    ANY child IN node.children WHERE (
      child.method_call == app.use OR
      child.method_call == router.use
    )

- id: express-router
  lang: js
  framework: express
  label: "Router: {name} = express.Router()"
  target:
    kind: lexical_declaration
  match: |
    ANY declarator IN node.children WHERE (
      declarator.method_call == express.Router
    )
`,

  'patterns/js/vue.logic.yaml': `# ==========================================
# js/vue.logic.yaml
# Vue specific patterns for JavaScript
# These only run when vue is detected in imports
# DO NOT EDIT patterns.compiled.yaml directly
# Run: node compile-patterns.js to recompile
# ==========================================

- id: vue-ref
  lang: js
  framework: vue
  label: "Ref: {declaration}"
  target:
    kind: lexical_declaration
  match: |
    ANY declarator IN node.children WHERE (
      declarator.call == ref
    )

- id: vue-reactive
  lang: js
  framework: vue
  label: "Reactive: {declaration}"
  target:
    kind: lexical_declaration
  match: |
    ANY declarator IN node.children WHERE (
      declarator.call == reactive
    )

- id: vue-computed
  lang: js
  framework: vue
  label: "Computed: {declaration}"
  target:
    kind: lexical_declaration
  match: |
    ANY declarator IN node.children WHERE (
      declarator.call == computed
    )

- id: vue-watch
  lang: js
  framework: vue
  label: "Watch: {declaration}"
  target:
    kind: expression_statement
  match: |
    ANY child IN node.children WHERE (
      child.call == watch
    )

- id: vue-watch-effect
  lang: js
  framework: vue
  label: "WatchEffect: {declaration}"
  target:
    kind: expression_statement
  match: |
    ANY child IN node.children WHERE (
      child.call == watchEffect
    )

- id: vue-define-component
  lang: js
  framework: vue
  label: "Component: {name}"
  target:
    kind: lexical_declaration
  match: |
    ANY declarator IN node.children WHERE (
      declarator.call == defineComponent
    )

- id: vue-define-props
  lang: js
  framework: vue
  label: "Props: {declaration}"
  target:
    kind: lexical_declaration
  match: |
    ANY declarator IN node.children WHERE (
      declarator.call == defineProps
    )

- id: vue-define-emits
  lang: js
  framework: vue
  label: "Emits: {declaration}"
  target:
    kind: lexical_declaration
  match: |
    ANY declarator IN node.children WHERE (
      declarator.call == defineEmits
    )

- id: vue-lifecycle
  lang: js
  framework: vue
  label: "Lifecycle: {call}(() => {...})"
  target:
    kind: expression_statement
  match: |
    ANY child IN node.children WHERE (
      child.call == onMounted OR
      child.call == onUnmounted OR
      child.call == onCreated OR
      child.call == onBeforeMount OR
      child.call == onBeforeUnmount OR
      child.call == onUpdated OR
      child.call == onBeforeUpdate
    )
`,

  'patterns/ts/core.data.yaml': `# ==========================================
# ts/core.data.yaml
# Core TypeScript structural patterns
# These apply to ALL TS files regardless of framework
# DO NOT EDIT patterns.compiled.yaml directly
# Run: node compile-patterns.js to recompile
# ==========================================

- id: ts-function
  lang: ts
  label: "function {name}{params}{returnType}"
  target:
    kind: function_declaration

- id: ts-async-function
  lang: ts
  label: "async function {name}{params}{returnType}"
  target:
    kind: function_declaration
    modifiers: [async]

- id: ts-arrow-function
  lang: ts
  label: "const {name} = {params}{returnType} =>"
  target:
    kind: arrow_function

- id: ts-async-arrow-function
  lang: ts
  label: "const {name} = async {params}{returnType} =>"
  target:
    kind: arrow_function
    modifiers: [async]

- id: ts-class
  lang: ts
  label: "class {name}"
  target:
    kind: class_declaration

- id: ts-abstract-class
  lang: ts
  label: "abstract class {name}"
  target:
    kind: abstract_class_declaration

- id: ts-interface
  lang: ts
  label: "interface {name} {members}"
  target:
    kind: interface_declaration

- id: ts-type-alias
  lang: ts
  label: "type {name}"
  target:
    kind: type_alias_declaration

- id: ts-enum
  lang: ts
  label: "enum {name} {members}"
  target:
    kind: enum_declaration

- id: ts-generic-function
  lang: ts
  label: "function {name}<{typeParams}>{params}{returnType}"
  target:
    kind: function_declaration
    has_type_parameters: true

- id: ts-export-function
  lang: ts
  label: "export function {name}{params}{returnType}"
  target:
    kind: function_declaration
    modifiers: [export]

- id: ts-export-class
  lang: ts
  label: "export class {name}"
  target:
    kind: class_declaration
    modifiers: [export]

- id: ts-export-interface
  lang: ts
  label: "export interface {name} {members}"
  target:
    kind: interface_declaration
    modifiers: [export]

- id: ts-export-type
  lang: ts
  label: "export type {name}"
  target:
    kind: type_alias_declaration
    modifiers: [export]

- id: ts-export-enum
  lang: ts
  label: "export enum {name} {members}"
  target:
    kind: enum_declaration
    modifiers: [export]

- id: ts-export-default
  lang: ts
  label: "export default {name}"
  target:
    kind: export_statement
    modifiers: [default]
`,

  'patterns/ts/nestjs.logic.yaml': `# ==========================================
# ts/nestjs.logic.yaml
# NestJS specific patterns for TypeScript
# These only run when nestjs is detected in imports
# DO NOT EDIT patterns.compiled.yaml directly
# Run: node compile-patterns.js to recompile
# ==========================================

- id: nestjs-controller
  lang: ts
  framework: nestjs
  label: "Controller: {name}"
  target:
    kind: class_declaration
  match: |
    ANY decorator IN node.decorators WHERE (
      decorator.name == Controller
    )

- id: nestjs-injectable
  lang: ts
  framework: nestjs
  label: "Injectable: {name}"
  target:
    kind: class_declaration
  match: |
    ANY decorator IN node.decorators WHERE (
      decorator.name == Injectable
    )

- id: nestjs-module
  lang: ts
  framework: nestjs
  label: "Module: {name}"
  target:
    kind: class_declaration
  match: |
    ANY decorator IN node.decorators WHERE (
      decorator.name == Module
    )

- id: nestjs-get
  lang: ts
  framework: nestjs
  label: "GET: {name}{params}"
  target:
    kind: method_definition
  match: |
    ANY decorator IN node.decorators WHERE (
      decorator.name == Get
    )

- id: nestjs-post
  lang: ts
  framework: nestjs
  label: "POST: {name}{params}"
  target:
    kind: method_definition
  match: |
    ANY decorator IN node.decorators WHERE (
      decorator.name == Post
    )

- id: nestjs-put
  lang: ts
  framework: nestjs
  label: "PUT: {name}{params}"
  target:
    kind: method_definition
  match: |
    ANY decorator IN node.decorators WHERE (
      decorator.name == Put
    )

- id: nestjs-patch
  lang: ts
  framework: nestjs
  label: "PATCH: {name}{params}"
  target:
    kind: method_definition
  match: |
    ANY decorator IN node.decorators WHERE (
      decorator.name == Patch
    )

- id: nestjs-delete
  lang: ts
  framework: nestjs
  label: "DELETE: {name}{params}"
  target:
    kind: method_definition
  match: |
    ANY decorator IN node.decorators WHERE (
      decorator.name == Delete
    )

- id: nestjs-guard
  lang: ts
  framework: nestjs
  label: "Guard: {name}"
  target:
    kind: method_definition
  match: |
    ANY decorator IN node.decorators WHERE (
      decorator.name == UseGuards
    )

- id: nestjs-interceptor
  lang: ts
  framework: nestjs
  label: "Interceptor: {name}"
  target:
    kind: method_definition
  match: |
    ANY decorator IN node.decorators WHERE (
      decorator.name == UseInterceptors
    )

- id: nestjs-pipe
  lang: ts
  framework: nestjs
  label: "Pipe: {name}"
  target:
    kind: method_definition
  match: |
    ANY decorator IN node.decorators WHERE (
      decorator.name == UsePipes
    )
`
};

// Write all files as UTF-8
let count = 0;
for (const [filePath, content] of Object.entries(files)) {
  fs.writeFileSync(filePath, content, { encoding: 'utf8' });
  console.log(`✅ Written: ${filePath}`);
  count++;
}

console.log(`\nDone! ${count} files written as UTF-8.`);
console.log('Now run: node compile-patterns.js');