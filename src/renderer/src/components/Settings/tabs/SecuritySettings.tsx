import { useState } from 'react'
import { SettingRow } from '../controls/SettingRow'
import { Select } from '../controls/Select'
import { useAuthStore } from '../../../stores/authStore'
import { useToastStore } from '../../../stores/toastStore'
import { EnrollmentFlow } from '../../Lock/EnrollmentFlow'

/**
 * Voice-unlock settings, and the primary entry point for enrolment.
 *
 * Enrolment has to live here rather than only on the lock screen: the app
 * refuses to lock until a voiceprint exists (locking with no credential would
 * be an unrecoverable lockout), so an un-enrolled user never meets the lock
 * screen at all. The lock screen keeps its own enrolment path as a fallback
 * for the degenerate locked-but-unenrolled case.
 */

const IDLE_OPTIONS = [
  { value: '60000', label: '1 minute' },
  { value: '300000', label: '5 minutes' },
  { value: '600000', label: '10 minutes' },
  { value: '1800000', label: '30 minutes' },
  { value: '3600000', label: '1 hour' },
  { value: '0', label: 'Never' },
]

export function SecuritySettings() {
  const status = useAuthStore((s) => s.status)
  const hydrate = useAuthStore((s) => s.hydrate)
  const enrolling = useAuthStore((s) => s.enrolling)
  const setEnrolling = useAuthStore((s) => s.setEnrolling)
  const toast = useToastStore((s) => s.push)
  const [confirming, setConfirming] = useState(false)

  const enrolled = status?.enrolled ?? false

  const changeTimeout = async (value: string): Promise<void> => {
    try {
      await window.reigan.auth.setIdleTimeout(Number(value))
      await hydrate()
    } catch {
      toast('Could not change the auto-lock timeout.', 'warning')
    }
  }

  const reset = async (): Promise<void> => {
    try {
      await window.reigan.auth.reset()
      await hydrate()
      setConfirming(false)
      toast('Voiceprint deleted. Voice unlock is off.', 'info')
    } catch {
      toast('Could not delete the voiceprint.', 'warning')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
          Voice unlock
        </p>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          {enrolled
            ? 'A voiceprint is enrolled on this device. It is encrypted at rest and never leaves the machine.'
            : 'Not set up. Until you enrol, Shingan never locks — there would be no way back in.'}
        </p>
        {!enrolled && (
          <button
            onClick={() => setEnrolling(true)}
            className="px-3 py-1.5 rounded-md text-xs"
            style={{ background: 'var(--reigan-primary)', color: 'var(--bg-void)' }}
          >
            Set up voice unlock…
          </button>
        )}
        {enrolled && status?.keyBackend === 'device-file' && (
          <p className="text-xs mb-2" style={{ color: 'var(--critical)' }}>
            No OS keychain is available here, so the encryption key sits in a permission-restricted
            file instead. Weaker than the keychain — anyone with your OS account can read it.
          </p>
        )}
        {status?.voiceprintUnreadable && (
          <p className="text-xs mb-2" style={{ color: 'var(--critical)' }}>
            The stored voiceprint cannot be decrypted on this machine. Sign in with your recovery
            passphrase and re-enrol.
          </p>
        )}
      </div>

      {enrolled && (
        <div>
          <SettingRow
            label="Auto-lock after"
            labelJa="自動施錠"
            description="Idle time before Shingan locks itself. Activity anywhere in the app resets the countdown."
            last
          >
            <Select
              value={String(status?.idleTimeoutMs ?? 600000)}
              options={IDLE_OPTIONS}
              onChange={(v) => void changeTimeout(v)}
            />
          </SettingRow>
        </div>
      )}

      {enrolled && (
        <div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            Delete voiceprint
          </p>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            Removes the voiceprint, the recovery passphrase and the encryption key. Voice unlock
            turns off and the app stops locking. This cannot be undone.
          </p>
          {confirming ? (
            <div className="flex gap-2">
              <button
                onClick={() => void reset()}
                className="px-3 py-1.5 rounded-md text-xs"
                style={{ background: 'var(--critical)', color: 'var(--bg-void)' }}
              >
                Delete permanently
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="px-3 py-1.5 rounded-md text-xs"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="px-3 py-1.5 rounded-md text-xs"
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              Delete voiceprint…
            </button>
          )}
        </div>
      )}

      {/* Enrolment runs as an overlay here because an un-enrolled user never
          meets the lock screen — the app deliberately stays unlocked until a
          credential exists. LazyMotion comes from LockGate, which wraps the
          whole shell including this panel. */}
      {enrolling && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center"
          style={{ background: 'var(--surface-scrim)' }}
        >
          <EnrollmentFlow onClose={() => setEnrolling(false)} />
        </div>
      )}
    </div>
  )
}
