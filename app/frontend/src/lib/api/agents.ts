import { API_BASE_URL, jsonRequest, parseJson } from './http';

export type AgentDto = {
  id: number;
  slug: string;
  name: string;
  purpose: string;
  systemPrompt: string;
  status: 'active' | 'inactive';
  updatedAt: string;
};

export async function listAgents(): Promise<AgentDto[]> {
  return parseJson(await fetch(`${API_BASE_URL}/agents`));
}

export async function updateAgent(
  slug: string,
  input: Partial<Pick<AgentDto, 'name' | 'purpose' | 'systemPrompt' | 'status'>>,
): Promise<AgentDto> {
  return parseJson(
    await fetch(`${API_BASE_URL}/agents/${slug}`, jsonRequest('PATCH', input)),
  );
}

export async function resetAgent(slug: string): Promise<AgentDto> {
  return parseJson(
    await fetch(`${API_BASE_URL}/agents/${slug}/reset`, { method: 'POST' }),
  );
}
