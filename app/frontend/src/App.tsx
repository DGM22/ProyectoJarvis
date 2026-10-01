import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/layouts/AppShell';
import { HomePage } from '@/pages/HomePage';
import { ConfigPage } from '@/pages/ConfigPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { TranscriptsPage } from '@/pages/TranscriptsPage';
import { SessionPage } from '@/pages/SessionPage';
import { SessionNavigator } from '@/components/SessionNavigator';
import { VoiceSessionProvider } from '@/providers/VoiceSessionProvider';

function App() {
  return (
    // El provider vive por encima del router: la sesión de voz y el listener de
    // "Hey Jarvis" sobreviven a cualquier cambio de ruta.
    <VoiceSessionProvider>
      <BrowserRouter>
        <SessionNavigator />
        <Routes>
          <Route path="session" element={<SessionPage />} />
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="transcripciones" element={<TranscriptsPage />} />
            <Route path="config" element={<ConfigPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </VoiceSessionProvider>
  );
}

export default App;
