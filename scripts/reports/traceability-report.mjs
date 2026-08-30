#!/usr/bin/env node
/**
 * Regenerates docs/test-traceability-reports/traceability.md and docs/test-traceability-reports/traceability.json from the
 * flow catalog (docs/test-traceability-reports/flows.json) plus the annotations carried by the tests
 * themselves.
 *
 * Both outputs are GENERATED — never hand-edit them. Edit flows.json or the annotations
 * and re-run.
 *
 *   node scripts/reports/traceability-report.mjs            (or: pnpm traceability:report)
 *   node scripts/reports/traceability-report.mjs --check    validate only, write nothing
 *   node scripts/reports/traceability-report.mjs --fix      rewrite alias spellings to canon
 *
 * THE GENERATOR IS THE VALIDATOR. Same rule session-metrics-report.mjs follows: an unknown key is
 * rejected rather than dropped, because a category that isn't a column would silently
 * vanish from the matrix and the doc would read as coverage we don't have.
 *
 * It reads SOURCE, not test results. No test run is needed to rebuild the dashboard, so
 * the CI check stays fast and a red suite never blanks the doc. The cost is that this
 * file contains three hand-rolled parsers instead of consuming three JSON reporters.
 *
 * Two parsing assumptions, both enforced rather than assumed:
 *  - Block structure is read from INDENTATION, not brace matching. Biome formats the
 *    whole repo at 2-space indent, so this is reliable here and it avoids a JS tokenizer.
 *  - Playwright annotation entries must be written as `{ type: '…', description: '…' }`.
 *    A malformed entry is an error, never a silent skip.
 *
 * On counting: the number reported per flow is TEST DECLARATIONS, not runtime cases. A
 * parametrize/`.each` argument is often a module-level name that cannot be counted without
 * executing the module, and Playwright multiplies by browser project. Publishing a
 * half-guessed case count would be worse than publishing an exact declaration count, so
 * parametrized declarations are counted once and reported separately.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const CATALOG = 'docs/test-traceability-reports/flows.json'
const BASELINE = 'docs/test-traceability-reports/untagged-baseline.json'
const OUT_MD = 'docs/test-traceability-reports/traceability.md'
const OUT_JSON = 'docs/test-traceability-reports/traceability.json'
const OUT_DETAIL_DIR = 'docs/test-traceability-reports/flows'

const argv = process.argv.slice(2)
const CHECK_ONLY = argv.includes('--check')
const FIX = argv.includes('--fix')
const RUN = argv.includes('--run')

const optionValues = (name) =>
  argv.flatMap((arg, index) => (arg === `--${name}` && argv[index + 1] ? [argv[index + 1]] : []))
const WANT_FLOWS = optionValues('flow')
const WANT_CATEGORIES = optionValues('category')

const SEVERITIES = ['P0', 'P1', 'P2', 'P3']
const IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  '.venv',
  '.git',
  'coverage',
  'dist',
  'test-results',
  'playwright-report',
  '__pycache__',
  'storybook-static',
])

/* ------------------------------------------------------------------ catalog */

const failCatalog = (why) => {
  throw new Error(`${CATALOG}: ${why}`)
}

const loadCatalog = () => {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'))
  const { categories, aliases, flows, severities } = catalog

  if (!Array.isArray(categories) || categories.length === 0) {
    failCatalog('`categories` must be a non-empty array')
  }
  const dupeCategory = categories.find((name, index) => categories.indexOf(name) !== index)
  if (dupeCategory) failCatalog(`duplicate category \`${dupeCategory}\``)

  for (const [alias, target] of Object.entries(aliases ?? {})) {
    if (categories.includes(alias)) {
      failCatalog(`\`${alias}\` is listed as both a canonical category and an alias`)
    }
    if (!categories.includes(target)) {
      failCatalog(`alias \`${alias}\` points at \`${target}\`, which is not a category`)
    }
  }

  if (!Array.isArray(flows) || flows.length === 0) failCatalog('`flows` must be a non-empty array')
  const seen = new Set()
  for (const flow of flows) {
    for (const field of ['id', 'title', 'severity', 'rationale']) {
      if (!flow[field]) failCatalog(`flow \`${flow.id ?? '?'}\` is missing \`${field}\``)
    }
    if (seen.has(flow.id)) failCatalog(`duplicate flow id \`${flow.id}\``)
    seen.add(flow.id)
    if (!SEVERITIES.includes(flow.severity)) {
      failCatalog(`flow \`${flow.id}\` has severity \`${flow.severity}\`, not one of ${SEVERITIES.join('/')}`)
    }
    if (severities && !severities[flow.severity]) {
      failCatalog(`flow \`${flow.id}\` uses severity \`${flow.severity}\`, which \`severities\` does not define`)
    }
  }
  return catalog
}

/* ------------------------------------------------------------------ file walk */

const walk = (dir, out = []) => {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (IGNORED_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const listDirs = (parent) => {
  try {
    return readdirSync(parent)
      .filter((name) => !IGNORED_DIRS.has(name))
      .map((name) => join(parent, name))
      .filter((full) => statSync(full).isDirectory())
  } catch {
    return []
  }
}

/**
 * Test files, by runner. Each list mirrors that runner's own testMatch, so helper modules
 * that live in a test directory but are not tests — reasoning_fakes.py, e2e/settle.ts —
 * are excluded exactly as the runner excludes them.
 */
const collectFiles = () => {
  const vitest = []
  const playwright = []
  const pytest = []

  for (const pkg of [...listDirs('apps'), ...listDirs('packages')]) {
    for (const file of walk(join(pkg, 'src'))) {
      if (/\.test\.tsx?$/.test(file)) vitest.push(file)
    }
    for (const file of walk(join(pkg, 'e2e'))) {
      if (/\.spec\.ts$/.test(file)) playwright.push(file)
    }
  }

  for (const group of ['python/libs', 'python/services']) {
    for (const pkg of listDirs(group)) {
      for (const file of walk(join(pkg, 'tests'))) {
        const base = file.split('/').pop()
        if (/^test_.*\.py$/.test(base) || /_test\.py$/.test(base)) pytest.push(file)
      }
    }
  }

  return { vitest, playwright, pytest }
}

/* ------------------------------------------------------------------ annotation parsing */

const TRACE_KEYS = new Set(['flow', 'category'])

/**
 * Parse `flow=… category=…` from either a Python kwarg list or a `@trace` comment. Any
 * other key is a hard error — this is what catches `flw=` and `catagory=`, which a
 * forgiving parser would drop on the floor and report as an untagged test.
 */
const parseTracePairs = (raw, context, errors) => {
  const found = {}
  const pattern = /(\w+)\s*=\s*(?:['"]([^'"]*)['"]|([\w.-]+))/g
  let match = pattern.exec(raw)
  let sawAny = false
  while (match !== null) {
    sawAny = true
    const [, key, quoted, bare] = match
    if (!TRACE_KEYS.has(key)) {
      errors.push({ ...context, message: `unknown annotation key \`${key}\` (expected flow or category)` })
    } else {
      found[key] = quoted ?? bare
    }
    match = pattern.exec(raw)
  }
  if (!sawAny) {
    errors.push({ ...context, message: 'annotation has no `flow=` or `category=` pair' })
  }
  return found
}

const indentOf = (line) => line.length - line.trimStart().length

/**
 * Merge an annotation onto an inherited one, remembering WHICH LINE each key came from.
 *
 * Without this, --fix targets the test's line rather than the line the annotation is
 * actually written on, so a describe-level `category=accessibility` reports three errors
 * and repairs none of them. Found by the verification pass, not by review.
 */
const mergeTrace = (base, next, line) => {
  const merged = { ...base }
  for (const [key, value] of Object.entries(next ?? {})) {
    merged[key] = value
    merged[`${key}Line`] = line
  }
  return merged
}

/**
 * Join a logical statement that spans physical lines, so a multi-line decorator parses as
 * one unit. Stops when parens balance.
 */
const logicalLine = (lines, start) => {
  let text = lines[start]
  let depth = 0
  let index = start
  const balanced = (str) => {
    for (const char of str) {
      if (char === '(' || char === '[' || char === '{') depth += 1
      if (char === ')' || char === ']' || char === '}') depth -= 1
    }
    return depth <= 0
  }
  while (!balanced(lines[index]) && index + 1 < lines.length) {
    index += 1
    text += `\n${lines[index]}`
  }
  return { text, end: index }
}

/**
 * The HEADER of a describe/it/test call — everything up to the callback's `=>`, and no
 * further.
 *
 * This must not use logicalLine(). A `describe(...)` call's parens do not balance until
 * the end of its block, so balancing would swallow the entire body and every nested test
 * inside it would never be visited. Learned the hard way: the first run of this script
 * collected 585 of ~1,050 declarations for exactly that reason.
 */
const headerText = (lines, start, limit = 12) => {
  let text = lines[start]
  for (let index = start; index < Math.min(start + limit, lines.length); index += 1) {
    if (index > start) text += `\n${lines[index]}`
    if (/=>|\bfunction\b/.test(lines[index])) break
  }
  return text
}

/* ------------------------------------------------------------------ python parser */

const parsePython = (file, text, errors) => {
  const lines = text.split('\n')
  const entries = []
  let moduleTrace = {}
  let classTrace = null
  let classIndent = -1
  let pending = null
  let pendingParametrize = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    if (/^pytestmark\s*=/.test(trimmed) && trimmed.includes('pytest.mark.trace')) {
      const { text: full, end } = logicalLine(lines, index)
      const inner = full.slice(full.indexOf('pytest.mark.trace(') + 'pytest.mark.trace('.length)
      moduleTrace = mergeTrace(
        {},
        parseTracePairs(inner, { file, line: index + 1 }, errors),
        index + 1,
      )
      index = end
      continue
    }

    if (/^@pytest\.mark\.parametrize\b/.test(trimmed)) {
      pendingParametrize = true
      const { end } = logicalLine(lines, index)
      index = end
      continue
    }

    if (/^@pytest\.mark\.trace\b/.test(trimmed)) {
      const { text: full, end } = logicalLine(lines, index)
      const open = full.indexOf('(')
      if (open === -1) {
        errors.push({ file, line: index + 1, message: '`@pytest.mark.trace` used without arguments' })
      } else {
        pending = mergeTrace(
          pending ?? {},
          parseTracePairs(full.slice(open + 1), { file, line: index + 1 }, errors),
          index + 1,
        )
      }
      index = end
      continue
    }

    const classMatch = line.match(/^(\s*)class\s+(\w+)/)
    if (classMatch) {
      classIndent = classMatch[1].length
      classTrace = pending
      pending = null
      pendingParametrize = false
      continue
    }

    const defMatch = line.match(/^(\s*)(?:async\s+)?def\s+(test_\w+)/)
    if (defMatch) {
      const [, indent, name] = defMatch
      if (classTrace !== null && indent.length <= classIndent) {
        classTrace = null
        classIndent = -1
      }
      const trace = { ...moduleTrace, ...(classTrace ?? {}), ...(pending ?? {}) }
      entries.push({
        file,
        line: index + 1,
        name,
        runner: 'pytest',
        flow: trace.flow,
        category: trace.category,
        flowLine: trace.flowLine,
        categoryLine: trace.categoryLine,
        parametrized: pendingParametrize,
      })
      pending = null
      pendingParametrize = false
      continue
    }

    // A decorator that isn't ours, or a plain statement, still terminates a pending
    // parametrize/trace pair only when it's another def-level construct; anything else
    // (imports, constants) resets nothing.
    if (/^@/.test(trimmed)) continue
  }

  return entries
}

/* ------------------------------------------------------------------ typescript parsers */

const stringAfter = (text, from) => {
  const match = text.slice(from).match(/['"`]((?:[^'"`\\]|\\.)*)['"`]/)
  return match ? match[1] : '(unnamed)'
}

const declarationName = (full) => {
  const eachAt = full.indexOf('.each')
  if (eachAt !== -1) {
    const close = full.indexOf(')(', eachAt)
    if (close !== -1) return stringAfter(full, close + 1)
  }
  return stringAfter(full, full.indexOf('('))
}

/**
 * Vitest. No native tag slot exists that stays out of reporter output (TestOptions has no
 * custom key and `annotate()` is surfaced), so the annotation is a comment bound to the
 * next declaration. A comment that binds to nothing is an error, not a silent skip.
 */
const parseVitest = (file, text, errors) => {
  const lines = text.split('\n')
  const entries = []
  const stack = []
  let pending = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()

    const comment = trimmed.match(/^(?:\/\/|\*|\/\*)\s*@trace\s+(.*?)\s*(?:\*\/)?$/)
    if (comment) {
      pending = {
        trace: parseTracePairs(comment[1], { file, line: index + 1 }, errors),
        line: index + 1,
      }
      continue
    }

    const decl = line.match(/^(\s*)(describe|it|test)(\.\w+)*\s*\(/)
    if (!decl) continue
    const [, indentText, keyword] = decl
    const indent = indentText.length
    const full = headerText(lines, index)

    if (/\.todo\b/.test(line.slice(0, line.indexOf('(')))) {
      pending = null
      continue
    }

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
    const inherited = stack.length > 0 ? stack[stack.length - 1].trace : {}
    const trace = mergeTrace(inherited, pending?.trace, pending?.line)

    if (keyword === 'describe') {
      stack.push({ indent, trace })
    } else {
      entries.push({
        file,
        line: index + 1,
        name: declarationName(full),
        runner: 'vitest',
        flow: trace.flow,
        category: trace.category,
        flowLine: trace.flowLine,
        categoryLine: trace.categoryLine,
        parametrized: line.includes('.each'),
      })
    }
    pending = null
  }

  if (pending) {
    errors.push({
      file,
      line: pending.line,
      message: '`@trace` comment binds to no test or describe below it',
    })
  }
  return entries
}

/**
 * Playwright. Uses the native `annotation:` field of TestDetails rather than `tag:`,
 * because the terminal reporters append tags to every result line (formatTestTitle) while
 * annotations are serialized only by the JUnit/JSON/HTML reporters.
 */
const parsePlaywright = (file, text, errors) => {
  const lines = text.split('\n')
  const entries = []
  const stack = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const decl = line.match(/^(\s*)test(\.\w+)*\s*\(/)
    if (!decl) continue
    const indent = decl[1].length
    const isDescribe = /^\s*test\.describe\b/.test(line)
    const full = headerText(lines, index)

    if (/^\s*test\.(todo|slow|setTimeout|use|beforeEach|afterEach|beforeAll|afterAll|step)\b/.test(line)) {
      continue
    }

    const trace = {}
    if (full.includes('annotation:')) {
      const pattern = /\{\s*type:\s*['"](\w+)['"]\s*,\s*description:\s*['"]([^'"]*)['"]\s*\}/g
      let match = pattern.exec(full)
      let sawAny = false
      while (match !== null) {
        sawAny = true
        const [, type, description] = match
        if (!TRACE_KEYS.has(type)) {
          errors.push({
            file,
            line: index + 1,
            message: `unknown annotation type \`${type}\` (expected flow or category)`,
          })
        } else {
          trace[type] = description
        }
        match = pattern.exec(full)
      }
      if (!sawAny) {
        errors.push({
          file,
          line: index + 1,
          message: 'annotation entries must be written as `{ type: …, description: … }`',
        })
      }
    }

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
    const inherited = stack.length > 0 ? stack[stack.length - 1].trace : {}
    const merged = mergeTrace(inherited, trace, index + 1)

    if (isDescribe) {
      stack.push({ indent, trace: merged })
    } else {
      entries.push({
        file,
        line: index + 1,
        name: declarationName(full),
        runner: 'playwright',
        flow: merged.flow,
        category: merged.category,
        flowLine: merged.flowLine,
        categoryLine: merged.categoryLine,
        parametrized: false,
      })
    }
  }
  return entries
}

/* ------------------------------------------------------------------ validation */

const validateEntries = (entries, catalog, errors) => {
  const flowIds = new Set(catalog.flows.map((flow) => flow.id))
  const categories = new Set(catalog.categories)
  const aliases = catalog.aliases ?? {}
  const surfacesFor = new Map(catalog.flows.map((flow) => [flow.id, flow.surfaces ?? []]))
  // A flow's `surfaces` drives the per-flow page, the `^apps/` a11y expectation, and the
  // "flows on this surface" hint an author sees when a test is untagged. Nothing used to
  // check it against reality, so tagging a flow onto a new directory silently rotted all
  // three — 13 such pairs had accumulated before this check existed. Reported once per
  // flow+directory rather than once per test, because the fix is one catalog line.
  const driftSeen = new Set()
  const tagged = []
  const untagged = []

  for (const entry of entries) {
    const { flow, category, file, line, name } = entry
    if (!flow && !category) {
      untagged.push(entry)
      continue
    }
    let ok = true
    // Report at the line the ANNOTATION is written on, not the test that inherited it —
    // that is both where a human goes to fix it and where --fix must edit.
    if (flow && !flowIds.has(flow)) {
      errors.push({
        file,
        line: entry.flowLine ?? line,
        message: `unknown flow \`${flow}\` — not in ${CATALOG}`,
      })
      ok = false
    }
    if (category && !categories.has(category)) {
      const canonical = aliases[category]
      errors.push({
        file,
        line: entry.categoryLine ?? line,
        message: canonical
          ? `category \`${category}\` is not canonical — use \`${canonical}\` (\`--fix\` rewrites it)`
          : `unknown category \`${category}\` — not in ${CATALOG}`,
        alias: canonical ? { from: category, to: canonical } : undefined,
      })
      ok = false
    }
    if (flow && !category) {
      errors.push({ file, line, message: `\`${name}\` has a flow but no category` })
      ok = false
    }
    if (category && !flow) {
      errors.push({ file, line, message: `\`${name}\` has a category but no flow` })
      ok = false
    }
    if (flow && flowIds.has(flow)) {
      const surfaces = surfacesFor.get(flow) ?? []
      // `surface + '/'`, not a bare prefix: `packages/schemas` must not swallow a file in
      // `packages/schemas-extra`. No two surfaces are prefix-related today, so this is about
      // the next package added rather than a live bug.
      if (!surfaces.some((surface) => file.startsWith(`${surface}/`))) {
        // Surfaces in the catalog are workspace roots: `apps/x`, `packages/x`, and — because
        // the Python workspace nests by role — `python/libs/x`, `python/services/x`. Quote the
        // suggestion at that depth so it can be pasted into `surfaces` verbatim.
        const depth = file.startsWith('python/') ? 3 : 2
        const directory = file.split('/').slice(0, depth).join('/')
        const key = `${flow} ${directory}`
        if (!driftSeen.has(key)) {
          driftSeen.add(key)
          errors.push({
            file,
            line: entry.flowLine ?? line,
            message:
              `\`${flow}\` is tagged on \`${directory}\`, which it does not declare as a surface ` +
              `(${surfaces.join(', ') || 'none'}). Add the directory to \`surfaces\` in ${CATALOG}, ` +
              `or re-tag to the flow this test actually serves.`,
          })
        }
        ok = false
      }
    }
    if (ok) tagged.push(entry)
  }
  return { tagged, untagged }
}

/**
 * --fix rewrites only alias spellings, and only on the exact line the error came from.
 * It deliberately does not invent a flow or a category for an untagged test — that is a
 * judgement call, not a mechanical one.
 */
const applyFixes = (errors) => {
  const byFile = new Map()
  for (const error of errors) {
    if (!error.alias) continue
    if (!byFile.has(error.file)) byFile.set(error.file, [])
    byFile.get(error.file).push(error)
  }
  let fixed = 0
  for (const [file, fileErrors] of byFile) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (const error of fileErrors) {
      const index = error.line - 1
      const { from, to } = error.alias
      const replaced = lines[index].replace(
        new RegExp(`(['"]?)${from}\\1(?![\\w-])`),
        (whole, quote) => `${quote}${to}${quote}`,
      )
      if (replaced !== lines[index]) {
        lines[index] = replaced
        fixed += 1
      }
    }
    writeFileSync(file, lines.join('\n'))
  }
  return fixed
}

/* ------------------------------------------------------------------ aggregation */

// python/services/agent, not python/services — the worklist has to distinguish the
// package being deferred from the ones already done.
const packageOf = (file) => {
  const parts = file.split('/')
  return parts[0] === 'python' ? parts.slice(0, 3).join('/') : parts.slice(0, 2).join('/')
}

const aggregate = (tagged, untagged, catalog) => {
  const byFlow = new Map(catalog.flows.map((flow) => [flow.id, []]))
  for (const entry of tagged) byFlow.get(entry.flow).push(entry)

  const rows = catalog.flows
    .map((flow) => {
      const tests = byFlow.get(flow.id)
      const counts = Object.fromEntries(catalog.categories.map((name) => [name, 0]))
      for (const test of tests) counts[test.category] += 1
      return {
        ...flow,
        area: flow.id.split('.')[0],
        counts,
        tests,
        total: tests.length,
        parametrized: tests.filter((test) => test.parametrized).length,
        runners: {
          pytest: tests.filter((test) => test.runner === 'pytest').length,
          vitest: tests.filter((test) => test.runner === 'vitest').length,
          playwright: tests.filter((test) => test.runner === 'playwright').length,
        },
      }
    })
    .sort((left, right) =>
      left.severity === right.severity
        ? left.id.localeCompare(right.id)
        : SEVERITIES.indexOf(left.severity) - SEVERITIES.indexOf(right.severity),
    )

  // Group by the flow id's prefix — `readiness.assessment` and `readiness.record-update`
  // belong next to each other when you are investigating an area. Severity still orders
  // rows WITHIN an area, and "where am I exposed" is answered by Gaps, which leads with it.
  const sumCounts = (list) => {
    const counts = Object.fromEntries(catalog.categories.map((name) => [name, 0]))
    for (const row of list) {
      for (const name of catalog.categories) counts[name] += row.counts[name]
    }
    return counts
  }

  const areas = [...new Set(rows.map((row) => row.area))].sort().map((area) => {
    const members = rows.filter((row) => row.area === area)
    return {
      area,
      rows: members,
      counts: sumCounts(members),
      total: members.reduce((sum, row) => sum + row.total, 0),
    }
  })

  const grandTotal = {
    counts: sumCounts(rows),
    total: rows.reduce((sum, row) => sum + row.total, 0),
  }

  const untaggedByPackage = new Map()
  for (const entry of untagged) {
    const key = packageOf(entry.file)
    untaggedByPackage.set(key, (untaggedByPackage.get(key) ?? 0) + 1)
  }

  // Expected categories are declared in the catalog rather than hard-coded here, so
  // "a P0 flow must carry a safety test" is an editable claim about this project and not
  // a rule buried in a generator.
  const expect = catalog.expect ?? {}
  const expectedFor = (row) => {
    const wanted = new Set(expect.bySeverity?.[row.severity] ?? [])
    for (const rule of expect.whenSurfaceMatches ?? []) {
      const pattern = new RegExp(rule.pattern)
      if ((row.surfaces ?? []).some((surface) => pattern.test(surface))) {
        for (const category of rule.categories) wanted.add(category)
      }
    }
    return [...wanted]
  }

  const missingExpected = rows
    .filter((row) => row.total > 0)
    .map((row) => ({
      id: row.id,
      severity: row.severity,
      missing: expectedFor(row).filter((category) => row.counts[category] === 0),
    }))
    .filter((row) => row.missing.length > 0)

  return {
    rows,
    areas,
    grandTotal,
    gaps: {
      uncovered: rows.filter((row) => row.total === 0).map((row) => row.id),
      missingExpected,
    },
    untaggedByPackage: [...untaggedByPackage.entries()].sort((left, right) => right[1] - left[1]),
  }
}

/* ------------------------------------------------------------------ emit */

const SHORT = { functionality: 'func', performance: 'perf', security: 'sec', privacy: 'priv' }

const RUNNER_LABEL = { pytest: 'pytest', vitest: 'Vitest', playwright: 'Playwright' }

/**
 * One page per flow: every covering test by name, file and line, grouped by runner.
 *
 * This is the drill-down the summary table can't give. "8 a11y tests on
 * readiness.assessment" tells you coverage exists; only the names tell you *what* was
 * covered — before assessment, with a verdict rendered, every section expanded — which is
 * what you need when a real a11y defect comes in against that flow.
 */
const renderFlowDetail = (row, catalog) => {
  const byRunner = ['pytest', 'vitest', 'playwright']
    .map((runner) => ({ runner, tests: row.tests.filter((test) => test.runner === runner) }))
    .filter((group) => group.tests.length > 0)

  const sections = byRunner
    .map(({ runner, tests }) => {
      const lines = tests
        .slice()
        .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)
        .map((test) => `| ${test.category} | ${test.name} | \`${test.file}:${test.line}\` |`)
        .join('\n')
      // h2, not h3 — the page's only h1 is the title, and markdownlint (MD001) rejects a
      // level skip.
      return `## ${RUNNER_LABEL[runner]} — ${tests.length}\n\n| Category | Test | Location |\n| --- | --- | --- |\n${lines}`
    })
    .join('\n\n')

  const present = catalog.categories.filter((name) => row.counts[name] > 0)
  const absent = catalog.categories.filter((name) => row.counts[name] === 0)

  return `# ${row.id}

<!-- GENERATED by scripts/reports/traceability-report.mjs — do not edit by hand.
     Edit docs/test-traceability-reports/flows.json and the annotations in the tests, then re-run
     \`pnpm traceability:report\`. -->

${row.title}

← back to [the traceability summary](../traceability.md)

| | |
| --- | --- |
| **Severity** | ${row.severity} |
| **Why** | ${row.rationale} |
| **Surfaces** | ${(row.surfaces ?? []).map((surface) => `\`${surface}\``).join(' · ') || '—'} |
| **Tests** | ${row.total}${row.parametrized ? ` (${row.parametrized} parametrized)` : ''} |
| **Covered** | ${present.map((name) => `${name} ${row.counts[name]}`).join(' · ') || 'nothing yet'} |
| **Not covered** | ${absent.join(' · ') || '—'} |

${row.total === 0 ? 'No test currently claims this flow.' : sections}

---

Counts are test **declarations**: a parametrized test appears once, and a Playwright test
once rather than once per browser project. A category is the annotating author's
judgement — for a test that inherits it from its suite, the claim is about the suite.
`
}

const renderMarkdown = (summary, catalog, totals) => {
  const { rows, gaps, untaggedByPackage } = summary
  const header = ['Flow', 'Sev', ...catalog.categories.map((name) => SHORT[name] ?? name), 'Tests']
  const cell = (value) => (value === 0 ? '–' : String(value))

  // A flow row links to its detail page; an area row is a subtotal and links nowhere.
  const flowLine = (row) => {
    const counts = catalog.categories.map((name) => cell(row.counts[name]))
    const total = row.total === 0 ? '**none**' : String(row.total)
    const label = row.total === 0 ? `\`${row.id}\`` : `[\`${row.id}\`](flows/${row.id}.md)`
    return `| ${label} | ${row.severity} | ${counts.join(' | ')} | ${total} |`
  }
  const subtotalLine = (area) => {
    const counts = catalog.categories.map((name) => cell(area.counts[name]))
    return `| **${area.area}** | | ${counts.join(' | ')} | **${area.total}** |`
  }

  const body = [
    ...summary.areas.flatMap((area) => [...area.rows.map(flowLine), subtotalLine(area)]),
    `| **all flows** | | ${catalog.categories.map((name) => `**${cell(summary.grandTotal.counts[name])}**`).join(' | ')} | **${summary.grandTotal.total}** |`,
  ].join('\n')

  const gapLines = []
  if (gaps.uncovered.length) {
    gapLines.push(
      `- **${gaps.uncovered.length} flow(s) with no covering test:** ${gaps.uncovered.map((id) => `\`${id}\``).join(', ')}`,
    )
  }
  for (const row of gaps.missingExpected) {
    gapLines.push(
      `- **\`${row.id}\`** (${row.severity}) has tests but none categorised ${row.missing.map((name) => `\`${name}\``).join(' or ')}.`,
    )
  }
  if (gapLines.length === 0) {
    gapLines.push('- None. Every flow has a covering test and carries the categories its severity expects.')
  }

  const untaggedLines = untaggedByPackage.length
    ? untaggedByPackage.map(([pkg, count]) => `| \`${pkg}\` | ${count} |`).join('\n')
    : '| — | 0 |'

  return `# Test traceability

<!-- GENERATED by scripts/reports/traceability-report.mjs — do not edit by hand.
     Edit docs/test-traceability-reports/flows.json and the annotations in the tests, then re-run
     \`pnpm traceability:report\`. -->

What each application flow is verified by, and in what respect. Design and rationale:
[README.md](README.md). Severity answers *"how bad is a red test here"* — \`P0\` means a
failure can fabricate an attribution or citation, not that a demo breaks.

Counts are **test declarations**, not runtime cases: a parametrized declaration is counted
once, and Playwright's browser-project multiplication is not applied.

## Coverage by flow

Flows are grouped by area, with a subtotal per area and a grand total. **Follow a flow's
link** for every covering test by name, file and line — the summary tells you coverage
exists, the detail tells you what it covers.

| ${header.join(' | ')} |
| ${header.map(() => '---').join(' | ')} |
${body}

## Gaps

${gapLines.join('\n')}

## Untagged

Tests carrying no annotation yet. They are absent from the matrix above — this is the
backfill worklist, not a failure.

| Package | Untagged tests |
| --- | --- |
${untaggedLines}

## What this does not tell you

A tag records that a test is *about* a flow. It does not claim the flow is adequately
covered, and a high count is not evidence of depth — twenty shallow render assertions and
twenty boundary-value tests look identical in this table. Read a row as *"here is where to
look"*, never as *"this is safe"*.

Three specific limits:

- **Counts are declarations.** A parametrized test counts once no matter how many cases it
  expands to, and a Playwright row counts once rather than once per browser project.
- **The category is the author's judgement.** Nothing verifies that a test tagged \`safety\`
  actually asserts anything safety-relevant.
- **Untagged is not uncovered.** The untagged tests below are real tests that run in CI;
  they are simply not yet placed on this map.

## Coverage by runner

| Runner | Tagged | Untagged | Total |
| --- | --- | --- | --- |
| pytest | ${totals.tagged.pytest} | ${totals.untagged.pytest} | ${totals.all.pytest} |
| Vitest | ${totals.tagged.vitest} | ${totals.untagged.vitest} | ${totals.all.vitest} |
| Playwright | ${totals.tagged.playwright} | ${totals.untagged.playwright} | ${totals.all.playwright} |
| **All** | **${totals.tagged.all}** | **${totals.untagged.all}** | **${totals.all.all}** |
`
}

/* ------------------------------------------------------------------ main */

const catalog = loadCatalog()
const files = collectFiles()
const errors = []
const entries = [
  ...files.pytest.flatMap((file) => parsePython(file, readFileSync(file, 'utf8'), errors)),
  ...files.vitest.flatMap((file) => parseVitest(file, readFileSync(file, 'utf8'), errors)),
  ...files.playwright.flatMap((file) => parsePlaywright(file, readFileSync(file, 'utf8'), errors)),
]

const { tagged, untagged } = validateEntries(entries, catalog, errors)

/* ------------------------------------------------------------------ untagged ratchet */

/**
 * Untagged tests are reported, not failed — that is what let adoption be incremental. But
 * "reported" means a future session can add an untagged test and nothing objects, which is
 * precisely how the previous generation of these maps rotted.
 *
 * So: a per-package ceiling that can only come down. Existing debt stays legal at its
 * recorded count; one more untagged test in that package fails. Raising a number is a
 * deliberate line in a diff, and --fix lowers them as tests get tagged.
 *
 * Note that a new test added to an ALREADY-tagged describe or module inherits its tags and
 * never lands here. This fires on genuinely new files and new top-level blocks — exactly
 * when someone should be deciding which flow the thing serves.
 */
const countByPackage = (list) => {
  const counts = new Map()
  for (const entry of list) {
    const key = packageOf(entry.file)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** Flows whose declared surfaces contain this file — a hint for the author, never applied. */
const suggestFlows = (file) =>
  catalog.flows
    .filter((flow) => (flow.surfaces ?? []).some((surface) => file.startsWith(`${surface}/`)))
    .map((flow) => flow.id)

const checkRatchet = () => {
  let baseline = { packages: {} }
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  } catch {
    return { violations: [], slack: [] }
  }
  const allowed = baseline.packages ?? {}
  const actual = countByPackage(untagged)
  const violations = []
  const slack = []

  for (const [pkg, count] of actual) {
    const ceiling = allowed[pkg] ?? 0
    if (count > ceiling) violations.push({ pkg, count, ceiling })
  }
  for (const [pkg, ceiling] of Object.entries(allowed)) {
    const count = actual.get(pkg) ?? 0
    if (count < ceiling) slack.push({ pkg, count, ceiling })
  }
  return { violations, slack, baseline, actual }
}

const ratchet = checkRatchet()

for (const { pkg, count, ceiling } of ratchet.violations) {
  const offenders = untagged
    .filter((entry) => packageOf(entry.file) === pkg)
    .map((entry) => entry.file)
  const files = [...new Set(offenders)].sort()
  const hint = suggestFlows(files[0] ?? '')
  errors.push({
    file: files[0] ?? pkg,
    line: 1,
    message:
      `${pkg} has ${count} untagged test(s), above its allowed ${ceiling}. ` +
      `Add a \`@trace\` annotation${hint.length ? ` (flows on this surface: ${hint.join(', ')})` : ''}, ` +
      `or raise the number in ${BASELINE} deliberately.`,
  })
}

/* ------------------------------------------------------------------ --run */

/**
 * Run only the tests protecting a flow. pytest does its own selection natively (see
 * python/conftest.py); Vitest and Playwright cannot filter on a source comment, so the
 * parser resolves the matching FILES and hands them to each runner as path filters.
 *
 * File granularity, not test granularity: a describe-level tag already means the whole
 * block is about that flow, and passing paths is far more robust than reconstructing
 * -t name patterns from parsed titles.
 */
const packageNameOf = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
  } catch {
    return null
  }
}

const runSelection = () => {
  const flows = new Set(WANT_FLOWS)
  const categories = new Set(WANT_CATEGORIES)
  if (flows.size === 0 && categories.size === 0) {
    console.error('traceability: --run needs at least one --flow or --category')
    process.exit(2)
  }
  const validFlows = new Set(catalog.flows.map((flow) => flow.id))
  for (const flow of flows) {
    if (!validFlows.has(flow)) {
      console.error(`traceability: unknown flow \`${flow}\``)
      process.exit(2)
    }
  }
  for (const category of categories) {
    if (!catalog.categories.includes(category)) {
      const canonical = (catalog.aliases ?? {})[category]
      console.error(
        `traceability: unknown category \`${category}\`${canonical ? ` — did you mean \`${canonical}\`?` : ''}`,
      )
      process.exit(2)
    }
  }

  const matches = tagged.filter(
    (entry) =>
      (flows.size === 0 || flows.has(entry.flow)) &&
      (categories.size === 0 || categories.has(entry.category)),
  )

  const commands = []
  for (const runner of ['vitest', 'playwright']) {
    const byPackage = new Map()
    for (const entry of matches.filter((item) => item.runner === runner)) {
      const parts = entry.file.split('/')
      const dir = parts.slice(0, 2).join('/')
      if (!byPackage.has(dir)) byPackage.set(dir, new Set())
      byPackage.get(dir).add(relative(dir, entry.file))
    }
    for (const [dir, paths] of byPackage) {
      const name = packageNameOf(dir)
      if (!name) continue
      commands.push([
        'pnpm',
        ['--filter', name, runner === 'vitest' ? 'test' : 'e2e', ...[...paths].sort()],
      ])
    }
  }
  if (matches.some((entry) => entry.runner === 'pytest')) {
    commands.push([
      'uv',
      [
        'run',
        '--directory',
        'python',
        'pytest',
        ...WANT_FLOWS.flatMap((flow) => ['--flow', flow]),
        ...WANT_CATEGORIES.flatMap((category) => ['--category', category]),
      ],
    ])
  }

  if (commands.length === 0) {
    console.log('traceability: no tagged tests match that selection.')
    process.exit(0)
  }

  console.log(`traceability: ${matches.length} matching test(s) across ${commands.length} command(s)\n`)
  for (const [bin, args] of commands) {
    console.log(`  → ${bin} ${args.join(' ')}`)
  }
  console.log('')
  for (const [bin, args] of commands) {
    const result = spawnSync(bin, args, { stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
  process.exit(0)
}

if (FIX) {
  const fixed = errors.some((error) => error.alias) ? applyFixes(errors) : 0
  if (fixed > 0) {
    console.log(`traceability: rewrote ${fixed} non-canonical categor${fixed === 1 ? 'y' : 'ies'}.`)
  }
  // Lowering a ceiling is always safe and always correct — the only mechanical half of the
  // ratchet. Raising one stays a deliberate hand edit.
  if (ratchet.slack?.length) {
    const next = { ...ratchet.baseline, packages: { ...ratchet.baseline.packages } }
    for (const { pkg, count } of ratchet.slack) {
      if (count === 0) delete next.packages[pkg]
      else next.packages[pkg] = count
      console.log(`traceability: tightened ${pkg} to ${count} untagged.`)
    }
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
  }
  if (fixed === 0 && !ratchet.slack?.length) console.log('traceability: nothing to fix.')
  console.log('traceability: re-run without --fix to verify.')
  process.exit(0)
}

// One annotation inherited by ten tests is one authoring mistake, not ten. Dedupe on
// (file, line, message) so the report is a fix list rather than a wall.
const unique = [...new Map(errors.map((error) => [`${error.file}:${error.line}:${error.message}`, error])).values()]

if (unique.length > 0) {
  console.error(`\ntraceability: ${unique.length} problem(s) found.\n`)
  for (const error of unique.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)) {
    console.error(`  ${error.file}:${error.line}  ${error.message}`)
  }
  if (errors.some((error) => error.alias)) {
    console.error('\n  Run `pnpm traceability:check --fix` to rewrite non-canonical categories.')
  }
  console.error('')
  process.exit(1)
}

if (RUN) runSelection()

const count = (list, runner) => list.filter((entry) => entry.runner === runner).length
const totals = {
  tagged: {
    pytest: count(tagged, 'pytest'),
    vitest: count(tagged, 'vitest'),
    playwright: count(tagged, 'playwright'),
    all: tagged.length,
  },
  untagged: {
    pytest: count(untagged, 'pytest'),
    vitest: count(untagged, 'vitest'),
    playwright: count(untagged, 'playwright'),
    all: untagged.length,
  },
  all: {
    pytest: count(entries, 'pytest'),
    vitest: count(entries, 'vitest'),
    playwright: count(entries, 'playwright'),
    all: entries.length,
  },
}

if (CHECK_ONLY) {
  console.log(
    `traceability: ok — ${totals.tagged.all} tagged, ${totals.untagged.all} untagged, ${catalog.flows.length} flows.`,
  )
  process.exit(0)
}

const summary = aggregate(tagged, untagged, catalog)

mkdirSync('docs/test-traceability-reports', { recursive: true })
mkdirSync(OUT_DETAIL_DIR, { recursive: true })

// Detail pages are rewritten wholesale each run. A flow deleted from the catalog would
// otherwise leave an orphan page behind, still linked from nowhere and quietly wrong.
for (const stale of readdirSync(OUT_DETAIL_DIR).filter((name) => name.endsWith('.md'))) {
  if (!catalog.flows.some((flow) => `${flow.id}.md` === stale)) {
    rmSync(join(OUT_DETAIL_DIR, stale))
  }
}
for (const row of summary.rows) {
  writeFileSync(join(OUT_DETAIL_DIR, `${row.id}.md`), renderFlowDetail(row, catalog))
}

writeFileSync(OUT_MD, renderMarkdown(summary, catalog, totals))
writeFileSync(
  OUT_JSON,
  `${JSON.stringify(
    {
      generated_by: 'scripts/reports/traceability-report.mjs',
      totals,
      by_flow: Object.fromEntries(
        summary.rows.map((row) => [
          row.id,
          {
            severity: row.severity,
            title: row.title,
            counts: row.counts,
            runners: row.runners,
            total: row.total,
            parametrized: row.parametrized,
          },
        ]),
      ),
      by_test: tagged
        .map((entry) => ({
          id: `${entry.file}:${entry.line}`,
          name: entry.name,
          runner: entry.runner,
          flow: entry.flow,
          category: entry.category,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      gaps: summary.gaps,
      untagged: Object.fromEntries(summary.untaggedByPackage),
    },
    null,
    2,
  )}\n`,
)

console.log(`traceability: wrote ${OUT_MD} and ${OUT_JSON}`)
console.log(
  `  ${totals.tagged.all} tagged · ${totals.untagged.all} untagged · ${summary.gaps.uncovered.length} flow(s) with no test`,
)
