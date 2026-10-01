/** Convierte la base HTTP del API a WebSocket (http→ws, https→wss). */
export function deriveWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, 'ws');
}
