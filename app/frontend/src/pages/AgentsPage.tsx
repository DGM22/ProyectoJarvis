import { AgentsList } from '@/components/AgentsList';

export function AgentsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-title text-text-hi">Agentes</h1>
        <p className="mt-2 text-body text-text-mid">
          El timbre atiende a quien toca la puerta y, cuando hace falta una
          decisión, llama a Seguridad para hablar contigo en la web.
        </p>
      </header>

      <AgentsList />
    </div>
  );
}
