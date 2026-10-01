import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import { Readable } from 'stream';
import { GoogleAuthService } from '../../google/google-auth.service';
import type { RealtimeFunctionTool, Skill } from '../skill.interface';

/** Skill de Google Drive: crear, listar, actualizar y borrar archivos. */
@Injectable()
export class GoogleDriveSkill implements Skill {
  readonly name = 'google-drive';

  constructor(private readonly googleAuthService: GoogleAuthService) {}

  /** Declara las herramientas de Drive expuestas al modelo. */
  getTools(): RealtimeFunctionTool[] {
    return [
      {
        type: 'function',
        name: 'create_drive_file',
        description:
          'Create a file in Google Drive. For text files, provide content; for metadata-only create, content is optional.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'File name' },
            mimeType: {
              type: 'string',
              description: 'MIME type, e.g. text/plain or application/json',
            },
            content: { type: 'string', description: 'Optional text content' },
            parentFolderId: {
              type: 'string',
              description: 'Optional parent folder ID',
            },
          },
          required: ['name'],
        },
      },
      {
        type: 'function',
        name: 'list_drive_files',
        description: 'List Google Drive files with optional query and page size.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Drive query syntax' },
            pageSize: {
              type: 'number',
              description: 'Maximum files to return (default 20)',
            },
          },
        },
      },
      {
        type: 'function',
        name: 'get_drive_file',
        description: 'Get one Google Drive file metadata by fileId.',
        parameters: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'Drive file ID' },
          },
          required: ['fileId'],
        },
      },
      {
        type: 'function',
        name: 'update_drive_file',
        description:
          'Update Google Drive file metadata and optionally replace text content.',
        parameters: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'Drive file ID' },
            name: { type: 'string', description: 'New file name' },
            mimeType: { type: 'string', description: 'New MIME type' },
            content: {
              type: 'string',
              description: 'Optional replacement text content',
            },
          },
          required: ['fileId'],
        },
      },
      {
        type: 'function',
        name: 'delete_drive_file',
        description:
          'Delete a Google Drive file by fileId. Confirm with user before deleting.',
        parameters: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'Drive file ID' },
          },
          required: ['fileId'],
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
   * Ejecuta una herramienta de Drive contra la API de Google.
   *
   * @param toolName Nombre de la herramienta.
   * @param args Argumentos deserializados que envió el modelo.
   */
  async execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const auth = await this.googleAuthService.getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    switch (toolName) {
      case 'create_drive_file': {
        const name = String(args.name);
        const mimeType = args.mimeType ? String(args.mimeType) : 'text/plain';
        const content = args.content ? String(args.content) : null;
        const parentFolderId = args.parentFolderId
          ? String(args.parentFolderId)
          : null;

        const response = await drive.files.create({
          requestBody: {
            name,
            mimeType,
            parents: parentFolderId ? [parentFolderId] : undefined,
          },
          media: content
            ? {
                mimeType,
                body: Readable.from([content]),
              }
            : undefined,
          fields: 'id,name,mimeType,webViewLink,parents',
        });

        return response.data;
      }

      case 'list_drive_files': {
        const response = await drive.files.list({
          q: args.query ? String(args.query) : undefined,
          pageSize: args.pageSize ? Number(args.pageSize) : 20,
          fields:
            'files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress),parents)',
          orderBy: 'modifiedTime desc',
        });

        return { files: response.data.files ?? [] };
      }

      case 'get_drive_file': {
        const response = await drive.files.get({
          fileId: String(args.fileId),
          fields:
            'id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress),parents,size',
        });

        return response.data;
      }

      case 'update_drive_file': {
        const fileId = String(args.fileId);
        const name = args.name ? String(args.name) : undefined;
        const mimeType = args.mimeType ? String(args.mimeType) : undefined;
        const content = args.content ? String(args.content) : null;

        const response = await drive.files.update({
          fileId,
          requestBody: {
            name,
            mimeType,
          },
          media: content
            ? {
                mimeType: mimeType ?? 'text/plain',
                body: Readable.from([content]),
              }
            : undefined,
          fields: 'id,name,mimeType,modifiedTime,webViewLink',
        });

        return response.data;
      }

      case 'delete_drive_file': {
        const fileId = String(args.fileId);
        await drive.files.delete({ fileId });
        return { deleted: true, fileId };
      }

      default:
        throw new Error(`Unsupported drive tool: ${toolName}`);
    }
  }
}
