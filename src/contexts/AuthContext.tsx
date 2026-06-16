import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { set } from 'idb-keyval';
import { isDailyLockRequired, ensureDefaults, isDefaultDailyLock, isDefaultAdminPin, isDailyLockEnabled } from '@/lib/auth';
import { useCartStore } from '@/stores/cart.store';

export type AccessLevel = 'locked' | 'pos' | 'admin';

interface AuthContextType {
  accessLevel: AccessLevel;
  isDayUnlocked: boolean;
  needsDefaultChange: boolean;
  recheckDefaults: () => Promise<void>;
  checkLockStatus: () => Promise<void>;
  grantAdminAccess: () => void;
  grantPosAccess: () => void;
  exitAdmin: () => Promise<void>;
  lockNow: () => Promise<void>;
  requireAdminAction: (callback: () => void) => void;
  pendingAdminAction: (() => void) | null;
  clearPendingAdminAction: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('locked');
  const [pendingAdminAction, setPendingAdminAction] = useState<(() => void) | null>(null);
  const [needsDefaultChange, setNeedsDefaultChange] = useState<boolean>(false);
  const [isReady, setIsReady] = useState(false);
  
  const cartItems = useCartStore(state => state.items); 

  const cartLengthRef = useRef(0);
  useEffect(() => {
    cartLengthRef.current = cartItems?.length || 0;
  }, [cartItems?.length]);

  const checkLockStatus = async () => {
    const required = await isDailyLockRequired();
    const hasCartItems = cartLengthRef.current > 0;
    
    setAccessLevel(current => {
      if (current === 'admin') return 'admin';
      if (current === 'pos' && hasCartItems) return 'pos';
      return required ? 'locked' : 'pos';
    });
  };

  const recheckDefaults = async () => {
    try {
      await ensureDefaults();
      const enabled = await isDailyLockEnabled();
      const [defDaily, defAdmin] = await Promise.all([
        isDefaultDailyLock(),
        isDefaultAdminPin(),
      ]);
      setNeedsDefaultChange((enabled && defDaily) || defAdmin);
    } catch (e) {
      console.error('[auth] recheckDefaults failed:', e);
      setNeedsDefaultChange(false);
    } finally {
      setIsReady(true);
    }
  };

  // Effect 1: run ONCE on mount — heavy operations
  useEffect(() => {
    const init = async () => {
      await recheckDefaults();
      const required = await isDailyLockRequired();
      setAccessLevel(required ? 'locked' : 'pos');
    };
    init();
    
    const interval = setInterval(() => {
      checkLockStatus();
    }, 60000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Effect 2: re-evaluate lock status when cart items change
  // (cheap call — no recheckDefaults)
  useEffect(() => {
    checkLockStatus();
  }, [cartItems?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const grantAdminAccess = () => {
    setAccessLevel('admin');
  };

  const grantPosAccess = () => {
    setAccessLevel('pos');
  };

  const exitAdmin = async () => {
    const required = await isDailyLockRequired();
    setAccessLevel(required ? 'locked' : 'pos');
  };

  const lockNow = async () => {
    await set('lastUnlockAt', null);
    setAccessLevel('locked');
  };

  const requireAdminAction = (callback: () => void) => {
    if (accessLevel === 'admin') {
      callback();
    } else {
      setPendingAdminAction(() => callback);
    }
  };

  const clearPendingAdminAction = () => {
    setPendingAdminAction(null);
  };

  if (!isReady) {
    return null; // or loading
  }

  return (
    <AuthContext.Provider value={{
      accessLevel,
      isDayUnlocked: accessLevel === 'pos' || accessLevel === 'admin',
      needsDefaultChange,
      recheckDefaults,
      checkLockStatus,
      grantAdminAccess,
      grantPosAccess,
      exitAdmin,
      lockNow,
      requireAdminAction,
      pendingAdminAction,
      clearPendingAdminAction
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
