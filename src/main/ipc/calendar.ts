import { ipcMain } from 'electron'
import { google } from 'googleapis'
import { IPC, type CalendarEvent } from '../../shared/types'
import { googleAuth } from '../auth/googleAuth'

export function registerCalendarHandlers(): void {
  ipcMain.handle(IPC.CALENDAR_LIST_EVENTS, async (_event, params: { startDate: string; endDate: string }) => {
    const client = googleAuth.getClient()
    if (!client) return { connected: false, events: [] as CalendarEvent[] }

    const calendar = google.calendar({ version: 'v3', auth: client })
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: params.startDate,
      timeMax: params.endDate,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      timeZone: 'America/New_York',
    })

    const events: CalendarEvent[] = (response.data.items || [])
      .filter((e) => e.status !== 'cancelled')
      .map((e) => ({
        id: e.id || '',
        title: e.summary || '(no title)',
        description: e.description ?? undefined,
        location: e.location ?? undefined,
        start: e.start?.dateTime || e.start?.date || '',
        end: e.end?.dateTime || e.end?.date || '',
        allDay: !e.start?.dateTime,
      }))

    return { connected: true, events }
  })
}
