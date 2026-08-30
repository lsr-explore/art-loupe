#!/usr/bin/env node
/**
 * Regenerates report.md, sessions.md and the SVG charts under charts/ — all inside
 * docs/session-metrics-reports/ — from docs/session-metrics-reports/sessions/*.json.
 *
 * All outputs are GENERATED — never hand-edit them. Edit the session records and re-run.
 * Invoked by the /wrap skill at the end of every session.
 *
 *   node scripts/reports/session-metrics-report.mjs      (or: pnpm session-metrics:report)
 *
 * Charts are SVG rather than mermaid because xychart-beta supports neither stacked bars
 * nor dot plots. Each chart is ONE file carrying both themes in an internal <style> block:
 * light on :root, dark under `prefers-color-scheme: dark`. That beats a light/dark pair
 * behind <picture> — VS Code's markdown preview doesn't support <picture>, and an opaque
 * surface rect means the chart never depends on the background it lands on. A renderer
 * that ignores the media query falls back to light, which is still readable.
 *
 * Two constraints worth not undoing:
 *  - NO dual y-axis. Two independent scales on one plot let the author manufacture any
 *    apparent correlation by choosing where each axis starts. Related measures get
 *    stacked panels sharing an x-axis instead.
 *  - The theme dot plot's six colors do NOT clear the all-pairs CVD gate (orange↔green
 *    ΔE 3.2 protan). Acceptable only because the y-axis label carries identity and the
 *    color is redundant. If it ever becomes a scatter, six colors must go.
 *
 * Palette: dataviz reference categorical slots, validated both modes — worst adjacent
 * CVD ΔE 9.1 light / 8.4 dark across the five effort buckets.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'docs/session-metrics-reports/sessions'
const CHARTS = 'docs/session-metrics-reports/charts'

const EFFORT_KEYS = ['build', 'setup', 'design', 'docs', 'verify_ops', 'churn']
const EFFORT_LABEL = {
  build: 'Build',
  setup: 'Setup',
  design: 'Design',
  docs: 'Docs',
  verify_ops: 'Verify/Ops',
  churn: 'Churn',
}
const THEMES = ['agent', 'app', 'evals', 'data', 'ops', 'devex']
const RATING_KEYS = ['scoping_clarity', 'decision_stability', 'tooling_leverage']
const RATING_LABEL = {
  scoping_clarity: 'Scoping clarity',
  decision_stability: 'Decision stability',
  tooling_leverage: 'Tooling leverage',
}

const THEME_CSS = `
  :root {
    --bg: #fcfcfb; --ink: #0b0b0b; --muted: #52514e; --grid: #e0e0dd;
    --s1: #2a78d6; --s2: #008300; --s3: #e87ba4; --s4: #eda100; --s5: #1baf7a;
    --s6: #eb6834;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1a1a19; --ink: #f5f5f2; --muted: #a8a79d; --grid: #33322f;
      --s1: #3987e5; --s2: #008300; --s3: #d55181; --s4: #c98500; --s5: #199e70;
      --s6: #d95926;
    }
  }
  .surface { fill: var(--bg); }
  .grid { stroke: var(--grid); stroke-width: 1; }
  .title { fill: var(--ink); font-size: 13px; font-weight: 600; }
  .panel { fill: var(--ink); font-size: 11px; font-weight: 600; }
  .sub, .tick { fill: var(--muted); }
  .sub { font-size: 11px; }
  .tick { font-size: 10px; }
  .s1 { fill: var(--s1); } .s2 { fill: var(--s2); } .s3 { fill: var(--s3); }
  .s4 { fill: var(--s4); } .s5 { fill: var(--s5); } .s6 { fill: var(--s6); }
  .l1 { stroke: var(--s1); } .l2 { stroke: var(--s2); } .l3 { stroke: var(--s3); }
  .line { fill: none; stroke-width: 2; }
`
const SLOT = ['s1', 's2', 's3', 's4', 's5', 's6']
const STROKE = ['l1', 'l2', 'l3']
const ACCENT = 's1'

/**
 * Fail loudly on a malformed record rather than silently charting it wrong. Added after a
 * `setup` bucket that wasn't in EFFORT_KEYS silently vanished from five stacked bars —
 * the totals still said 100, but only 75-90 was drawn.
 */
const validate = (record, file) => {
  const fail = (why) => {
    throw new Error(`${file}: ${why}`)
  }
  for (const field of ['date', 'label', 'effort_split', 'churn_attribution', 'retro']) {
    if (record[field] == null) fail(`missing required field \`${field}\``)
  }
  const effort = Object.entries(record.effort_split)
  const unknown = effort.filter(([key]) => !EFFORT_KEYS.includes(key)).map(([key]) => key)
  if (unknown.length) fail(`effort_split has unchartable key(s): ${unknown.join(', ')}`)
  const effortTotal = effort.reduce((acc, [, value]) => acc + value, 0)
  if (Math.abs(effortTotal - 100) > 0.01) fail(`effort_split sums to ${effortTotal}, not 100`)
  const badTheme = (record.themes ?? []).filter((name) => !THEMES.includes(name))
  if (badTheme.length) fail(`unknown theme(s): ${badTheme.join(', ')}`)
  for (const [key, value] of Object.entries(record.ratings ?? {})) {
    if (value < 1 || value > 5) fail(`rating \`${key}\` is ${value}, outside 1-5`)
  }
  const review = record.review ?? {}
  const dispositioned = (review.fixed ?? 0) + (review.deferred ?? 0) + (review.declined ?? 0)
  if (dispositioned > (review.coderabbit_findings ?? 0)) {
    fail(`review dispositions (${dispositioned}) exceed findings (${review.coderabbit_findings})`)
  }
  return record
}

// Filenames sort chronologically by construction — same-day sessions get an `-a-`/`-b-`
// infix so alphabetical order matches the order they actually happened in.
const sessions = readdirSync(DIR)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => validate(JSON.parse(readFileSync(join(DIR, name), 'utf8')), name))


const sum = (values) => values.reduce((acc, value) => acc + (value ?? 0), 0)
const mean = (values) => (values.length ? sum(values) / values.length : 0)
const money = (value) => (value == null ? '—' : `$${value.toFixed(2)}`)
const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Sessions folded to one entry per calendar day. Cost/time sum; themes union; effort and
 * ratings are unweighted means across that day's sessions (simple, and the granularity is
 * approximate by design — see README).
 */
/** Charts show the most recent WINDOW days only; sessions.md keeps the full history. */
const WINDOW = 20

const ALL_DAYS = (() => {
  const days = new Map()
  for (const session of sessions) {
    const day = days.get(session.date) ?? { date: session.date, rows: [], themes: new Set() }
    day.rows.push(session)
    for (const name of session.themes ?? []) day.themes.add(name)
    days.set(session.date, day)
  }
  return [...days.values()].map((day) => ({
    date: day.date,
    label: day.date.slice(5),
    themes: day.themes,
    cost: day.rows.some((row) => row.cost_usd != null)
      ? sum(day.rows.map((row) => row.cost_usd))
      : null,
    api: day.rows.some((row) => row.api_minutes != null)
      ? sum(day.rows.map((row) => row.api_minutes))
      : null,
    wall: day.rows.some((row) => row.wall_minutes != null)
      ? sum(day.rows.map((row) => row.wall_minutes))
      : null,
    effort: Object.fromEntries(
      EFFORT_KEYS.map((key) => [key, mean(day.rows.map((row) => row.effort_split[key] ?? 0))]),
    ),
    ratings: Object.fromEntries(
      RATING_KEYS.map((key) => [key, mean(day.rows.map((row) => row.ratings?.[key] ?? 0))]),
    ),
  }))
})()

const DAYS = ALL_DAYS.slice(-WINDOW)
const windowed = ALL_DAYS.length > DAYS.length

/* ------------------------------------------------------------------ chart helpers */

const svgWrap = (width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif">
<style>${THEME_CSS}</style>
<rect class="surface" x="0" y="0" width="${width}" height="${height}" rx="6"/>
${body}
</svg>\n`

const legend = (items, xPos, yPos, gap = 112) =>
  items
    .map((item, index) => {
      const shift = xPos + index * gap
      return `<rect class="${item.slot}" x="${shift}" y="${yPos - 8}" width="10" height="10" rx="2"/><text class="sub" x="${shift + 15}" y="${yPos + 1}">${esc(item.label)}</text>`
    })
    .join('')

const WIDTH = 760
const LEFT = 52
const RIGHT = 16
const PLOT = WIDTH - LEFT - RIGHT
const band = PLOT / DAYS.length

const axis = (top, height, ratios, format) =>
  ratios
    .map((ratio) => {
      const yPos = top + height - ratio * height
      return `<line class="grid" x1="${LEFT}" y1="${yPos}" x2="${WIDTH - RIGHT}" y2="${yPos}"/><text class="tick" x="${LEFT - 8}" y="${yPos + 4}" text-anchor="end">${format(ratio)}</text>`
    })
    .join('')

/**
 * One overview chart: effort composition, cost, and time as three panels on a shared
 * x-axis. Reading them stacked is what makes the cost numbers legible — a day that looks
 * expensive is usually a day whose effort bar is mostly Build.
 */
const overviewChart = () => {
  const height = 560
  const barWidth = Math.min(48, band * 0.56)

  // Panel 1 — effort split, stacked to 100%.
  const effortTop = 74
  const effortHeight = 150
  const effortBars = DAYS.map((day, index) => {
    const xPos = LEFT + band * index + (band - barWidth) / 2
    let cursor = 0
    return EFFORT_KEYS.map((key, slot) => {
      const value = day.effort[key] ?? 0
      if (value <= 0.01) return ''
      const segHeight = (value / 100) * effortHeight
      const yPos = effortTop + effortHeight - ((cursor + value) / 100) * effortHeight
      cursor += value
      const radius = cursor >= 99.99 ? 4 : 0
      return `<rect class="${SLOT[slot]}" x="${xPos}" y="${yPos}" width="${barWidth}" height="${Math.max(segHeight - 2, 1)}" rx="${radius}"/>`
    }).join('')
  }).join('')

  // Panel 2 — cost.
  const costTop = 288
  const costHeight = 96
  const costs = DAYS.map((day) => day.cost ?? 0)
  const costPeak = Math.max(Math.ceil(Math.max(...costs) / 20) * 20, 20)
  const costBars = DAYS.map((day, index) => {
    if (day.cost == null) return ''
    const xPos = LEFT + band * index + (band - barWidth) / 2
    const barHeight = (day.cost / costPeak) * costHeight
    const yPos = costTop + costHeight - barHeight
    return `<rect class="${ACCENT}" x="${xPos}" y="${yPos}" width="${barWidth}" height="${barHeight}" rx="4"/><text class="tick" x="${xPos + barWidth / 2}" y="${yPos - 5}" text-anchor="middle">$${day.cost.toFixed(0)}</text>`
  }).join('')

  // Panel 3 — API vs wall time, grouped (two series, so it carries a legend).
  const timeTop = 434
  const timeHeight = 84
  const pairWidth = barWidth / 2 - 1
  const hours = DAYS.flatMap((day) => [(day.api ?? 0) / 60, (day.wall ?? 0) / 60])
  const timePeak = Math.max(Math.ceil(Math.max(...hours)), 1)
  const timeBars = DAYS.map((day, index) => {
    const base = LEFT + band * index + (band - barWidth) / 2
    return [
      { value: (day.api ?? 0) / 60, slot: 's1', offset: 0 },
      { value: (day.wall ?? 0) / 60, slot: 's2', offset: pairWidth + 2 },
    ]
      .map((entry) => {
        if (entry.value <= 0) return ''
        const barHeight = (entry.value / timePeak) * timeHeight
        const yPos = timeTop + timeHeight - barHeight
        return `<rect class="${entry.slot}" x="${base + entry.offset}" y="${yPos}" width="${pairWidth}" height="${barHeight}" rx="3"/>`
      })
      .join('')
  }).join('')

  const ticks = DAYS.map(
    (day, index) =>
      `<text class="tick" x="${LEFT + band * index + band / 2}" y="${timeTop + timeHeight + 15}" text-anchor="middle">${day.label}</text>`,
  ).join('')

  return svgWrap(
    WIDTH,
    height,
    `<text class="title" x="${LEFT}" y="22">Effort, cost and time by day</text>
<text class="sub" x="${LEFT}" y="38">Three panels on one shared x-axis — read the cost bar against the effort bar above it.</text>
<text class="panel" x="${LEFT}" y="${effortTop - 10}">Effort split (%)</text>
${axis(effortTop, effortHeight, [0, 0.5, 1], (ratio) => Math.round(ratio * 100))}${effortBars}
${legend(
  EFFORT_KEYS.map((key, slot) => ({ label: EFFORT_LABEL[key], slot: SLOT[slot] })),
  LEFT,
  effortTop + effortHeight + 34,
  108,
)}
<text class="panel" x="${LEFT}" y="${costTop - 10}">LLM cost (USD, API-equivalent)</text>
${axis(costTop, costHeight, [0, 1], (ratio) => `$${Math.round(costPeak * ratio)}`)}${costBars}
<text class="panel" x="${LEFT}" y="${timeTop - 10}">Time (hours)</text>
${axis(timeTop, timeHeight, [0, 1], (ratio) => `${(timePeak * ratio).toFixed(0)}h`)}${timeBars}
${legend([{ label: 'API', slot: 's1' }, { label: 'Wall', slot: 's2' }], LEFT, timeTop + timeHeight + 34)}
${ticks}`,
  )
}

/** Lines — the three 1–5 self-assessments over time. */
const ratingsChart = () => {
  const height = 260
  const top = 60
  const plotHeight = height - top - 46

  const gridlines = [1, 2, 3, 4, 5]
    .map((value) => {
      const yPos = top + plotHeight - ((value - 1) / 4) * plotHeight
      return `<line class="grid" x1="${LEFT}" y1="${yPos}" x2="${WIDTH - RIGHT}" y2="${yPos}"/><text class="tick" x="${LEFT - 8}" y="${yPos + 4}" text-anchor="end">${value}</text>`
    })
    .join('')

  const series = RATING_KEYS.map((key, index) => {
    const points = DAYS.map((day, dayIndex) => {
      const xPos = LEFT + band * dayIndex + band / 2
      const yPos = top + plotHeight - ((day.ratings[key] - 1) / 4) * plotHeight
      return { xPos, yPos }
    })
    const path = points.map((point, idx) => `${idx ? 'L' : 'M'}${point.xPos} ${point.yPos}`).join(' ')
    const markers = points
      .map((point) => `<circle class="${SLOT[index]}" cx="${point.xPos}" cy="${point.yPos}" r="4"/>`)
      .join('')
    return `<path class="line ${STROKE[index]}" d="${path}"/>${markers}`
  }).join('')

  const ticks = DAYS.map(
    (day, index) =>
      `<text class="tick" x="${LEFT + band * index + band / 2}" y="${top + plotHeight + 16}" text-anchor="middle">${day.label}</text>`,
  ).join('')

  return svgWrap(
    WIDTH,
    height,
    `<text class="title" x="${LEFT}" y="22">Self-assessment by day (1–5)</text>
<text class="sub" x="${LEFT}" y="38">Averaged across the day's sessions. Judged, not measured — read as direction, not score.</text>
${gridlines}${series}${ticks}
${legend(
  RATING_KEYS.map((key, index) => ({ label: RATING_LABEL[key], slot: SLOT[index] })),
  LEFT,
  height - 12,
)}`,
  )
}

/** Dot plot — identity is the y-axis label; per-theme color is redundant reinforcement. */
const themeChart = () => {
  const height = 240
  const top = 46
  const plotHeight = height - top - 34
  const rowHeight = plotHeight / THEMES.length

  const rows = THEMES.map((name, index) => {
    const yPos = top + rowHeight * index + rowHeight / 2
    return `<line class="grid" x1="${LEFT + 20}" y1="${yPos}" x2="${WIDTH - RIGHT}" y2="${yPos}"/><text class="sub" x="${LEFT + 10}" y="${yPos + 4}" text-anchor="end">${name}</text>`
  }).join('')

  const dots = DAYS.map((day, index) => {
    const xPos = LEFT + 20 + ((PLOT - 20) / DAYS.length) * index + (PLOT - 20) / DAYS.length / 2
    return [...day.themes]
      .map((name) => {
        const row = THEMES.indexOf(name)
        if (row < 0) return ''
        const yPos = top + rowHeight * row + rowHeight / 2
        return `<circle class="${SLOT[row]}" cx="${xPos}" cy="${yPos}" r="7"/>`
      })
      .join('')
  }).join('')

  const ticks = DAYS.map((day, index) => {
    const xPos = LEFT + 20 + ((PLOT - 20) / DAYS.length) * index + (PLOT - 20) / DAYS.length / 2
    return `<text class="tick" x="${xPos}" y="${top + plotHeight + 14}" text-anchor="middle">${day.label}</text>`
  }).join('')

  return svgWrap(
    WIDTH,
    height,
    `<text class="title" x="${LEFT - 32}" y="22">Where attention went</text>
<text class="sub" x="${LEFT - 32}" y="38">One dot per theme touched that day; a day can span several.</text>
${rows}${dots}${ticks}`,
  )
}

/* ------------------------------------------------------------------ write charts */

mkdirSync(CHARTS, { recursive: true })
const CHART_SET = [
  ['overview', overviewChart],
  ['ratings', ratingsChart],
  ['themes', themeChart],
]
for (const [name, render] of CHART_SET) {
  writeFileSync(join(CHARTS, `${name}.svg`), render())
}

/* ------------------------------------------------------------------ aggregates */

const measured = sessions.filter((session) => session.cost_usd != null)
const totalCost = sum(measured.map((session) => session.cost_usd))
const totalWall = sum(sessions.map((session) => session.wall_minutes))
const totalApi = sum(sessions.map((session) => session.api_minutes))
const prCount = sessions.flatMap((session) => session.delivered.prs).length
const findings = sum(sessions.map((session) => session.review.coderabbit_findings))
const fixed = sum(sessions.map((session) => session.review.fixed))
const avgChurn = mean(sessions.map((session) => session.effort_split.churn)).toFixed(1)
const avgDocs = mean(sessions.map((session) => session.effort_split.docs)).toFixed(1)

const attribution = ['under_specified', 'claude_error', 'genuine_discovery'].map((key) => ({
  key,
  share: sum(
    sessions.map(
      (session) => ((session.churn_attribution[key] ?? 0) * (session.effort_split.churn ?? 0)) / 100,
    ),
  ),
}))
const attributionSum = sum(attribution.map((entry) => entry.share)) || 1


const reworked = sessions.filter((session) => (session.rework_of ?? []).length)

/* ------------------------------------------------------------------ sessions.md */

writeFileSync(
  'docs/session-metrics-reports/sessions.md',
  `# Session table

<!-- GENERATED by scripts/reports/session-metrics-report.mjs — do not edit by hand. -->

Full per-session detail. Summary and charts: [report.md](report.md).

| Date | Label | Cost | API | Wall | Effort split | Themes | Delivered |
| --- | --- | --- | --- | --- | --- | --- | --- |
${sessions
  .map((session) => {
    // <br> rather than · so each bucket gets its own line in the table cell.
    const split = EFFORT_KEYS.filter((key) => (session.effort_split[key] ?? 0) > 0)
      .map((key) => `${EFFORT_LABEL[key]} ${session.effort_split[key]}%`)
      .join('<br>')
    const shipped = [
      ...session.delivered.prs.map((num) => `#${num}`),
      ...session.delivered.adrs.map((adr) => `ADR ${adr}`),
    ].join(', ')
    const time = (value) => (value ? `${(value / 60).toFixed(1)}h` : '—')
    return `| ${session.date} | ${session.label} | ${money(session.cost_usd)} | ${time(session.api_minutes)} | ${time(session.wall_minutes)} | ${split} | ${(session.themes ?? []).join(', ')} | ${shipped || '—'} |`
  })
  .join('\n')}
`,
)

/* ------------------------------------------------------------------ report.md */

const chart = (name, alt) => `![${alt}](charts/${name}.svg)`

writeFileSync(
  'docs/session-metrics-reports/report.md',
  `# Session metrics report

<!-- GENERATED by scripts/reports/session-metrics-report.mjs — do not edit by hand.
     Edit docs/session-metrics-reports/sessions/*.json and re-run \`pnpm session-metrics:report\`. -->

${sessions[0].date} → ${sessions.at(-1).date}

- Sessions: **${sessions.length}**
- Cost, LLM (API-equivalent): **${money(totalCost)}**
- Time (API): **${(totalApi / 60).toFixed(1)}h**
- Time (wall): **${(totalWall / 60).toFixed(1)}h**
- PRs: **${prCount}**
- CodeRabbit findings fixed: **${fixed}/${findings}**

${
  sessions.some((session) => session.confidence === 'reconstructed')
    ? `> Rows marked \`reconstructed\` were backfilled rather than captured live: their
> quantitative fields came from an earlier tracker and their qualitative fields were
> *inferred from prose*. Don't read those rows as measurement.
`
    : ''
}## Effort, cost and time

Average churn **${avgChurn}%** · average docs maintenance **${avgDocs}%**.
Docs is tracked apart from design deliberately: design is the work, doc upkeep is
overhead and a candidate for automation.

${chart('overview', 'Effort split, cost and time by day')}${
  windowed
    ? `\n\n*Charts show the most recent ${DAYS.length} days of ${ALL_DAYS.length}. Full history: [sessions.md](sessions.md).*`
    : ''
}

### Where the churn came from

Weighted by each session's churn share. A falling \`under_specified\` share is the
improvement curve; \`genuine_discovery\` is the irreducible floor.

| Cause | Share of all churn |
| --- | --- |
${attribution
  .map((entry) => `| \`${entry.key}\` | ${((entry.share / attributionSum) * 100).toFixed(0)}% |`)
  .join('\n')}

## Rework

Two kinds, tracked separately:

- **Within a session** — the \`churn\` band above. Averaging **${avgChurn}%**.
- **Across sessions** — work a *later* session had to redo. **${reworked.length} of
  ${sessions.length}** sessions redid earlier work${
    reworked.length
      ? `:\n\n${reworked
          .map(
            (session) =>
              `  - \`${session.date}\` redid work from \`${session.rework_of.join('`, `')}\` — ${session.label}`,
          )
          .join('\n')}`
      : '.'
  }

Cross-session rework is the more expensive kind: it means a decision didn't hold, so
everything built on it has to be revisited. Watch it against \`decision_stability\`.

## Self-assessment

${chart('ratings', 'Line chart of the three 1-5 self-assessment ratings by day')}

## Themes

${chart('themes', 'Dot plot of themes touched per day over time')}

## Recent retrospectives

${sessions
  .slice(-5)
  .reverse()
  .map(
    (session) => `### ${session.date} — ${session.label}

- **Went well:** ${session.retro.went_well}
- **Improve:** ${session.retro.improve}
- **Tooling:** ${session.retro.tooling_suggestion}${
      (session.decisions ?? []).length
        ? `\n- **Decisions:**\n${session.decisions.map((entry) => `  - ${entry}`).join('\n')}`
        : ''
    }`,
  )
  .join('\n\n')}

---

Per-session detail: [sessions.md](sessions.md) · Schema: [README.md](README.md)
`,
)

console.log(`wrote report.md, sessions.md, ${CHART_SET.length} charts — ${sessions.length} sessions`)
