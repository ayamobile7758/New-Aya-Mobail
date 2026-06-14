import React, { createContext, useContext, useState, useEffect } from 'react';
import { isDailyLockRequired, ensureDefaults, isDefaultDailyLock, isDefaultAdminPin } from '@/lib/auth';
import { useCartStore } from '@/stores/cart.store';

interface AuthContextType {
  isDayUnlocked: boolean;
  isAdminPinValidUntil: number | null;
  needsDefaultChange: boolean;
  recheckDefaults: () => Promise<void>;
  checkLockStatus: () => Promise<void>;
  markDayUnlocked: () => void;
  grantAdminAccess: () => void;
  requireAdminAction: (callback: () => void) => void;
  pendingAdminAction: (() => void) | null;
  clearPendingAdminAction: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isDayUnlocked, setIsDayUnlocked] = useState(false);
  const [isAdminPinValidUntil, setIsAdminPinValidUntil] = useState<number | null>(null);
  const [pendingAdminAction, setPendingAdminAction] = useState<(() => void) | null>(null);
  const [needsDefaultChange, setNeedsDefaultChange] = useState<boolean>(false);
  const [isReady, setIsReady] = useState(false);
  
  const cartItems = useCartStore(state => state.items); 

  const checkLockStatus = async () => {
    // Only postpone locking if we are already unlocked and cart has items
    // (avoids interrupting an active session). On fresh loads we must still
    // evaluate the unlock state even if a persisted cart has items.
    if (isDayUnlocked && cartItems && cartItems.length > 0) {
      return;
    }
    const required = await isDailyLockRequired();
    setIsDayUnlocked(!required);
  };

  const recheckDefaults = async () => {
    try {
      await ensureDefaults();
      const [defDaily, defAdmin] = await Promise.all([
        isDefaultDailyLock(),
        isDefaultAdminPin(),
      ]);
      setNeedsDefaultChange(defDaily || defAdmin);
    } catch (e) {
      console.error('[auth] recheckDefaults failed:', e);
      // Still allow the app to render so the user sees something
      // (the lock screen will then catch any auth issues).
      setNeedsDefaultChange(false);
    } finally {
      setIsReady(true);
    }
  };

  // Effect 1: run ONCE on mount — heavy operations
  useEffect(() => {
    recheckDefaults().then(() => checkLockStatus());
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

  const markDayUnlocked = () => setIsDayUnlocked(true);
  
  const grantAdminAccess = () => {
    setIsAdminPinValidUntil(Date.now() + 15 * 60 * 1000);
  };

  const requireAdminAction = (callback: () => void) => {
    if (isAdminPinValidUntil && Date.now() < isAdminPinValidUntil) {
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
      isDayUnlocked,
      isAdminPinValidUntil,
      needsDefaultChange,
      recheckDefaults,
      checkLockStatus,
      markDayUnlocked,
      grantAdminAccess,
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
