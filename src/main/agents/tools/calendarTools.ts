import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { google, calendar_v3 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

const TIMEZONE = 'America/New_York'

function formatTime(iso: string): string {
  if (!iso) return 'unknown'
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIMEZONE,
  })
}

export function createCalendarTools(auth: OAuth2Client): DynamicStructuredTool[] {
  const calendar = google.calendar({ version: 'v3', auth })

  const listEvents = new DynamicStructuredTool({
    name: 'list_calendar_events',
    description:
      'List upcoming events from the user\'s Google Calendar. Use this when the user asks "what\'s on my schedule", "do I have anything today", "what\'s coming up this week", etc.',
    schema: z.object({
      startDate: z.string().optional().describe('ISO 8601 start date. Defaults to now.'),
      endDate: z.string().optional().describe('ISO 8601 end date. Defaults to 7 days from now.'),
      maxResults: z.number().optional().describe('Max events to return. Default 10.'),
    }),
    func: async ({ startDate, endDate, maxResults }) => {
      const now = new Date()
      const start = startDate || now.toISOString()
      const end = endDate || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: start,
        timeMax: end,
        maxResults: maxResults || 10,
        singleEvents: true,
        orderBy: 'startTime',
        timeZone: TIMEZONE,
      })

      const events = response.data.items || []
      if (events.length === 0) return 'No events found in this time range.'

      return events
        .map((e) => {
          const s = e.start?.dateTime || e.start?.date || ''
          const en = e.end?.dateTime || e.end?.date || ''
          return `- ${e.summary} | ${formatTime(s)} → ${formatTime(en)}`
        })
        .join('\n')
    },
  })

  const createEvent = new DynamicStructuredTool({
    name: 'create_calendar_event',
    description:
      'Create a new event on the user\'s Google Calendar. Use when the user says "schedule", "add to my calendar", "book time for", etc.',
    schema: z.object({
      title: z.string().describe('Event title'),
      startTime: z.string().describe('ISO 8601 start time'),
      endTime: z.string().describe('ISO 8601 end time'),
      description: z.string().optional().describe('Event description'),
      location: z.string().optional().describe('Event location'),
    }),
    func: async ({ title, startTime, endTime, description, location }) => {
      const event: calendar_v3.Schema$Event = {
        summary: title,
        description,
        location,
        start: { dateTime: startTime, timeZone: TIMEZONE },
        end: { dateTime: endTime, timeZone: TIMEZONE },
      }

      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      })

      return `Event created: "${response.data.summary}" on ${formatTime(response.data.start?.dateTime || '')}`
    },
  })

  const deleteEvent = new DynamicStructuredTool({
    name: 'delete_calendar_event',
    description: 'Delete an event from the calendar by its event ID.',
    schema: z.object({
      eventId: z.string().describe('The Google Calendar event ID to delete'),
    }),
    func: async ({ eventId }) => {
      await calendar.events.delete({ calendarId: 'primary', eventId })
      return 'Event deleted successfully.'
    },
  })

  return [listEvents, createEvent, deleteEvent]
}
