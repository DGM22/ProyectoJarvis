import { API_BASE_URL, apiFetch, parseJson } from './http';

export type HistoryFilter = 'all' | 'ai' | 'owner' | 'recognized' | 'missed';

export interface VisitHistoryItem {
  id: number;
  occurredAt: string;
  reason: string | null;
  handledByAi: boolean;
  deviceName: string;
  transcript: string | null;
  consultId: string | null;
  recognition: { recognized: boolean; personName: string | null; confidence: number | null } | null;
  notifications: Array<{
    personName: string;
    response: 'open' | 'ignore' | 'expired' | null;
    respondedAt: string | null;
  }>;
  aiResponses: number;
  errors: number;
}

export interface VisitSummary {
  total: number;
  byAi: number;
  byOwner: number;
  missed: number;
  lastVisitAt: string | null;
}

export async function fetchVisitSummary(): Promise<VisitSummary> {
  return parseJson(await apiFetch(`${API_BASE_URL}/interactions/summary`));
}

export async function fetchVisitHistory(options: {
  filter: HistoryFilter;
  before?: number;
  limit?: number;
}): Promise<VisitHistoryItem[]> {
  const query = new URLSearchParams({
    filter: options.filter,
    limit: String(options.limit ?? 20),
  });
  if (options.before !== undefined) query.set('before', String(options.before));
  return parseJson(await apiFetch(`${API_BASE_URL}/interactions?${query.toString()}`));
}
