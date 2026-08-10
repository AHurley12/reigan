import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { createServer, type Server } from 'http'
import { shell } from 'electron'
import { getSetting, setSetting, getDecodedSetting } from '../db/queries'

/**
 * One consent screen, one token store, for every Google surface the app uses.
 *
 * `youtube.upload` is deliberately absent until the Content Pipeline's publish
 * step exists — there is no reason to hold upload rights before anything can
 * upload.
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  // Required for metadata writes (titles, descriptions, tags).
  'https://www.googleapis.com/auth/youtube.force-ssl',
]

/**
 * Scopes that must never be requested, checked at module load.
 *
 * `gmail.send` is the one that matters: the mail automation creates drafts and
 * nothing else, and that guarantee is worth enforcing structurally rather than
 * trusting to review. If the scope is never granted, no bug — and no future
 * edit made in a hurry — can send mail on the user's behalf.
 */
const FORBIDDEN_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.compose',
]

for (const forbidden of FORBIDDEN_SCOPES) {
  if (SCOPES.includes(forbidden)) {
    throw new Error(
      `Refusing to start: "${forbidden}" is a forbidden scope. REIGAN creates Gmail drafts and never sends. ` +
        'If sending is genuinely wanted, that is a deliberate product decision — remove it from FORBIDDEN_SCOPES explicitly.'
    )
  }
}

/** Scope groups, so a feature can check what it actually needs before calling. */
export const SCOPE_GROUPS = {
  youtube: [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
    'https://www.googleapis.com/auth/youtube.force-ssl',
  ],
  gmail: ['https://www.googleapis.com/auth/gmail.modify'],
  calendar: ['https://www.googleapis.com/auth/calendar'],
} as const

const TOKENS_KEY = 'googleTokens'
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Manages the Google OAuth2 client used for Calendar + Gmail.
 *
 * Google retired the "oob" (copy-paste code) flow for new OAuth clients and
 * actively blocks embedded webviews for the consent screen, so sign-in uses
 * the recommended loopback pattern instead: a short-lived local HTTP server
 * plus the user's default browser.
 */
class GoogleAuthManager {
  private client: OAuth2Client | null = null

  private getClientCredentials(): { clientId: string; clientSecret: string } | null {
    const clientId = getDecodedSetting('googleClientId')
    const clientSecret = getDecodedSetting('googleClientSecret')
    if (!clientId || !clientSecret) return null
    return { clientId, clientSecret }
  }

  private buildClient(redirectUri: string): OAuth2Client | null {
    const creds = this.getClientCredentials()
    if (!creds) return null

    const client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri)
    const savedTokens = getSetting(TOKENS_KEY)
    if (savedTokens) {
      try {
        client.setCredentials(JSON.parse(savedTokens))
      } catch {
        // corrupt/legacy token blob — treat as signed out
      }
    }

    client.on('tokens', (tokens) => {
      const merged = { ...client.credentials, ...tokens }
      setSetting(TOKENS_KEY, JSON.stringify(merged))
    })

    return client
  }

  isConfigured(): boolean {
    return !!this.getClientCredentials()
  }

  isAuthenticated(): boolean {
    if (!this.client) this.client = this.buildClient('http://127.0.0.1')
    return !!(this.client?.credentials?.access_token || this.client?.credentials?.refresh_token)
  }

  /** Returns an authenticated client, or null if the user hasn't connected. */
  getClient(): OAuth2Client | null {
    if (!this.client) this.client = this.buildClient('http://127.0.0.1')
    return this.isAuthenticated() ? this.client : null
  }

  /** Scopes actually granted by the stored token, which may lag SCOPES after an upgrade. */
  grantedScopes(): string[] {
    const raw = getSetting(TOKENS_KEY)
    if (!raw) return []
    try {
      const scope = (JSON.parse(raw) as { scope?: string }).scope
      return scope ? scope.split(' ') : []
    } catch {
      return []
    }
  }

  /**
   * True when the stored grant covers a feature's scopes.
   *
   * Adding YouTube scopes to an existing install does not retroactively grant
   * them — the token predates them. Callers check this so the UI can say
   * "reconnect to enable YouTube" rather than surfacing an opaque 403.
   */
  hasScopes(group: keyof typeof SCOPE_GROUPS): boolean {
    const granted = new Set(this.grantedScopes())
    return SCOPE_GROUPS[group].every((s) => granted.has(s))
  }

  /** Scopes this build wants that the stored grant does not cover. */
  missingScopes(): string[] {
    const granted = new Set(this.grantedScopes())
    return SCOPES.filter((s) => !granted.has(s))
  }

  async connect(): Promise<void> {
    const creds = this.getClientCredentials()
    if (!creds) {
      throw new Error('Add a Google Client ID and Secret in Settings before connecting.')
    }

    const { server, port } = await this.listen()
    const redirectUri = `http://127.0.0.1:${port}/oauth2callback`
    const client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri)

    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    })

    const codePromise = this.waitForCode(server, redirectUri)
    await shell.openExternal(authUrl)
    const code = await codePromise

    const { tokens } = await client.getToken(code)
    client.setCredentials(tokens)
    client.on('tokens', (t) => {
      const merged = { ...client.credentials, ...t }
      setSetting(TOKENS_KEY, JSON.stringify(merged))
    })
    setSetting(TOKENS_KEY, JSON.stringify(tokens))
    this.client = client
  }

  disconnect(): void {
    this.client = null
    setSetting(TOKENS_KEY, '')
  }

  private waitForCode(server: Server, redirectUri: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.close()
        reject(new Error('Google sign-in timed out.'))
      }, CONNECT_TIMEOUT_MS)

      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri)
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          error
            ? '<html><body>Google sign-in failed. You can close this tab and return to Shingan.</body></html>'
            : '<html><body>Shingan is connected. You can close this tab.</body></html>'
        )

        clearTimeout(timeout)
        server.close()

        if (error) reject(new Error(error))
        else if (code) resolve(code)
        else reject(new Error('Google did not return an authorization code.'))
      })
    })
  }

  private listen(): Promise<{ server: Server; port: number }> {
    return new Promise((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          resolve({ server, port: address.port })
        } else {
          reject(new Error('Failed to start local OAuth listener.'))
        }
      })
    })
  }
}

export const googleAuth = new GoogleAuthManager()

/**
 * True when `err` is Google's "invalid_grant" response — the stored refresh
 * token was revoked or expired (common for OAuth clients left in "Testing"
 * status, where Google kills refresh tokens after 7 days). Callers should
 * treat this the same as "never connected" rather than surfacing a raw
 * network error.
 */
export function isInvalidGrantError(err: unknown): boolean {
  const data = (err as { response?: { data?: { error?: string } } })?.response?.data
  if (data?.error === 'invalid_grant') return true
  // The googleapis client sometimes surfaces it only in the message.
  const message = (err as Error)?.message ?? ''
  return message.includes('invalid_grant')
}

/** Raised when the grant dies, so the user learns from a notification rather than an empty tab. */
let reauthNotifier: ((message: string) => void) | null = null

export function setReauthNotifier(fn: (message: string) => void): void {
  reauthNotifier = fn
}

/**
 * Central handling for a dead refresh token.
 *
 * This OAuth client is in **Testing** publishing status, where Google expires
 * refresh tokens after 7 days. That is a deliberate, acknowledged choice, so the
 * job engine must not treat the weekly death as a mysterious failure: every
 * scheduled Google job routes its `invalid_grant` here, which raises one clear
 * "reconnect your Google account" notification instead of N cryptic ones.
 *
 * Switching the client to Production in Google Cloud Console makes refresh
 * tokens durable and renders this path near-dead. See docs/AUTOMATIONS_AUDIT.md.
 */
export function handleInvalidGrant(context: string): string {
  const message =
    `Google sign-in expired (${context}). Reconnect your Google account in Settings. ` +
    'This happens weekly while the OAuth client is in "Testing" status — switching it to ' +
    'Production in Google Cloud Console stops it.'
  reauthNotifier?.(message)
  return message
}
