import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { MobileNav } from '@/components/MobileNav';
import { IncomingDoorbellCall } from '@/components/IncomingDoorbellCall';

export function AppShell() {
  return (
    <div className="min-h-screen bg-bg bg-glow-top">
      <Sidebar />
      <MobileNav />
      <IncomingDoorbellCall />

      <main className="md:pl-60">
        <div className="mx-auto max-w-2xl px-5 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
