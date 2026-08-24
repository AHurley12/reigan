import { createHash } from 'crypto'
import { CONTEXT_FACT_KINDS, type ContextFact, type ContextFactKind } from '../../shared/types'
import { getStat, listFacts } from './store'
import type { ContextStats } from './stats'

export const RENDER_THRESHOLD = 0.35
/** ~1200 tokens at the usual 4-chars-per-token rule of thumb. */
export const MAX_DIGEST_CHARS = 4800

const GROUP_HEADINGS: Record<ContextFactKind, string> = {
  role: 'Duties & roles',
  duty: 'Duties & roles',
  project: 'Goals & projects',
  goal: 'Goals & projects',
  tendency: 'Patterns worth naming',
}

/**
 * Renders what is known about the user into a block appended to the persona.
 *
 * Ranking is global by confidence and the cap is applied before grouping, so a
 * long tail of weakly-supported guesses can never crowd out a fact the user
 * typed by hand.
 */
export function renderDigest(facts: ContextFact[], stats: Partial<ContextStats>): string {
  const ranked = facts
    .filter((f) => f.status === 'active' && f.confidence >= RENDER_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)

  const statLines = renderStatLines(stats)
  if (ranked.length === 0 && statLines.length === 0) return ''

  const header = '## What you know about this user\n'
  const footer =
    '\nThis is what you have actually observed. When you call out a pattern, cite one from this list. ' +
    'Never invent a pattern, a count, or a date to make a better line — a confident wrong callout costs you ' +
    'more than saying nothing. Items marked (stated directly) came from the user and are ground truth.\n'

  // 160 chars reserved for section headings: up to three fact groups plus
  // "Current numbers", at roughly 40 each. The cap is hard, so the slack has to
  // cover the worst case rather than the one-heading common case.
  const HEADING_SLACK = 160
  const budget =
    MAX_DIGEST_CHARS - header.length - footer.length - statLines.join('\n').length - HEADING_SLACK

  const kept: ContextFact[] = []
  let used = 0
  for (const f of ranked) {
    const line = factLine(f)
    if (used + line.length > budget) continue
    kept.push(f)
    used += line.length
  }

  const sections: string[] = []
  const seenHeadings = new Set<string>()
  for (const kind of CONTEXT_FACT_KINDS) {
    const heading = GROUP_HEADINGS[kind]
    if (seenHeadings.has(heading)) continue
    seenHeadings.add(heading)

    const inGroup = kept.filter((f) => GROUP_HEADINGS[f.kind] === heading)
    if (inGroup.length === 0) continue

    sections.push(`\n### ${heading}\n${inGroup.map(factLine).join('')}`)
  }

  if (statLines.length > 0) {
    sections.push(`\n### Current numbers\n${statLines.map((l) => `- ${l}\n`).join('')}`)
  }

  return `${header}${sections.join('')}${footer}`
}

function factLine(f: ContextFact): string {
  const mark = f.source === 'user' ? ' (stated directly)' : ''
  return `- ${f.body}${mark}\n`
}

function renderStatLines(stats: Partial<ContextStats>): string[] {
  const lines: string[] = []

  if (stats.tasksOverdue && stats.tasksOverdue.count > 0) {
    lines.push(
      `${stats.tasksOverdue.count} overdue tasks; the oldest is ${stats.tasksOverdue.oldestDays} days past due.`,
    )
  }
  if (stats.tasksThroughput) {
    const { created, completed, open } = stats.tasksThroughput
    lines.push(`Last 30 days: ${created} tasks created, ${completed} completed, ${open} still open.`)
  }
  if (stats.tasksLatencyDays !== null && stats.tasksLatencyDays !== undefined) {
    lines.push(`Median time from creating a task to finishing it: ${stats.tasksLatencyDays} days.`)
  }
  if (stats.jobsReliability && stats.jobsReliability.runs > 0 && stats.jobsReliability.failures > 0) {
    const pct = Math.round(stats.jobsReliability.failureRate * 100)
    lines.push(`${pct}% of scheduled job runs failed in the last 30 days.`)
  }
  if (stats.coldProjects && stats.coldProjects.length > 0) {
    const list = stats.coldProjects.map((p) => `${p.name} (${p.days}d)`).join(', ')
    lines.push(`Projects gone cold: ${list}.`)
  }

  return lines
}

export function hashDigest(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12)
}

/** Reads the live store and renders. Returns empty text when nothing is known. */
export function buildContextDigest(): { text: string; hash: string } {
  const facts = listFacts({ minConfidence: RENDER_THRESHOLD })
  const stats: Partial<ContextStats> = {
    tasksThroughput: getStat('tasks.throughput') ?? undefined,
    tasksOverdue: getStat('tasks.overdue') ?? undefined,
    tasksLatencyDays: getStat<{ days: number | null }>('tasks.latency')?.days ?? null,
    jobsReliability: getStat('jobs.reliability') ?? undefined,
    coldProjects: getStat('projects.cold') ?? undefined,
  }

  const text = renderDigest(facts, stats)
  return { text, hash: hashDigest(text) }
}
