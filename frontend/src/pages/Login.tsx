import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import SharedLayout from "@/components/SharedLayout";
import { FaGoogle, FaGithub } from "react-icons/fa";
import { User, LogOut, ArrowRight } from "lucide-react";
import { login as kcLogin, logout as kcLogout } from "@/services/keycloak";

const Login = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

  useEffect(() => {
    // Check if user is already logged in
    const token = localStorage.getItem('authToken');
    if (token) {
      // Fetch user profile
      fetch(`${API_URL}/api/auth/profile`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          setUser(data.data.user);
        } else {
          localStorage.removeItem('authToken');
        }
      })
      .catch(() => {
        localStorage.removeItem('authToken');
      });
    }
  }, [API_URL]);

  // Login is handled by Keycloak. The idpHint routes straight to the chosen
  // identity provider; without it, Keycloak shows its own login page.
  const handleGoogleLogin = () => {
    kcLogin('google');
  };

  const handleGithubLogin = () => {
    kcLogin('github');
  };

  const handleLogout = () => {
    setUser(null);
    kcLogout();
  };

  const handleGoToDashboard = () => {
    navigate('/');
  };

  if (user) {
    // User is logged in
    return (
      <SharedLayout>
        <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4">
          <div className="w-full max-w-md">
            <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
              {/* Success header with gradient */}
              <div className="bg-gradient-to-r from-green-500 to-emerald-500 p-6 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-full mb-3">
                  <User className="w-8 h-8 text-green-500" />
                </div>
                <h2 className="text-white text-xl font-semibold">Welcome Back!</h2>
              </div>

              {/* User info */}
              <div className="p-6 space-y-4">
                <div className="text-center">
                  <p className="text-sm text-gray-500 mb-1">Signed in as</p>
                  <p className="text-gray-900 font-semibold text-lg">{user.email}</p>
                  {user.name && (
                    <p className="text-gray-600 text-sm mt-1">{user.name}</p>
                  )}
                </div>

                <div className="space-y-2 pt-2">
                  <button
                    onClick={handleGoToDashboard}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all duration-200 font-medium shadow-sm hover:shadow-md"
                  >
                    Go to Dashboard
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-all duration-200 font-medium"
                  >
                    <LogOut className="w-4 w-4" />
                    Sign Out
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SharedLayout>
    );
  }

  // User is not logged in
  return (
    <SharedLayout>
      <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-10">
            {/* Title and description */}
            <div className="text-center mb-8">
              <h1 className="text-2xl font-semibold text-gray-800 mb-4">
                Welcome to cBioPortal Dashboard
              </h1>
              <p className="text-gray-600 text-sm leading-relaxed">
                Login is optional, but required for submitting data or suggesting papers.
              </p>
            </div>

            {/* Login buttons */}
            <div className="space-y-3">
              <button
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors font-medium"
              >
                <FaGoogle className="text-lg text-red-500" />
                <span>Login with Google</span>
              </button>
              
              <button
                onClick={handleGithubLogin}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors font-medium"
              >
                <FaGithub className="text-lg" />
                <span>Login with GitHub</span>
              </button>
            </div>
          </div>

          {/* Back to home link */}
          <div className="text-center mt-6">
            <Link to="/" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </SharedLayout>
  );
};

export default Login;
