import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { GoogleAuthService } from '../../google/google-auth.service';
import type { RealtimeFunctionTool, Skill } from '../skill.interface';

/** Skill de Google Calendar: crear, listar, actualizar y borrar eventos. */
@Injectable()
export class GoogleCalendarSkill implements Skill {
  readonly name = 'google-calendar';

  constructor(
    private readonly googleAuthService: GoogleAuthService,
    private readonly configService: ConfigService,
  ) {}

  /** Declara las herramientas de calendario expuestas al modelo. */
  getTools(): RealtimeFunctionTool[] {
    return [
      {
        type: 'function',
        name: 'create_calendar_event',
        description:
          'Create a Google Calendar event in the primary calendar. Ask the user for title, date, start time, and duration if missing.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Event title' },
            start: {
              type: 'string',
              description: 'ISO 8601 start datetime with timezone offset',
            },
            end: {
              type: 'string',
              description: 'ISO 8601 end datetime with timezone offset',
            },
            description: { type: 'string', description: 'Optional notes' },
            location: { type: 'string', description: 'Optional location' },
          },
          required: ['title', 'start', 'end'],
        },
      },
      {
        type: 'function',
        name: 'list_calendar_events',
        description:
          'List upcoming Google Calendar events in the primary calendar within a time range.',
        parameters: {
          type: 'object',
          properties: {
            timeMin: {
              type: 'string',
              description: 'ISO 8601 lower bound (inclusive)',
            },
            timeMax: {
              type: 'string',
              description: 'ISO 8601 upper bound (exclusive)',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum events to return (default 10)',
            },
          },
        },
      },
      {
        type: 'function',
        name: 'update_calendar_event',
        description:
          'Update an existing calendar event. Use list_calendar_events first to obtain the eventId.',
        parameters: {
          type: 'object',
          properties: {
            eventId: { type: 'string', description: 'Google Calendar event ID' },
            title: { type: 'string' },
            start: { type: 'string', description: 'ISO 8601 start datetime' },
            end: { type: 'string', description: 'ISO 8601 end datetime' },
            description: { type: 'string' },
            location: { type: 'string' },
          },
          required: ['eventId'],
        },
      },
      {
        type: 'function',
        name: 'delete_calendar_event',
        description:
          'Delete a calendar event. Confirm with the user before deleting. Use list_calendar_events first to obtain the eventId.',
        parameters: {
          type: 'object',
          properties: {
            eventId: { type: 'string', description: 'Google Calendar event ID' },
          },
          required: ['eventId'],
        },
      },
    ];
  }

  /**
   * Indica si esta skill puede atender la herramienta indicada.
   *
   * @param toolName Nombre de la herramienta.
   */
  supports(toolName: string): boolean {
    return this.getTools().some((tool) => tool.name === toolName);
  }

  /**
   * Ejecuta una herramienta de calendario contra la API de Google.
   *
   * @param toolName Nombre de la herramienta.
   * @param args Argumentos deserializados que envió el modelo.
   */
  async execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const auth = await this.googleAuthService.getOAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });
    const timezone =
      this.configService.get<string>('app.timezone') ?? 'America/Mexico_City';

    switch (toolName) {
      case 'create_calendar_event': {
        const response = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: {
            summary: String(args.title),
            description: args.description ? String(args.description) : undefined,
            location: args.location ? String(args.location) : undefined,
            start: {
              dateTime: String(args.start),
              timeZone: timezone,
            },
            end: {
              dateTime: String(args.end),
              timeZone: timezone,
            },
          },
        });

        return {
          eventId: response.data.id,
          htmlLink: response.data.htmlLink,
          summary: response.data.summary,
          start: response.data.start?.dateTime,
          end: response.data.end?.dateTime,
        };
      }

      case 'list_calendar_events': {
        const now = new Date();
        const defaultMax = new Date(now);
        defaultMax.setDate(defaultMax.getDate() + 7);

        const response = await calendar.events.list({
          calendarId: 'primary',
          timeMin: args.timeMin ? String(args.timeMin) : now.toISOString(),
          timeMax: args.timeMax
            ? String(args.timeMax)
            : defaultMax.toISOString(),
          maxResults: args.maxResults ? Number(args.maxResults) : 10,
          singleEvents: true,
          orderBy: 'startTime',
        });

        return {
          events: (response.data.items ?? []).map((event) => ({
            eventId: event.id,
            title: event.summary,
            start: event.start?.dateTime ?? event.start?.date,
            end: event.end?.dateTime ?? event.end?.date,
            location: event.location,
            description: event.description,
          })),
        };
      }

      case 'update_calendar_event': {
        const eventId = String(args.eventId);
        const existing = await calendar.events.get({
          calendarId: 'primary',
          eventId,
        });

        const response = await calendar.events.update({
          calendarId: 'primary',
          eventId,
          requestBody: {
            ...existing.data,
            summary: args.title ? String(args.title) : existing.data.summary,
            description: args.description
              ? String(args.description)
              : existing.data.description,
            location: args.location
              ? String(args.location)
              : existing.data.location,
            start: args.start
              ? { dateTime: String(args.start), timeZone: timezone }
              : existing.data.start,
            end: args.end
              ? { dateTime: String(args.end), timeZone: timezone }
              : existing.data.end,
          },
        });

        return {
          eventId: response.data.id,
          summary: response.data.summary,
          start: response.data.start?.dateTime,
          end: response.data.end?.dateTime,
        };
      }

      case 'delete_calendar_event': {
        const eventId = String(args.eventId);
        await calendar.events.delete({
          calendarId: 'primary',
          eventId,
        });

        return { deleted: true, eventId };
      }

      default:
        throw new Error(`Unsupported calendar tool: ${toolName}`);
    }
  }
}
