import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useVoiceSession } from '@/providers/VoiceSessionProvider';

/**
 * Lleva al usuario a `/session` cuando hay llamada activa y lo regresa
 * a inicio al colgar (incluye wake-word).
 */
export function SessionNavigator() {
  const { isActive } = useVoiceSession();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isActive && location.pathname !== '/session') {
      navigate('/session', { replace: true });
      return;
    }

    if (!isActive && location.pathname === '/session') {
      navigate('/', { replace: true });
    }
  }, [isActive, location.pathname, navigate]);

  return null;
}
