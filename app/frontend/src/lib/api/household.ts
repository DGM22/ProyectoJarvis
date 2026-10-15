import { API_BASE_URL, jsonRequest, parseJson } from './http';

export type HouseholdRole = 'owner' | 'resident';

export type HouseholdMemberDto = {
  id: number;
  name: string;
  role: HouseholdRole;
  notes: string | null;
  hasFacePhoto: boolean;
  facePhotoUpdatedAt: string | null;
};

/** Límite de AWS Rekognition para imágenes enviadas como bytes. */
export const FACE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

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

/** Foto de referencia para que el timbre verifique la cara (JPEG o PNG). */
export async function uploadFacePhoto(
  id: number,
  file: File,
): Promise<HouseholdMemberDto> {
  return parseJson(
    await fetch(`${API_BASE_URL}/household/${id}/face-photo`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    }),
  );
}

export async function deleteFacePhoto(id: number): Promise<HouseholdMemberDto> {
  return parseJson(
    await fetch(`${API_BASE_URL}/household/${id}/face-photo`, {
      method: 'DELETE',
    }),
  );
}

/** URL de la foto; `version` evita que el navegador muestre una vieja. */
export function facePhotoUrl(id: number, version: string | null): string {
  const query = version ? `?v=${encodeURIComponent(version)}` : '';
  return `${API_BASE_URL}/household/${id}/face-photo${query}`;
}
