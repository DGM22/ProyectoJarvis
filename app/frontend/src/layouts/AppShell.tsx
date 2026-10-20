import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { MobileNav } from '@/components/MobileNav';

export function AppShell() {
  return (
    <div className="min-h-screen bg-bg bg-glow-top">
      <Sidebar />
      <MobileNav />

      <main className="md:pl-60">
        {/* En celular deja espacio para la barra inferior (4rem + zona segura). */}
        <div className="mx-auto max-w-2xl px-5 py-8 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
