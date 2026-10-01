import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import { GoogleAuthService } from '../../google/google-auth.service';
import type { RealtimeFunctionTool, Skill } from '../skill.interface';

/** Skill de Google Tasks: crear, consultar, completar y borrar tareas. */
@Injectable()
export class GoogleTasksSkill implements Skill {
  readonly name = 'google-tasks';

  constructor(private readonly googleAuthService: GoogleAuthService) {}

  /** Declara las herramientas de tareas expuestas al modelo. */
  getTools(): RealtimeFunctionTool[] {
    return [
      {
        type: 'function',
        name: 'create_task',
        description:
          'Create a Google Tasks item in the default task list. Ask for title and optional due date if missing.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Task title' },
            notes: { type: 'string', description: 'Optional notes' },
            due: {
              type: 'string',
              description: 'Optional RFC3339 due date (date portion is enough)',
            },
          },
          required: ['title'],
        },
      },
      {
        type: 'function',
        name: 'list_tasks',
        description:
          'List tasks from the default Google Tasks list, optionally including completed tasks.',
        parameters: {
          type: 'object',
          properties: {
            showCompleted: {
              type: 'boolean',
              description: 'Include completed tasks (default false)',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum tasks to return (default 20)',
            },
          },
        },
      },
      {
        type: 'function',
        name: 'get_task',
        description:
          'Get details of one task by taskId from the default Google Tasks list.',
        parameters: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Google Tasks task ID' },
          },
          required: ['taskId'],
        },
      },
      {
        type: 'function',
        name: 'update_task',
        description:
          'Update task title, notes, and due date. Use list_tasks first to obtain the taskId.',
        parameters: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Google Tasks task ID' },
            title: { type: 'string', description: 'New title' },
            notes: { type: 'string', description: 'New notes' },
            due: { type: 'string', description: 'New RFC3339 due date' },
            status: {
              type: 'string',
              description: 'Task status: needsAction or completed',
            },
          },
          required: ['taskId'],
        },
      },
      {
        type: 'function',
        name: 'complete_task',
        description:
          'Mark a task as completed. Use list_tasks first to obtain the taskId.',
        parameters: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Google Tasks task ID' },
          },
          required: ['taskId'],
        },
      },
      {
        type: 'function',
        name: 'delete_task',
        description:
          'Delete a task. Confirm with the user before deleting. Use list_tasks first to obtain the taskId.',
        parameters: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Google Tasks task ID' },
          },
          required: ['taskId'],
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
   * Ejecuta una herramienta de tareas contra la API de Google.
   *
   * @param toolName Nombre de la herramienta.
   * @param args Argumentos deserializados que envió el modelo.
   */
  async execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const auth = await this.googleAuthService.getOAuthClient();
    const tasks = google.tasks({ version: 'v1', auth });
    const taskListId = '@default';

    switch (toolName) {
      case 'create_task': {
        const response = await tasks.tasks.insert({
          tasklist: taskListId,
          requestBody: {
            title: String(args.title),
            notes: args.notes ? String(args.notes) : undefined,
            due: args.due ? String(args.due) : undefined,
          },
        });

        return {
          taskId: response.data.id,
          title: response.data.title,
          due: response.data.due,
          status: response.data.status,
        };
      }

      case 'list_tasks': {
        const response = await tasks.tasks.list({
          tasklist: taskListId,
          showCompleted: Boolean(args.showCompleted ?? false),
          maxResults: args.maxResults ? Number(args.maxResults) : 20,
        });

        return {
          tasks: (response.data.items ?? []).map((task) => ({
            taskId: task.id,
            title: task.title,
            due: task.due,
            status: task.status,
            notes: task.notes,
          })),
        };
      }

      case 'get_task': {
        const taskId = String(args.taskId);
        const response = await tasks.tasks.get({
          tasklist: taskListId,
          task: taskId,
        });

        return {
          taskId: response.data.id,
          title: response.data.title,
          due: response.data.due,
          status: response.data.status,
          notes: response.data.notes,
        };
      }

      case 'update_task': {
        const taskId = String(args.taskId);
        const response = await tasks.tasks.patch({
          tasklist: taskListId,
          task: taskId,
          requestBody: {
            title: args.title ? String(args.title) : undefined,
            notes: args.notes ? String(args.notes) : undefined,
            due: args.due ? String(args.due) : undefined,
            status: args.status ? String(args.status) : undefined,
          },
        });

        return {
          taskId: response.data.id,
          title: response.data.title,
          due: response.data.due,
          status: response.data.status,
        };
      }

      case 'complete_task': {
        const taskId = String(args.taskId);
        const response = await tasks.tasks.patch({
          tasklist: taskListId,
          task: taskId,
          requestBody: {
            status: 'completed',
          },
        });

        return {
          taskId: response.data.id,
          title: response.data.title,
          status: response.data.status,
        };
      }

      case 'delete_task': {
        const taskId = String(args.taskId);
        await tasks.tasks.delete({
          tasklist: taskListId,
          task: taskId,
        });

        return { deleted: true, taskId };
      }

      default:
        throw new Error(`Unsupported tasks tool: ${toolName}`);
    }
  }
}
