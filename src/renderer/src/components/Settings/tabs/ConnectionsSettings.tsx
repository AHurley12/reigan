import { useEffect, useState } from 'react'
import { useIPC } from '../../../hooks/useIPC'
import { Button } from '../../shared/Button'
import { ApiKeyField } from '../controls/ApiKeyField'

type GoogleStatus = {
  configured: boolean
  connected: boolean
  grants: { youtube: boolean; gmail: boolean; calendar: boolean }
}

const GRANT_LABELS: Array<[keyof GoogleStatus['grants'], string]> = [
  ['calendar', 'Calendar'],
  ['gmail', 'Gmail'],
  ['youtube', 'YouTube'],
]

export function ConnectionsSettings() {
  const ipc = useIPC()
  const [status, setStatus] = useState<GoogleStatus>({
    configured: false,
    connected: false,
    grants: { youtube: false, gmail: false, calendar: false },
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Normalised at the boundary: getStatus() crosses an untyped IPC bridge, and
  // in `dev` the renderer can hot-reload against a main process that predates
  // `grants` — reading through would be a TypeError, not a stale label.
  const applyStatus = (s: Partial<GoogleStatus> | undefined) =>
    setStatus({
      configured: !!s?.configured,
      connected: !!s?.connected,
      grants: {
        youtube: !!s?.grants?.youtube,
        gmail: !!s?.grants?.gmail,
        calendar: !!s?.grants?.calendar,
      },
    })

  useEffect(() => {
    ipc?.google.getStatus().then(applyStatus)
  }, [ipc])

  const refresh = async () => {
    if (ipc) applyStatus(await ipc.google.getStatus())
  }

  const handleConnect = async () => {
    if (!ipc) return
    setBusy(true)
    setError('')
    const result = await ipc.google.connect()
    if (!result.connected && result.error) setError(result.error)
    await refresh()
    setBusy(false)
  }

  const handleDisconnect = async () => {
    if (!ipc) return
    setBusy(true)
    await ipc.google.disconnect()
    await refresh()
    setBusy(false)
  }

  const granted = GRANT_LABELS.filter(([k]) => status.grants[k]).map(([, label]) => label)
  const missing = GRANT_LABELS.filter(([k]) => !status.grants[k]).map(([, label]) => label)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Google Account</p>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          Connects Calendar, Gmail, and YouTube tools. Requires a Google Cloud OAuth Client ID/Secret.
        </p>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          Enable all four APIs in the same Cloud project as the OAuth client:{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            YouTube Data API v3, YouTube Analytics API, Gmail API, Google Calendar API
          </span>
          . The two YouTube APIs are separate entries — Data v3 alone leaves every stats call failing.
          Adding scopes later never upgrades an existing sign-in; disconnect and sign in again.
        </p>
        <div className="space-y-2">
          <ApiKeyField settingKey="googleClientId" placeholder="Google Client ID" masked={false} />
          <ApiKeyField settingKey="googleClientSecret" placeholder="Google Client Secret" />
        </div>
      </div>

      <div
        className="rounded-lg p-3 flex items-center justify-between"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: status.connected ? 'var(--active)' : 'var(--text-muted)' }}
          />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {status.connected
              ? granted.length
                ? `Connected — ${granted.join(', ')}`
                : 'Connected — no scopes granted'
              : 'Not connected'}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || (!status.connected && !status.configured)}
          onClick={status.connected ? handleDisconnect : handleConnect}
        >
          {status.connected ? 'Disconnect' : 'Sign in with Google'}
        </Button>
      </div>
      {status.connected && missing.length > 0 && (
        <p className="text-[11px]" style={{ color: 'var(--alert)' }}>
          This sign-in predates {missing.join(' and ')} — those tools fail with a permissions error, not a
          missing-API error, until you disconnect and sign in again.
        </p>
      )}
      {error && <p className="text-[11px]" style={{ color: 'var(--critical)' }}>{error}</p>}

      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        More integrations (future): each gets its own card here — add one entry to the registry, done.
      </p>
    </div>
  )
}
