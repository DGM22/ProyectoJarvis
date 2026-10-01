import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import { GoogleAuthService } from '../../google/google-auth.service';
import type { RealtimeFunctionTool, Skill } from '../skill.interface';

function toBase64Url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseHeaders(headers: Array<{ name?: string | null; value?: string | null }> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers ?? []) {
    if (h.name && h.value) {
      out[h.name.toLowerCase()] = h.value;
    }
  }
  return out;
}

/** Skill de Gmail: leer la bandeja, redactar borradores y borrar correos. */
@Injectable()
export class GoogleGmailSkill implements Skill {
  readonly name = 'google-gmail';

  constructor(private readonly googleAuthService: GoogleAuthService) {}

  /** Declara las herramientas de Gmail expuestas al modelo. */
  getTools(): RealtimeFunctionTool[] {
    return [
      {
        type: 'function',
        name: 'list_gmail_messages',
        description:
          'List Gmail messages in the inbox or by query. Use this before reading or deleting a message.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Gmail query syntax, e.g. from:foo has:attachment newer_than:7d',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum messages to return (default 10)',
            },
          },
        },
      },
      {
        type: 'function',
        name: 'get_gmail_message',
        description: 'Read one Gmail message metadata and snippet by messageId.',
        parameters: {
          type: 'object',
          properties: {
            messageId: { type: 'string', description: 'Gmail message ID' },
          },
          required: ['messageId'],
        },
      },
      {
        type: 'function',
        name: 'create_gmail_draft',
        description: 'Create a Gmail draft message.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email' },
            subject: { type: 'string', description: 'Subject line' },
            body: { type: 'string', description: 'Message body text' },
            cc: { type: 'string', description: 'Optional CC emails comma-separated' },
            bcc: { type: 'string', description: 'Optional BCC emails comma-separated' },
          },
          required: ['to', 'subject', 'body'],
        },
      },
      {
        type: 'function',
        name: 'update_gmail_draft',
        description: 'Update an existing Gmail draft by draftId.',
        parameters: {
          type: 'object',
          properties: {
            draftId: { type: 'string', description: 'Draft ID' },
            to: { type: 'string', description: 'Recipient email' },
            subject: { type: 'string', description: 'Subject line' },
            body: { type: 'string', description: 'Message body text' },
            cc: { type: 'string', description: 'Optional CC emails comma-separated' },
            bcc: { type: 'string', description: 'Optional BCC emails comma-separated' },
          },
          required: ['draftId', 'to', 'subject', 'body'],
        },
      },
      {
        type: 'function',
        name: 'delete_gmail_message',
        description:
          'Delete a Gmail message permanently by messageId. Confirm with user before deleting.',
        parameters: {
          type: 'object',
          properties: {
            messageId: { type: 'string', description: 'Gmail message ID' },
          },
          required: ['messageId'],
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
   * Ejecuta una herramienta de Gmail contra la API de Google.
   *
   * @param toolName Nombre de la herramienta.
   * @param args Argumentos deserializados que envió el modelo.
   */
  async execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const auth = await this.googleAuthService.getOAuthClient();
    const gmail = google.gmail({ version: 'v1', auth });

    switch (toolName) {
      case 'list_gmail_messages': {
        const list = await gmail.users.messages.list({
          userId: 'me',
          q: args.query ? String(args.query) : undefined,
          maxResults: args.maxResults ? Number(args.maxResults) : 10,
        });

        const ids = list.data.messages?.map((m) => m.id).filter(Boolean) ?? [];
        const messages = await Promise.all(
          ids.map(async (id) => {
            const full = await gmail.users.messages.get({
              userId: 'me',
              id: String(id),
              format: 'metadata',
              metadataHeaders: ['From', 'To', 'Subject', 'Date'],
            });
            const headers = parseHeaders(full.data.payload?.headers);
            return {
              messageId: full.data.id,
              threadId: full.data.threadId,
              from: headers.from,
              to: headers.to,
              subject: headers.subject,
              date: headers.date,
              snippet: full.data.snippet,
            };
          }),
        );

        return { messages };
      }

      case 'get_gmail_message': {
        const response = await gmail.users.messages.get({
          userId: 'me',
          id: String(args.messageId),
          format: 'full',
        });

        const headers = parseHeaders(response.data.payload?.headers);
        return {
          messageId: response.data.id,
          threadId: response.data.threadId,
          from: headers.from,
          to: headers.to,
          subject: headers.subject,
          date: headers.date,
          snippet: response.data.snippet,
          labelIds: response.data.labelIds,
        };
      }

      case 'create_gmail_draft': {
        const raw = this.buildRawEmail(args);
        const response = await gmail.users.drafts.create({
          userId: 'me',
          requestBody: {
            message: { raw },
          },
        });

        return {
          draftId: response.data.id,
          messageId: response.data.message?.id,
        };
      }

      case 'update_gmail_draft': {
        const draftId = String(args.draftId);
        const raw = this.buildRawEmail(args);
        const response = await gmail.users.drafts.update({
          userId: 'me',
          id: draftId,
          requestBody: {
            id: draftId,
            message: { raw },
          },
        });

        return {
          draftId: response.data.id,
          messageId: response.data.message?.id,
        };
      }

      case 'delete_gmail_message': {
        const messageId = String(args.messageId);
        await gmail.users.messages.delete({
          userId: 'me',
          id: messageId,
        });

        return { deleted: true, messageId };
      }

      default:
        throw new Error(`Unsupported gmail tool: ${toolName}`);
    }
  }

  /**
   * Arma el mensaje RFC 2822 en base64url que espera la API de Gmail.
   *
   * @param args Argumentos con destinatario, asunto y cuerpo.
   */
  private buildRawEmail(args: Record<string, unknown>): string {
    const to = String(args.to);
    const subject = String(args.subject);
    const body = String(args.body);
    const cc = args.cc ? `Cc: ${String(args.cc)}\r\n` : '';
    const bcc = args.bcc ? `Bcc: ${String(args.bcc)}\r\n` : '';

    const raw = [
      `To: ${to}`,
      cc.trimEnd(),
      bcc.trimEnd(),
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      body,
    ]
      .filter(Boolean)
      .join('\r\n');

    return toBase64Url(raw);
  }
}
