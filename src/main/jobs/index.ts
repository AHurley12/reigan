import { Notification, type BrowserWindow } from 'electron'
import { onQueuedApprovalGranted } from '../capabilities/ipc'
import { setReauthNotifier } from '../auth/googleAuth'
import { seedSystemJobs } from './seed'
import { resumeApprovedRun, setJobNotifier, startScheduler } from './scheduler'
import { findRunByApprovalId } from './store'

export const JOB_NOTIFICATION_CHANNEL = 'jobs:notification'

/**
 * Boots the job engine and connects it to the surfaces it needs.
 *
 * Notification delivery here is deliberately minimal — a native toast for urgent
 * events and an in-app message for the rest. Phase 6 replaces this with the
 * persistent digest store; until then a disabled automation must still be able
 * to tell someone, because silent permanent failure is the worst outcome the
 * scheduler can produce.
 */
export function initJobEngine(win: BrowserWindow): void {
  seedSystemJobs()

  // The OAuth client is in Testing status, where Google expires refresh tokens
  // after 7 days. Routing every invalid_grant through one notifier means the
  // weekly death reads as "reconnect your Google account" rather than as a
  // string of unrelated failures across YouTube, Mail and Calendar.
  setReauthNotifier((message) => {
    if (!win.isDestroyed()) {
      win.webContents.send(JOB_NOTIFICATION_CHANNEL, {
        priority: 'urgent',
        title: 'Google sign-in expired',
        body: message,
        jobId: '',
      })
    }
    if (Notification.isSupported()) {
      new Notification({ title: 'Google sign-in expired', body: message }).show()
    }
  })

  setJobNotifier((event) => {
    if (!win.isDestroyed()) {
      win.webContents.send(JOB_NOTIFICATION_CHANNEL, event)
    }

    // Only urgent events break through to the OS. Everything else waits to be
    // seen in the app — the same batching rule Phase 6's digest formalises.
    if (event.priority === 'urgent' && Notification.isSupported()) {
      new Notification({ title: event.title, body: event.body }).show()
    }
  })

  // A run parked on approval resumes when the user grants it, rather than being
  // lost. The scheduler has already moved that job's `next_run_at` forward, so
  // this is a one-off execution and not a reschedule.
  onQueuedApprovalGranted((approvalId) => {
    const run = findRunByApprovalId(approvalId)
    if (run) void resumeApprovedRun(run.jobId)
  })

  startScheduler()
}
