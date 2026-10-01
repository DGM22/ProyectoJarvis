import { useCallback, useState } from 'react';
import { TranscriptRecorder } from '@/components/TranscriptRecorder';
import { TranscriptList } from '@/components/TranscriptList';
import { TranscriptViewer } from '@/components/TranscriptViewer';
import { useTranscripts } from '@/hooks/useTranscripts';

export function TranscriptsPage() {
  const {
    transcripts,
    loading,
    refetch,
    rename,
    remove,
    getMeta,
    getSegments,
    downloadUrl,
  } = useTranscripts();

  const [openId, setOpenId] = useState<number | null>(null);

  const handleOpen = useCallback((id: number) => {
    setOpenId(id);
  }, []);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-title text-text-hi">Transcripciones</h1>
        <p className="mt-2 text-body text-text-mid">
          Graba juntas con tu micrófono. Jarvis las transcribe en vivo (multi-
          idioma) y guarda un .txt por fecha. Abre cualquiera para leerla aquí
          mismo; si es muy larga se carga por partes al hacer scroll.
        </p>
      </header>

      <TranscriptRecorder onSessionEnded={() => void refetch()} />

      <section className="space-y-4">
        <h2 className="text-body font-semibold text-text-hi">Historial</h2>
        <TranscriptList
          transcripts={transcripts}
          loading={loading}
          onRename={rename}
          onDelete={remove}
          onOpen={handleOpen}
          downloadUrl={downloadUrl}
        />
      </section>

      {openId != null && (
        <TranscriptViewer
          transcriptId={openId}
          downloadUrl={downloadUrl(openId)}
          getMeta={getMeta}
          getSegments={getSegments}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
