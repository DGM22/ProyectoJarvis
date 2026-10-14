import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/layouts/AppShell';
import { HomePage } from '@/pages/HomePage';
import { ConfigPage } from '@/pages/ConfigPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { IncomingDoorbellCall } from '@/components/IncomingDoorbellCall';
import { DoorbellSlotProvider } from '@/providers/DoorbellSlotProvider';
import { VoiceSessionProvider } from '@/providers/VoiceSessionProvider';

function App() {
  return (
    // El provider vive por encima del router: la sesión de voz y el listener de
    // "Hey Jarvis" sobreviven a cualquier cambio de ruta.
    <VoiceSessionProvider>
      <BrowserRouter>
        <DoorbellSlotProvider>
          {/* Fuera de las rutas: el timbre suena en cualquier página. En el
              celular abre a pantalla completa; en la computadora se dibuja en
              la página inicial. */}
          <IncomingDoorbellCall />
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<HomePage />} />
              <Route path="agents" element={<AgentsPage />} />
              <Route path="config" element={<ConfigPage />} />
            </Route>
            {/* La vista de chat se quitó: las llamadas viven en el inicio. */}
            <Route path="session" element={<Navigate to="/" replace />} />
          </Routes>
        </DoorbellSlotProvider>
      </BrowserRouter>
    </VoiceSessionProvider>
  );
}

export default App;
