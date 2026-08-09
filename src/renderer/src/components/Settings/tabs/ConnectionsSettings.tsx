import { useEffect, useState } from 'react'
import { useIPC } from '../../../hooks/useIPC'
import { Button } from '../../shared/Button'
import { ApiKeyField } from '../controls/ApiKeyField'

export function ConnectionsSettings() {
  const ipc = useIPC()
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean }>({ configured: false, connected: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    ipc?.google.getStatus().then(setStatus)
  }, [ipc])

  const refresh = async () => {
    if (ipc) setStatus(await ipc.google.getStatus())
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

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Google Account</p>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          Connects Calendar and Gmail tools. Requires a Google Cloud OAuth Client ID/Secret.
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
            {status.connected ? 'Connected — Calendar, Gmail' : 'Not connected'}
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
      {error && <p className="text-[11px]" style={{ color: 'var(--critical)' }}>{error}</p>}

      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        More integrations (future): each gets its own card here — add one entry to the registry, done.
      </p>
    </div>
  )
}
