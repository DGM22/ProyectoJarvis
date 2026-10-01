import { useActivityLog } from '@/hooks/useActivityLog';
import { ActivityCard } from './ActivityCard';

export function ActivityFeed() {
  const { entries, loading } = useActivityLog();

  if (loading) {
    return (
      <div className="py-8 text-center text-body text-text-low">
        Cargando actividad...
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="py-8 text-center text-body text-text-low">
        Jarvis aún no ha hecho nada. Empieza una llamada para pedirle algo.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => (
        <ActivityCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
