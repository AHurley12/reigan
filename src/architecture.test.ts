import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { dirname, extname, join, relative, resolve, sep } from 'path'
import { fileURLToPath } from 'url'

/**
 * Architectural invariants, enforced rather than documented.
 *
 * A cycle between modules is not a style problem. Under CommonJS one of the
 * two files in the cycle receives a partially-initialised module object, so
 * whichever import lands second sees `undefined` for anything not yet
 * assigned. The failure surfaces as "X is not a function" at startup, from a
 * file that looks correct in isolation, and which of the two breaks depends on
 * which one the bundler happens to load first — so it can survive review, pass
 * locally, and appear only in the packaged build.
 *
 * This is checked here rather than by adding a dependency on madge, because
 * the whole check is a depth-first search over the import graph.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)))
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (EXTENSIONS.includes(extname(entry.name))) out.push(full)
  }
  return out
}

/** Resolves a relative specifier to a file on disk, or null for a package. */
function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(fromFile), specifier)
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext
  }
  for (const ext of EXTENSIONS) {
    const indexFile = join(base, `index${ext}`)
    if (existsSync(indexFile)) return indexFile
  }
  return null
}

/**
 * `import … from '…'`, `export … from '…'`, and bare `import '…'`.
 *
 * `import type` is excluded deliberately: a type-only import is erased at
 * compile time and cannot produce a runtime cycle, so treating it as an edge
 * would report cycles that do not exist.
 */
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]/g

function buildGraph(files: string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const deps = new Set<string>()
    for (const match of source.matchAll(IMPORT_RE)) {
      const resolved = resolveImport(file, match[1])
      if (resolved) deps.add(resolved)
    }
    graph.set(file, [...deps])
  }
  return graph
}

/** Every cycle in the graph, each reported once regardless of entry point. */
function findCycles(graph: Map<string, string[]>): string[][] {
  const enum Mark {
    Unvisited,
    OnStack,
    Done,
  }
  const state = new Map<string, Mark>([...graph.keys()].map((f) => [f, Mark.Unvisited]))
  const stack: string[] = []
  const cycles: string[][] = []
  const seen = new Set<string>()

  const visit = (node: string): void => {
    state.set(node, Mark.OnStack)
    stack.push(node)
    for (const dep of graph.get(node) ?? []) {
      if (state.get(dep) === Mark.OnStack) {
        const cycle = [...stack.slice(stack.indexOf(dep)), dep]
        const key = [...cycle].sort().join('|')
        if (!seen.has(key)) {
          seen.add(key)
          cycles.push(cycle)
        }
      } else if (state.get(dep) === Mark.Unvisited) {
        visit(dep)
      }
    }
    stack.pop()
    state.set(node, Mark.Done)
  }

  for (const file of graph.keys()) {
    if (state.get(file) === Mark.Unvisited) visit(file)
  }
  return cycles
}

const asRelative = (file: string): string => relative(SRC, file).split(sep).join('/')

describe('module graph', () => {
  const files = sourceFiles(SRC)
  const graph = buildGraph(files)

  it('has no circular imports', () => {
    const cycles = findCycles(graph)
    const report = cycles.map((c) => c.map(asRelative).join('\n      -> ')).join('\n\n  CYCLE: ')
    expect(cycles.length, cycles.length ? `\n\n  CYCLE: ${report}\n` : '').toBe(0)
  })

  it('analysed a plausible number of files, so a broken walk cannot pass silently', () => {
    // Guards the check itself: if sourceFiles or the import regex ever stops
    // matching, the cycle test would pass on an empty graph and mean nothing.
    expect(files.length).toBeGreaterThan(100)
    const edges = [...graph.values()].reduce((n, deps) => n + deps.length, 0)
    expect(edges).toBeGreaterThan(200)
  })

  it('keeps the error log a leaf', () => {
    // Every subsystem imports the log, so the log importing one back would
    // close a cycle. Its only permitted dependencies are the database and the
    // shared source vocabulary — the latter is a dependency-free list of string
    // literals, not a feature, and exists precisely so that the source list is
    // not maintained in four places at once.
    const errorLog = join(SRC, 'main', 'errors', 'errorLog.ts')
    expect(files).toContain(errorLog)
    expect((graph.get(errorLog) ?? []).map(asRelative).sort()).toEqual([
      'main/db/database.ts',
      'shared/errors.ts',
    ])
  })
})
