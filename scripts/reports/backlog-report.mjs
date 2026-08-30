#!/usr/bin/env node
/**
 * Regenerates docs/backlog/issues.md from the GitHub issue tracker.
 *
 * The output is GENERATED — never hand-edit it. It is a *descriptive snapshot*: epic →
 * sub-issue structure, the Project #2 Priority/Status fields, and area grouping, exactly
 * as they stand in GitHub. It carries no sequencing opinion; the proposed order of attack
 * lives in docs/backlog/critical-path.md, which IS hand-written and may drift from this
 * file on purpose.
 *
 *   node scripts/reports/backlog-report.mjs      (or: pnpm backlog:report)
 *
 * Why a generated doc at all: once the backlog runs to dozens of issues across several
 * epics, that is more than a session pickup wants to discover through five `gh`
 * round-trips — but a hand-maintained list of them is the exact drift trap
 * docs/test-traceability-reports/README.md warns about. So the volatile half is
 * regenerated on demand, and the stable half (docs/backlog/README.md, which explains what
 * each epic is *for*) is written by hand.
 *
 * NOT YET LIVE. This needs a GitHub remote and a user-owned Project; art-loupe has
 * neither until the repo is pushed. Until then the script fails cleanly rather than
 * writing a misleading file, and PROJECT_NUMBER below must be re-pointed at the real
 * project once one exists.
 *
 * Sources of truth, in order of authority:
 *  - Epic → child comes from real GitHub **sub-issue** links (issue.parent / subIssues),
 *    not from prose in the epic body. Body prose goes stale; the link does not.
 *  - Priority + Status come from the user-owned Project #2 fields, never from labels.
 *    Priority labels were deliberately deleted — one source of truth. If the project
 *    query fails (e.g. a token without `project` scope), those columns degrade to "—"
 *    rather than the script inventing a value.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const PROJECT_NUMBER = '2'
const OUT = 'docs/backlog/issues.md'
const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3', '—']

const gh = (args) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

/** `owner/name` of the repo this script is run inside. */
const repoSlug = () => JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner

const ISSUE_QUERY = `
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, states: [OPEN], after: $cursor, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        url
        labels(first: 20) { nodes { name } }
        parent { number }
        subIssues(first: 50) { totalCount nodes { number } }
      }
    }
  }
}`

/** Every open issue, following pagination until GitHub stops handing back cursors. */
const fetchIssues = (owner, name) => {
  const issues = []
  let cursor = null
  for (;;) {
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${ISSUE_QUERY}`,
      '-F',
      `owner=${owner}`,
      '-F',
      `name=${name}`,
    ]
    if (cursor) args.push('-F', `cursor=${cursor}`)
    const page = JSON.parse(gh(args)).data.repository.issues
    issues.push(...page.nodes)
    if (!page.pageInfo.hasNextPage) break
    cursor = page.pageInfo.endCursor
  }
  return issues
}

/**
 * Project #2 field values, keyed by issue number. Returns an empty map (and warns) when
 * the project can't be read, so a missing scope degrades the report instead of failing it.
 */
const fetchProjectFields = (owner) => {
  const fields = new Map()
  try {
    const raw = gh([
      'project',
      'item-list',
      PROJECT_NUMBER,
      '--owner',
      owner,
      '--format',
      'json',
      '--limit',
      '500',
    ])
    for (const item of JSON.parse(raw).items) {
      const number = item.content?.number
      if (number === undefined) continue
      fields.set(number, { priority: item.priority ?? '—', status: item.status ?? '—' })
    }
  } catch (error) {
    console.warn(`warning: could not read Project #${PROJECT_NUMBER} — Priority/Status will show "—"`)
    console.warn(`  ${error.message.split('\n')[0]}`)
  }
  return fields
}

/**
 * Escape a value for a markdown table cell. Backslash MUST be escaped before the pipe:
 * escaping only `|` turns a title containing `\|` into `\\|`, which renders as a literal
 * backslash followed by a live cell separator, splitting the row.
 */
const cell = (text) => text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')

const priorityRank = (priority) => {
  const index = PRIORITY_ORDER.indexOf(priority)
  return index === -1 ? PRIORITY_ORDER.length : index
}

const byPriorityThenNumber = (left, right) =>
  priorityRank(left.priority) - priorityRank(right.priority) || left.number - right.number

/**
 * Area prefix from the repo's `area: title` convention (`agent:`, `studio:`, `docs:` …),
 * used only to group the issues that have no epic parent. Titles without a prefix fall
 * into "unfiled" rather than each becoming their own single-row group.
 */
const areaOf = (title) => {
  const match = /^([a-z0-9-]+):/.exec(title)
  return match ? match[1] : 'unfiled'
}

const issueRow = (issue) =>
  `| [#${issue.number}](${issue.url}) | ${cell(issue.title)} | ${issue.priority} | ${issue.status} |`

const TABLE_HEAD = ['| # | Title | Priority | Status |', '| --- | --- | --- | --- |']

const main = () => {
  const slug = repoSlug()
  const [owner, name] = slug.split('/')

  const rawIssues = fetchIssues(owner, name)
  const projectFields = fetchProjectFields(owner)

  const issues = rawIssues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    url: issue.url,
    labels: issue.labels.nodes.map((label) => label.name),
    parent: issue.parent?.number ?? null,
    childCount: issue.subIssues.totalCount,
    priority: projectFields.get(issue.number)?.priority ?? '—',
    status: projectFields.get(issue.number)?.status ?? '—',
  }))

  const byNumber = new Map(issues.map((issue) => [issue.number, issue]))
  const epics = issues.filter((issue) => issue.labels.includes('epic')).sort(byPriorityThenNumber)
  const epicNumbers = new Set(epics.map((epic) => epic.number))

  // A child whose parent is closed (so absent from this open-issues fetch) would otherwise
  // vanish from the report entirely — treat it as unparented so it still gets listed.
  const children = new Map(epics.map((epic) => [epic.number, []]))
  const orphans = []
  for (const issue of issues) {
    if (epicNumbers.has(issue.number)) continue
    if (issue.parent !== null && children.has(issue.parent)) children.get(issue.parent).push(issue)
    else orphans.push(issue)
  }

  const counts = new Map(PRIORITY_ORDER.map((priority) => [priority, 0]))
  for (const issue of issues) counts.set(issue.priority, (counts.get(issue.priority) ?? 0) + 1)

  const today = new Date().toISOString().slice(0, 10)
  const filed = issues.length - epics.length - orphans.length
  const lines = [
    '# Open backlog — epics and issues',
    '',
    '<!-- GENERATED by scripts/reports/backlog-report.mjs — do not edit by hand.',
    '     Re-run `pnpm backlog:report`. Edit the issues in GitHub, not this file. -->',
    '',
    `Snapshot of \`${slug}\` open issues taken **${today}**.`,
    'Descriptive only — this file reports what GitHub says. The proposed *order of attack*',
    'is a separate, hand-written judgment call in [`critical-path.md`](./critical-path.md);',
    'what each epic is **for** is in [`README.md`](./README.md).',
    '',
    `- Open issues: **${issues.length}** — **${epics.length}** epics, **${filed}** filed under an epic, **${orphans.length}** unparented`,
    '',
  ]

  lines.push(
    '| Priority | Issues |',
    '| --- | --- |',
    ...PRIORITY_ORDER.map((priority) => `| ${priority} | ${counts.get(priority) ?? 0} |`),
    '',
    `Priority and Status are the [Project #${PROJECT_NUMBER}](https://github.com/users/${owner}/projects/${PROJECT_NUMBER})`,
    'field values — there are no priority labels. `—` means the field is unset.',
    '',
    '## Epics',
    '',
  )

  for (const epic of epics) {
    const kids = (children.get(epic.number) ?? []).sort(byPriorityThenNumber)
    lines.push(
      `### [#${epic.number}](${epic.url}) — ${cell(epic.title)}`,
      '',
      `**${epic.priority}** · ${epic.status} · ${kids.length} open sub-issue${kids.length === 1 ? '' : 's'}`,
      '',
    )
    if (kids.length === 0) lines.push('No open sub-issues.', '')
    else lines.push(...TABLE_HEAD, ...kids.map(issueRow), '')
  }

  lines.push(
    '## Unparented issues',
    '',
    'Open issues with no epic parent, grouped by the `area:` prefix in their title.',
    '',
  )

  const byArea = new Map()
  for (const issue of orphans) {
    const area = areaOf(issue.title)
    if (!byArea.has(area)) byArea.set(area, [])
    byArea.get(area).push(issue)
  }
  const areas = [...byArea.keys()].sort((left, right) => {
    const sizeDiff = byArea.get(right).length - byArea.get(left).length
    return sizeDiff || left.localeCompare(right)
  })
  for (const area of areas) {
    const group = byArea.get(area).sort(byPriorityThenNumber)
    lines.push(`### ${area}`, '', ...TABLE_HEAD, ...group.map(issueRow), '')
  }

  // Collapse the blank line each section appends into the next section's own spacing, and
  // end on exactly one newline — markdownlint MD012 rejects the doubled trailing blank.
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
  // docs/backlog/ is not committed empty — it appears the first time this runs.
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${body}\n`)
  console.log(`wrote ${OUT} — ${issues.length} open issues, ${epics.length} epics`)
}

main()
