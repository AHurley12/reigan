/**
 * Command safety classification.
 *
 * The rule that shapes everything here: classification runs on parsed
 * segments, never on the raw string. `git status && rd /s /q C:\` contains a
 * perfectly safe allowlisted command, and a substring match for "git status"
 * would wave the whole line through. So the line is split into segments first,
 * each is classified independently, and the *highest* risk wins — with a
 * blocklisted segment poisoning the entire line rather than just its own part.
 */

export type Tier = 'allow' | 'approval' | 'block'

export interface Classification {
  tier: Tier
  /** Plain-language reason, shown in the approval card or the refusal. */
  reason: string
  /** The segment responsible for the verdict. */
  offendingSegment?: string
  segments: string[]
}

/**
 * Splits a command line on shell separators, respecting quotes.
 *
 * Handles `;`, `&&`, `||`, `|`, `&` and newlines. A separator inside quotes is
 * literal text — `echo "a && b"` is one segment, not two — and getting that
 * wrong in the other direction would let a blocklisted command hide inside
 * what looks like a quoted string.
 */
export function splitSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]
    const next = command[i + 1]

    if (quote) {
      current += char
      // PowerShell escapes a quote by doubling it; treat the pair as content.
      if (char === quote) {
        if (next === quote) {
          current += next
          i += 1
        } else {
          quote = null
        }
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }

    // Backtick is PowerShell's escape character: the next character is
    // literal, including a separator.
    if (char === '`' && next) {
      current += char + next
      i += 1
      continue
    }

    if (char === '\n' || char === '\r' || char === ';') {
      segments.push(current)
      current = ''
      continue
    }

    if ((char === '&' || char === '|') && next === char) {
      segments.push(current)
      current = ''
      i += 1
      continue
    }

    if (char === '|' || char === '&') {
      segments.push(current)
      current = ''
      continue
    }

    current += char
  }

  segments.push(current)
  return segments.map((s) => s.trim()).filter((s) => s.length > 0)
}

/** The command word of a segment, lowercased, without path or extension. */
export function commandWord(segment: string): string {
  const trimmed = segment.trim()
  // A quoted executable path: "C:\Program Files\x\tool.exe" -args
  const quoted = /^"([^"]+)"/.exec(trimmed)
  const raw = quoted ? quoted[1] : trimmed.split(/\s+/)[0] ?? ''
  const leaf = raw.replace(/\\/g, '/').split('/').pop() ?? raw
  return leaf.replace(/\.(exe|cmd|bat|ps1|com)$/i, '').toLowerCase()
}

/**
 * Read-only commands that run without asking.
 *
 * Entries are matched against the whole segment, not just the command word,
 * because `git` alone is not safe — `git status` is, `git push --force` is
 * not. Anything not matched here falls to the approval tier by default.
 */
const ALLOW_PATTERNS: RegExp[] = [
  /^git\s+(status|log|diff|show|branch|remote(\s+-v)?|config\s+--get|describe|rev-parse|shortlog|blame|tag)\b/i,
  /^git\s+(ls-files|ls-remote|cat-file|count-objects)\b/i,
  /^npm\s+(ls|list|view|outdated|ping|root|prefix|whoami|--version|-v)\b/i,
  /^(npx\s+)?tsc\s+--(version|noEmit)\b/i,
  /^(pnpm|yarn|bun)\s+(list|ls|why|outdated|--version)\b/i,
  /^pip\s+(list|show|freeze|--version)\b/i,
  /^(node|python|python3|deno|bun|go|cargo|rustc|java|dotnet)\s+(--version|-v|version)\b/i,
  /^(dir|ls|pwd|cd|whoami|hostname|date|echo|type|cat|head|tail|wc|find|findstr|where|which)\b/i,
  /^(Get-ChildItem|Get-Location|Get-Process|Get-Content|Get-Date|Get-Command|Get-Host|Get-Member|Get-Module|Get-Item|Get-ItemProperty|Measure-Object|Select-Object|Sort-Object|Where-Object|Format-Table|Format-List|Out-String)\b/i,
  /^(Get-NetTCPConnection|Get-CimInstance|Get-ComputerInfo|Get-Volume|Get-PSDrive)\b/i,
  /^(docker\s+(ps|images|version|info)|kubectl\s+get)\b/i,
  /^systeminfo\b/i,
  /^netstat\b/i,
  /^ipconfig(\s+\/all)?\s*$/i,
  /^tree\b/i,
]

interface BlockRule {
  pattern: RegExp
  reason: string
}

/**
 * Refused outright, with an explanation.
 *
 * Deliberately narrow and specific. A blocklist that refuses anything
 * containing "remove" would block `git remove-worktree` and teach the user
 * that the blocklist is noise to be worked around — which is worse than not
 * having one. Each rule targets a shape that is destructive on any reading.
 */
const BLOCK_RULES: BlockRule[] = [
  {
    // Recursive delete aimed at a drive root or a top-level system directory.
    pattern: /\b(rd|rmdir)\b[^\n]*\/s\b[^\n]*\b[a-z]:(\\+)?(\s|$|")/i,
    reason: 'Recursive directory removal targeting a drive root.',
  },
  {
    pattern: /\bdel\b[^\n]*\/s\b[^\n]*\b[a-z]:(\\+)?(\s|$|")/i,
    reason: 'Recursive delete targeting a drive root.',
  },
  {
    pattern: /Remove-Item\b[^\n]*-Recurse\b[^\n]*(\b[a-z]:[\\/]?["']?\s*$|[\\/]\*?\s*$|\$env:SystemRoot|C:[\\/]Windows)/i,
    reason: 'Recursive Remove-Item targeting a drive root or the Windows directory.',
  },
  {
    pattern: /\bformat\s+[a-z]:/i,
    reason: 'Formatting a drive.',
  },
  {
    pattern: /\b(diskpart|bcdedit|bootrec)\b/i,
    reason: 'Disk and boot configuration tooling.',
  },
  {
    pattern: /\b(shutdown|restart-computer|stop-computer)\b/i,
    reason: 'Shutting down or restarting the machine.',
  },
  {
    pattern: /\b(reg\s+(add|delete)|Set-ItemProperty|New-ItemProperty|Remove-ItemProperty)\b[^\n]*HKLM/i,
    reason: 'Writing to the HKEY_LOCAL_MACHINE registry hive.',
  },
  {
    pattern: /Set-ExecutionPolicy\b[^\n]*\b(Unrestricted|Bypass)\b/i,
    reason: 'Weakening the PowerShell execution policy.',
  },
  {
    pattern: /(Invoke-Expression|iex)\s*\(\s*(New-Object\s+Net\.WebClient|Invoke-WebRequest|iwr)/i,
    reason: 'Downloading and executing remote code.',
  },
  {
    pattern: /\bcipher\s+\/w\b|\bsdelete\b/i,
    reason: 'Secure-erase tooling.',
  },
  {
    pattern: /\bvssadmin\b[^\n]*\bdelete\b/i,
    reason: 'Deleting volume shadow copies.',
  },
  {
    pattern: /\btakeown\b[^\n]*\/r\b[^\n]*\b[a-z]:(\\+)?(\s|$)|\bicacls\b[^\n]*\b[a-z]:\\?\s+\/grant[^\n]*\/t\b/i,
    reason: 'Recursively taking ownership of a drive.',
  },
]

/**
 * Rules matched against the whole command line rather than a segment.
 *
 * Splitting on separators is what stops a blocked command hiding behind an
 * allowlisted one, but it also destroys any pattern that spans a separator:
 * `curl … | sh` becomes `curl …` and `sh`, and neither half is dangerous
 * alone. Piping a download into an interpreter is a property of the pipeline,
 * so it has to be matched before the line is taken apart.
 *
 * Found by a test that asserted the curl-pipe case was blocked and got
 * `approval` back.
 */
const PIPELINE_BLOCK_RULES: BlockRule[] = [
  {
    pattern:
      /(curl|wget|iwr|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*\|\s*(sh|bash|zsh|iex|Invoke-Expression|powershell|pwsh|cmd)\b/i,
    reason: 'Piping downloaded content straight into a shell.',
  },
]

/**
 * Credential-shaped literals.
 *
 * Refused because a command carrying a live secret should not be run from
 * here at all: it would be written verbatim into shell_history, and the point
 * of the vault is that secrets do not end up in plaintext tables. Matching is
 * on recognisable token formats rather than the word "password", so
 * `pass --help` is unaffected.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{16,}/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN\s+(RSA|OPENSSH|EC|PGP)?\s*PRIVATE KEY-----/i,
]

export interface UserRule {
  pattern: string
  tier: Tier
  isRegex: boolean
}

function matchesUserRule(segment: string, rule: UserRule): boolean {
  if (rule.isRegex) {
    try {
      return new RegExp(rule.pattern, 'i').test(segment)
    } catch {
      // A malformed user regex must not throw mid-classification; treating it
      // as a non-match is safe because the default tier is already approval.
      return false
    }
  }
  return segment.toLowerCase().includes(rule.pattern.toLowerCase())
}

function classifySegment(segment: string, userRules: UserRule[]): { tier: Tier; reason: string } {
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(segment)) {
      return {
        tier: 'block',
        reason:
          'The command contains something shaped like a live credential. Running it would write the secret into shell history in plaintext.',
      }
    }
  }

  // User blocks are checked before built-in allows, so a user can forbid
  // something this module would otherwise wave through.
  for (const rule of userRules) {
    if (rule.tier === 'block' && matchesUserRule(segment, rule)) {
      return { tier: 'block', reason: `Blocked by your own rule: ${rule.pattern}` }
    }
  }

  for (const rule of BLOCK_RULES) {
    if (rule.pattern.test(segment)) {
      return { tier: 'block', reason: rule.reason }
    }
  }

  for (const rule of userRules) {
    if (rule.tier === 'allow' && matchesUserRule(segment, rule)) {
      return { tier: 'allow', reason: `Allowed by your own rule: ${rule.pattern}` }
    }
  }

  for (const pattern of ALLOW_PATTERNS) {
    if (pattern.test(segment.trim())) {
      return { tier: 'allow', reason: 'Read-only command with no side effects.' }
    }
  }

  return {
    tier: 'approval',
    reason: `"${commandWord(segment) || segment}" is not on the read-only allowlist, so it needs your approval.`,
  }
}

const TIER_RANK: Record<Tier, number> = { allow: 0, approval: 1, block: 2 }

export function classifyCommand(command: string, userRules: UserRule[] = []): Classification {
  const segments = splitSegments(command)

  if (segments.length === 0) {
    return { tier: 'block', reason: 'Empty command.', segments: [] }
  }

  // Whole-line rules run first: they describe compositions that disappear the
  // moment the line is split.
  for (const rule of PIPELINE_BLOCK_RULES) {
    if (rule.pattern.test(command)) {
      return { tier: 'block', reason: rule.reason, offendingSegment: command.trim(), segments }
    }
  }

  let worst: { tier: Tier; reason: string; segment: string } = {
    tier: 'allow',
    reason: 'Read-only command with no side effects.',
    segment: segments[0],
  }

  for (const segment of segments) {
    const verdict = classifySegment(segment, userRules)
    if (TIER_RANK[verdict.tier] > TIER_RANK[worst.tier]) {
      worst = { ...verdict, segment }
    }
  }

  return {
    tier: worst.tier,
    reason:
      segments.length > 1 && worst.tier !== 'allow'
        ? `${worst.reason} (from segment: ${worst.segment})`
        : worst.reason,
    offendingSegment: worst.tier === 'allow' ? undefined : worst.segment,
    segments,
  }
}
