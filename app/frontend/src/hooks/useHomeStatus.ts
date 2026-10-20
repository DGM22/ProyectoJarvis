import { useCallback, useEffect, useState } from 'react';
import { getAttention, type AttentionSettings } from '@/lib/api/attention';
import { listDevices, type DeviceDto } from '@/lib/api/devices';
import { fetchVisitSummary, type VisitSummary } from '@/lib/api/interactions';

const REFRESH_MS = 15_000;

export interface HomeStatus {
  devices: DeviceDto[];
  /** Al menos un dispositivo conectado (voz o cámara). */
  doorOnline: boolean;
  attention: AttentionSettings | null;
  summary: VisitSummary | null;
  loading: boolean;
}

/** Estado de la casa para el inicio; se refresca solo. Cada dato falla por separado. */
export function useHomeStatus(): HomeStatus & { refresh: () => Promise<void> } {
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [attention, setAttention] = useState<AttentionSettings | null>(null);
  const [summary, setSummary] = useState<VisitSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [devicesResult, attentionResult, summaryResult] = await Promise.allSettled([
      listDevices(),
      getAttention(),
      fetchVisitSummary(),
    ]);
    if (devicesResult.status === 'fulfilled') setDevices(devicesResult.value);
    if (attentionResult.status === 'fulfilled') setAttention(attentionResult.value);
    if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  return {
    devices,
    doorOnline: devices.some((device) => device.online || device.cameraOnline),
    attention,
    summary,
    loading,
    refresh,
  };
}
