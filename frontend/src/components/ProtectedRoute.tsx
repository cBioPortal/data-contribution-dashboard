import { Navigate } from 'react-router-dom';
import { useAuthToken } from '@/hooks/useAuthToken';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * Gate for routes that require a signed-in user.
 *
 * Authorisation is decided from Keycloak's own resolved session rather than a
 * verification call to the API. Keycloak has already validated the session by
 * the time `useAuthToken` reports, so the extra round trip to /api/auth/profile
 * only added latency — roughly a third of a second on every protected page load
 * — to re-answer a question we already had the answer to. The API still checks
 * the token on every request, so this gate is a UX affordance, not the security
 * boundary.
 */
const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const token = useAuthToken();

  // undefined = Keycloak has not resolved yet. Deciding now would bounce a
  // signed-in user to the login page.
  if (token === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-500 border-r-transparent mb-4"></div>
          <p className="text-gray-600">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
