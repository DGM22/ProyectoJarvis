import { useEffect, useState } from 'react';
import { Alert } from '@/components/Alert';
import { useAgents } from '@/hooks/useAgents';
import { resetAgent, updateAgent, type AgentDto } from '@/lib/api/agents';

function AgentCard({
  agent,
  onSaved,
}: {
  agent: AgentDto;
  onSaved: () => void;
}) {
  const [prompt, setPrompt] = useState(agent.systemPrompt);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPrompt(agent.systemPrompt);
  }, [agent.systemPrompt]);

  const dirty = prompt.trim() !== agent.systemPrompt.trim();

  const run = async (action: () => Promise<AgentDto>, okText: string) => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await action();
      setMessage(okText);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-body font-medium text-text-hi">{agent.name}</h3>
          <p className="mt-1 font-mono text-xs text-accent-400">{agent.slug}</p>
        </div>
        <span className="rounded-full bg-accent-wash px-2.5 py-1 text-xs text-accent-400">
          {agent.status === 'active' ? 'activo' : 'inactivo'}
        </span>
      </div>
      <p className="mt-3 text-body text-text-mid">{agent.purpose}</p>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-mono text-text-low">Personalidad (prompt)</span>
        <textarea
          value={prompt}
          disabled={saving}
          rows={6}
          onChange={(e) => setPrompt(e.target.value)}
          className="rounded-lg border border-border bg-overlay px-3 py-2 text-sm leading-relaxed text-text-hi outline-none focus:border-accent-400"
        />
      </label>
      <p className="mt-1.5 text-xs text-text-low">
        Las reglas del flujo (llamar al dueño, transmitir su respuesta) se añaden
        siempre; aquí solo cambias tono y estilo.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving || !dirty || !prompt.trim()}
          onClick={() => {
            void run(
              () => updateAgent(agent.slug, { systemPrompt: prompt }),
              'Guardado.',
            );
          }}
          className="rounded-lg border border-accent-400 bg-accent-wash px-3 py-1.5 text-xs font-medium text-accent-400 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Guardar
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            void run(() => resetAgent(agent.slug), 'Restaurado al original.');
          }}
          className="rounded-lg border border-border bg-overlay px-3 py-1.5 text-xs text-text-mid disabled:opacity-45"
        >
          Restaurar original
        </button>
      </div>

      {(error || message) && (
        <div className="mt-3">
          {error ? (
            <Alert tone="danger" label="AGENTE">
              {error}
            </Alert>
          ) : (
            <Alert tone="info" label="AGENTE">
              {message}
            </Alert>
          )}
        </div>
      )}
    </article>
  );
}

export function AgentsList() {
  const { agents, loading, error, refetch } = useAgents();

  if (loading) {
    return (
      <div className="py-8 text-center text-body text-text-low">
        Cargando agentes...
      </div>
    );
  }

  if (error) {
    return (
      <Alert tone="danger" label="AGENTES">
        {error}
      </Alert>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="py-8 text-center text-body text-text-low">
        Los agentes de timbre y seguridad se crean al arrancar el backend.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          onSaved={() => {
            void refetch();
          }}
        />
      ))}
    </div>
  );
}
