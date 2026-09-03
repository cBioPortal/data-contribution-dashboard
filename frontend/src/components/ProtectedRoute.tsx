import { Navigate } from 'react-router-dom';
import { useAuthToken } from '@/hooks/useAuthToken';
import SharedLayout from '@/components/SharedLayout';

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
  //
  // Rendered inside the normal layout rather than as a bare centred spinner.
  // A protected route genuinely cannot choose between rendering and redirecting
  // until this answer arrives, so unlike the public views there is nothing to
  // show early — but the header and footer depend on nothing, and without them
  // the wait reads as a blank screen rather than as a page still loading.
  if (token === undefined) {
    return (
      <SharedLayout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-500 border-r-transparent mb-4"></div>
            <p className="text-gray-600">Checking authentication...</p>
          </div>
        </div>
      </SharedLayout>
    );
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
