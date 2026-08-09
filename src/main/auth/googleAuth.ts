import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { createServer, type Server } from 'http'
import { shell } from 'electron'
import { getSetting, setSetting, getDecodedSetting } from '../db/queries'

const SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/gmail.modify']

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
  return data?.error === 'invalid_grant'
}
