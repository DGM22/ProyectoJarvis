import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { JarvisGraphOrb } from '@/components/JarvisGraphOrb';
import { AppShell } from '@/layouts/AppShell';
import { HomePage } from '@/pages/HomePage';
import { ConfigPage } from '@/pages/ConfigPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { LoginPage } from '@/pages/LoginPage';
import { IncomingDoorbellCall } from '@/components/IncomingDoorbellCall';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { DoorbellSlotProvider } from '@/providers/DoorbellSlotProvider';
import { VoiceSessionProvider } from '@/providers/VoiceSessionProvider';

/** La app completa (sockets de voz, cámara y timbre) solo existe con sesión. */
function AuthenticatedApp() {
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
              <Route path="visits" element={<HistoryPage />} />
              <Route path="agents" element={<AgentsPage />} />
              <Route path="config" element={<ConfigPage />} />
            </Route>
            {/* La vista de chat se quitó: las llamadas viven en el inicio. */}
            <Route path="session" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </DoorbellSlotProvider>
      </BrowserRouter>
    </VoiceSessionProvider>
  );
}

function AuthGate() {
  const { state } = useAuth();
  if (state.status === 'loading' || state.status === 'offline') {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-bg bg-glow-top">
        <JarvisGraphOrb state="connecting" size={72} />
        {state.status === 'offline' && (
          <p className="text-sm text-text-mid">No se pudo conectar con Jarvis. Reintentando…</p>
        )}
      </main>
    );
  }
  if (state.status === 'anonymous') {
    return <LoginPage setup={!state.hasUsers} />;
  }
  return <AuthenticatedApp />;
}

function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

export default App;
