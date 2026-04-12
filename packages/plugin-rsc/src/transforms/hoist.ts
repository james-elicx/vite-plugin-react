import { tinyassert } from '@hiogawa/utils'
import type {
  Program,
  Literal,
  Node,
  MemberExpression,
  Identifier,
} from 'estree'
import { walk } from 'estree-walker'
import MagicString from 'magic-string'
import { buildScopeTree, type ScopeTree } from './scope'

export function transformHoistInlineDirective(
  input: string,
  ast: Program,
  {
    runtime,
    rejectNonAsyncFunction,
    ...options
  }: {
    runtime: (
      value: string,
      name: string,
      meta: { directiveMatch: RegExpMatchArray },
    ) => string
    directive: string | RegExp
    rejectNonAsyncFunction?: boolean
    encode?: (value: string) => string
    decode?: (value: string) => string
    noExport?: boolean
  },
): {
  output: MagicString
  names: string[]
} {
  // ensure ending space so we can move node at the end without breaking magic-string
  if (!input.endsWith('\n')) {
    input += '\n'
  }
  const output = new MagicString(input)
  const directive =
    typeof options.directive === 'string'
      ? exactRegex(options.directive)
      : options.directive

  const scopeTree = buildScopeTree(ast)
  const names: string[] = []

  walk(ast, {
    enter(node, parent) {
      if (
        (node.type === 'FunctionExpression' ||
          node.type === 'FunctionDeclaration' ||
          node.type === 'ArrowFunctionExpression') &&
        node.body.type === 'BlockStatement'
      ) {
        const match = matchDirective(node.body.body, directive)?.match
        if (!match) return
        if (!node.async && rejectNonAsyncFunction) {
          throw Object.assign(
            new Error(`"${directive}" doesn't allow non async function`),
            {
              pos: node.start,
            },
          )
        }

        const declName = node.type === 'FunctionDeclaration' && node.id.name
        const originalName =
          declName ||
          (parent?.type === 'VariableDeclarator' &&
            parent.id.type === 'Identifier' &&
            parent.id.name) ||
          'anonymous_server_function'

        const bindVars = getBindVars(node, scopeTree)

        // Arrow functions inherit `arguments` from the enclosing non-arrow
        // function.  After hoisting to a regular function, `arguments`
        // would refer to the hoisted function's own arguments.  Capture the
        // original `arguments` as a bind var and rewrite references.
        let argumentsBindVar: BindVar | undefined
        if (node.type === 'ArrowFunctionExpression') {
          const argumentsRefs = collectArgumentsReferences(node)
          if (argumentsRefs.length > 0) {
            argumentsBindVar = {
              root: '$$hoist_arguments',
              expr: 'arguments',
            }
            for (const ref of argumentsRefs) {
              output.update(ref.start, ref.end, '$$hoist_arguments')
            }
          }
        }

        const allBindVars = argumentsBindVar
          ? [...bindVars, argumentsBindVar]
          : bindVars
        const hasDefaultParams = node.params.some((p) =>
          containsPattern(p, 'AssignmentPattern'),
        )
        let newParams = [
          ...allBindVars.map((b) => b.root),
          ...node.params.map((n) => input.slice(n.start, n.end)),
        ].join(', ')
        if (allBindVars.length > 0 && options.decode) {
          if (hasDefaultParams) {
            // Default parameter initializers run before the function body,
            // so decoded vars must be available at param evaluation time.
            // We decode via a destructuring param default, which is
            // evaluated left-to-right before the original params:
            //   ($$enc, [a, b] = __dec($$enc), { x = a } = {}) => ...
            newParams = [
              '$$hoist_encoded',
              `[${allBindVars.map((b) => b.root).join(', ')}] = ${options.decode(
                '$$hoist_encoded',
              )}`,
              ...node.params.map((n) => input.slice(n.start, n.end)),
            ].join(', ')
          } else {
            newParams = [
              '$$hoist_encoded',
              ...node.params.map((n) => input.slice(n.start, n.end)),
            ].join(', ')
            output.appendLeft(
              node.body.body[0]!.start,
              `const [${allBindVars.map((b) => b.root).join(',')}] = ${options.decode(
                '$$hoist_encoded',
              )};\n`,
            )
          }
        }

        // append a new `FunctionDeclaration` at the end
        const newName =
          `$$hoist_${names.length}` + (originalName ? `_${originalName}` : '')
        names.push(newName)
        const isGenerator =
          'generator' in node && (node as { generator?: boolean }).generator
        output.update(
          node.start,
          node.body.start,
          `\n;${options.noExport ? '' : 'export '}${
            node.async ? 'async ' : ''
          }function${isGenerator ? '*' : ''} ${newName}(${newParams}) `,
        )
        output.appendLeft(
          node.end,
          `;\n/* #__PURE__ */ Object.defineProperty(${newName}, "name", { value: ${JSON.stringify(
            originalName,
          )} });\n`,
        )
        output.move(node.start, node.end, input.length)

        // replace original declartion with action register + bind
        // Arrow functions lexically inherit `this`.  When the hoisted arrow
        // body uses `this`, we capture it via `.bind(this, ...)` so the
        // converted regular function receives the correct `this` value.
        const needsThisBind =
          node.type === 'ArrowFunctionExpression' &&
          containsThisExpression(node)
        let newCode = `/* #__PURE__ */ ${runtime(newName, newName, {
          directiveMatch: match,
        })}`
        if (allBindVars.length > 0 || needsThisBind) {
          const bindTarget = needsThisBind ? 'this' : 'null'
          const bindArgs =
            allBindVars.length > 0
              ? options.encode
                ? options.encode(
                    '[' + allBindVars.map((b) => b.expr).join(', ') + ']',
                  )
                : allBindVars.map((b) => b.expr).join(', ')
              : ''
          newCode = bindArgs
            ? `${newCode}.bind(${bindTarget}, ${bindArgs})`
            : `${newCode}.bind(${bindTarget})`
        }
        if (declName) {
          newCode = `const ${declName} = ${newCode};`
          if (parent?.type === 'ExportDefaultDeclaration') {
            output.remove(parent.start, node.start)
            newCode = `${newCode}\nexport default ${declName};`
          }
        }
        output.appendLeft(node.start, newCode)
      }
    },
  })

  return {
    output,
    names,
  }
}

const exactRegex = (s: string): RegExp =>
  new RegExp('^' + s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '$')

function matchDirective(
  body: Program['body'],
  directive: RegExp,
): { match: RegExpMatchArray; node: Literal } | undefined {
  for (const stmt of body) {
    if (
      stmt.type === 'ExpressionStatement' &&
      stmt.expression.type === 'Literal' &&
      typeof stmt.expression.value === 'string'
    ) {
      const match = stmt.expression.value.match(directive)
      if (match) {
        return { match, node: stmt.expression }
      }
    }
  }
}

export function findDirectives(ast: Program, directive: string): Literal[] {
  const directiveRE = exactRegex(directive)
  const nodes: Literal[] = []
  walk(ast, {
    enter(node) {
      if (node.type === 'Program' || node.type === 'BlockStatement') {
        const match = matchDirective(node.body, directiveRE)
        if (match) {
          nodes.push(match.node)
        }
      }
    },
  })
  return nodes
}

type BindVar = {
  root: string // hoisted function param name (root identifier name)
  expr: string // bind expression at the call site (root name or synthesized partial object)
}

// e.g.
// x.y.z -> { key: "y.z", segments: ["y", "z"] }
type BindPath = {
  // TODO: This currently models only plain non-computed member chains like
  // `x.y.z`. Supporting optional chaining or computed access would require
  // richer per-segment metadata and corresponding codegen changes.
  key: string
  segments: string[]
}

function getBindVars(fn: Node, scopeTree: ScopeTree): BindVar[] {
  const fnScope = scopeTree.nodeScope.get(fn)!
  const ancestorScopes = fnScope.getAncestorScopes()
  const references = scopeTree.scopeToReferences.get(fnScope) ?? []

  // bind references that are declared in an ancestor scope, but not module scope nor global
  const bindReferences = references.filter((id) => {
    const scope = scopeTree.referenceToDeclaredScope.get(id)
    return scope && scope !== scopeTree.moduleScope && ancestorScopes.has(scope)
  })

  // Group by referenced identifier name (root).
  // For each root, track whether the root itself is used
  // bare (direct identifier access) or only via member paths.
  type IdentifierAccess =
    | { kind: 'bare' }
    | { kind: 'paths'; paths: BindPath[] }

  const accessMap: Record<string, IdentifierAccess> = {}

  for (const id of bindReferences) {
    const name = id.name
    const node = scopeTree.referenceToNode.get(id)!
    if (node.type === 'Identifier') {
      accessMap[name] = { kind: 'bare' }
      continue
    }

    accessMap[name] ??= { kind: 'paths', paths: [] }
    const entry = accessMap[name]
    if (entry.kind === 'paths') {
      const path = memberExpressionToPath(node)
      if (!entry.paths.some((existing) => existing.key === path.key)) {
        entry.paths.push(path)
      }
    }
  }

  const result: BindVar[] = []
  for (const [root, entry] of Object.entries(accessMap)) {
    if (entry.kind === 'bare') {
      result.push({ root, expr: root })
      continue
    }
    result.push({
      root,
      expr: synthesizePartialObject(root, entry.paths),
    })
  }

  return result
}

function memberExpressionToPath(node: MemberExpression): BindPath {
  const segments: string[] = []
  let current: Identifier | MemberExpression = node
  while (current.type === 'MemberExpression') {
    tinyassert(current.property.type === 'Identifier')
    segments.unshift(current.property.name)
    tinyassert(
      current.object.type === 'Identifier' ||
        current.object.type === 'MemberExpression',
    )
    current = current.object
  }
  return {
    key: segments.join('.'),
    segments,
  }
}

// Build a nested object literal string from member paths, deduping prefixes
// during trie construction.
// e.g.
// [a, x.y, x.y.z, x.w, s.t] =>
// { a: root.a, x: { y: root.x.y, w: root.x.w }, s: { t: root.s.t } }
function synthesizePartialObject(root: string, bindPaths: BindPath[]): string {
  type TrieNode = Map<string, TrieNode>
  const trie = new Map<string, TrieNode>()

  const paths = dedupeByPrefix(bindPaths.map((p) => p.segments))
  for (const path of paths) {
    let node = trie
    for (let i = 0; i < path.length; i++) {
      const segment = path[i]!
      let child = node.get(segment)
      if (!child) {
        child = new Map()
        node.set(segment, child)
      }
      node = child
    }
  }

  function serialize(node: TrieNode, segments: string[]): string {
    if (node.size === 0) {
      return root + segments.map((segment) => `.${segment}`).join('')
    }
    const entries: string[] = []
    for (const [key, child] of node) {
      // ECMAScript object literals treat `__proto__: value` specially: when the
      // property name is non-computed and equals "__proto__", evaluation performs
      // [[SetPrototypeOf]] instead of creating a normal own data property. Emit a
      // computed key here so synthesized partial objects preserve the original
      // member-path shape rather than mutating the new object's prototype.
      // Spec: https://tc39.es/ecma262/#sec-runtime-semantics-propertydefinitionevaluation
      const safeKey = key === '__proto__' ? `["__proto__"]` : key
      entries.push(`${safeKey}: ${serialize(child, [...segments, key])}`)
    }
    return `{ ${entries.join(', ')} }`
  }

  return serialize(trie, [])
}

// Check whether an AST node (or any descendant) matches a given type.
function containsPattern(node: Node, type: string): boolean {
  let found = false
  walk(node, {
    enter(n) {
      if (found) return this.skip()
      if (n.type === type) {
        found = true
        return this.skip()
      }
    },
  })
  return found
}

// Collect positions of `arguments` Identifier references inside an arrow
// function.  Stops at non-arrow functions (which have their own `arguments`)
// but descends into nested arrows (which inherit `arguments` lexically).
// Returns an empty array when there are no references.
function collectArgumentsReferences(fn: Node): Identifier[] {
  const refs: Identifier[] = []
  walk(fn, {
    enter(node, parent) {
      if (
        node !== fn &&
        (node.type === 'FunctionDeclaration' ||
          node.type === 'FunctionExpression')
      ) {
        return this.skip()
      }
      if (
        node.type === 'Identifier' &&
        node.name === 'arguments' &&
        // Exclude declaration positions (e.g. `var arguments`)
        !(parent?.type === 'VariableDeclarator' && parent.id === node)
      ) {
        refs.push(node)
      }
    },
  })
  return refs
}

// Check whether a function body contains `ThisExpression`.  Stops at nested
// non-arrow functions (which have their own `this`) but descends into arrow
// functions (which inherit `this` lexically).
function containsThisExpression(fn: Node): boolean {
  let found = false
  walk(fn, {
    enter(node) {
      if (found) return this.skip()
      if (node.type === 'ThisExpression') {
        found = true
        return this.skip()
      }
      // Non-arrow functions create their own `this` — don't descend.
      if (
        node !== fn &&
        (node.type === 'FunctionDeclaration' ||
          node.type === 'FunctionExpression')
      ) {
        return this.skip()
      }
    },
  })
  return found
}

// e.g.
// [x.y, x.y.z, x.w] -> [x.y, x.w]
// [x.y.z, x.y.z.w] -> [x.y.z]
function dedupeByPrefix(paths: string[][]): string[][] {
  const sorted = [...paths].sort((a, b) => a.length - b.length)
  const result: string[][] = []
  for (const path of sorted) {
    const isPrefix = result.some((existingPath) =>
      existingPath.every((segment, i) => segment === path[i]),
    )
    if (!isPrefix) {
      result.push(path)
    }
  }
  return result
}
