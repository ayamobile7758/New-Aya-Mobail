import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AdminPinDialog } from './AdminPinDialog';

interface AdminGateProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  title?: string;
  description?: string;
  onCancel?: () => void;
}

export function AdminGate({ children, fallback, title, description, onCancel }: AdminGateProps) {
  const { accessLevel } = useAuth();
  
  const isAuthorized = accessLevel === 'admin';

  // React to change in authorization state.
  if (isAuthorized) {
    return <>{children}</>;
  }

  return (
    <>
      {fallback || null}
      <AdminPinDialog
        isOpen={true}
        onClose={() => {
          if (onCancel) onCancel();
        }}
        onSuccess={() => {
          // Success is handled by context state change
        }}
        title={title}
        description={description}
      />
    </>
  );
}
