import { API_BASE_URL, jsonRequest, parseJson } from './http';

export type HouseholdRole = 'owner' | 'resident';

export type HouseholdMemberDto = {
  id: number;
  name: string;
  role: HouseholdRole;
  notes: string | null;
};

export type HouseholdMemberInput = {
  name: string;
  role: HouseholdRole;
  notes?: string | null;
};

export async function listHousehold(): Promise<HouseholdMemberDto[]> {
  return parseJson(await fetch(`${API_BASE_URL}/household`));
}

export async function createHouseholdMember(
  input: HouseholdMemberInput,
): Promise<HouseholdMemberDto> {
  return parseJson(
    await fetch(`${API_BASE_URL}/household`, jsonRequest('POST', input)),
  );
}

export async function updateHouseholdMember(
  id: number,
  input: Partial<HouseholdMemberInput>,
): Promise<HouseholdMemberDto> {
  return parseJson(
    await fetch(`${API_BASE_URL}/household/${id}`, jsonRequest('PATCH', input)),
  );
}

export async function deleteHouseholdMember(id: number): Promise<void> {
  await parseJson(
    await fetch(`${API_BASE_URL}/household/${id}`, { method: 'DELETE' }),
  );
}
