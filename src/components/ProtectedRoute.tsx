import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/contexts/PermissionsContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Module key for permission check */
  moduleKey?: string;
  /** Extra module keys that also grant access (any-of). Used by pages that
   *  merged in other modules' content (e.g. Insights hosts Performance +
   *  Agent Activity), so users with only those keys keep their access. */
  moduleKeysAny?: string[];
}

export function ProtectedRoute({ children, moduleKey, moduleKeysAny }: ProtectedRouteProps) {
  const { session, user, loading } = useAuth();
  const { canAccessModule, loading: permLoading } = usePermissions();

  if (loading || permLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // Check module-level access (enabled + role permission)
  if (moduleKey && user) {
    const hasAccess = canAccessModule(moduleKey) ||
      (moduleKeysAny?.some(k => canAccessModule(k)) ?? false);
    if (!hasAccess) {
      // Find a module the user CAN access for redirect
      if (user.isPendingAgent || user.isPredictionAgent || user.isAgent) {
        return <Navigate to="/assigned" replace />;
      }
      if (user.isWarehouse) {
        return <Navigate to="/warehouse" replace />;
      }
      if (user.isAdsAdmin) {
        return <Navigate to="/ads" replace />;
      }
      return <Navigate to="/" replace />;
    }
  }

  return <>{children}</>;
}
