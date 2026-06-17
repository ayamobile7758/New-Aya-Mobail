/// <reference types="vite-plugin-pwa/client" />
import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, X } from 'lucide-react';

export function PWABadge() {
  // registerType is 'autoUpdate': the new service worker installs in the background and
  // takes over on the next app open, so there is no manual "update available" prompt.
  // We still register here to keep the SW lifecycle wired up.
  useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered: ' + r);
    },
    onRegisterError(error) {
      console.log('SW registration error', error);
    },
  });

  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // A2HS (Add to Home Screen) install prompt
  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  return (
    <div className="fixed bottom-20 sm:bottom-6 start-4 end-4 sm:start-auto sm:end-auto sm:w-80 flex flex-col gap-2 z-50">
      {deferredPrompt && (
        <div className="bg-surface border border-accent shadow-lg rounded-2xl p-4 animate-in slide-in-from-bottom flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold flex items-center gap-2">
              <Download className="w-4 h-4" /> 
              تثبيت التطبيق 
            </h3>
            <button onClick={() => setDeferredPrompt(null)} className="p-1 hover:bg-muted rounded-full">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-sm text-text-secondary">
            قم بتثبيت التطبيق على جهازك للوصول السريع والعمل بدون إنترنت بشكل أفضل.
          </p>
          <button 
            onClick={handleInstall}
            className="w-full h-10 border-2 border-accent text-accent font-bold rounded-lg hover:bg-accent/5 transition-colors"
          >
            تثبيت التطبيق
          </button>
        </div>
      )}
    </div>
  );
}
