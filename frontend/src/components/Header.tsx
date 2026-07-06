import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogIn, Menu, User, ChevronDown, Home } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { logout as kcLogout } from "@/services/keycloak";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const Header = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const isMobile = useIsMobile();
  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

  useEffect(() => {
    // Check if user is logged in
    const token = localStorage.getItem('authToken');
    if (token) {
      fetch(`${API_URL}/api/auth/profile`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          setUser(data.data.user);
        }
      })
      .catch(() => {
        localStorage.removeItem('authToken');
      });
    }
  }, [API_URL]);

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const handleLogout = () => {
    setUser(null);
    setMobileMenuOpen(false);
    // Ends the Keycloak SSO session (not just the local token), so the next
    // login actually re-authenticates instead of silently reusing the session.
    // kcLogout clears localStorage.authToken and redirects to Keycloak.
    kcLogout();
  };

  return (
    <header className="sticky top-0 w-full py-4 px-4 sm:px-6 bg-white border-b border-gray-100 shadow-sm z-50">
      <div className="max-w-[1400px] mx-auto flex justify-between items-center">
        {/* Logo on left - links to main cBioPortal site */}
        <div className="flex items-center">
          <a 
            href="https://www.cbioportal.org/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center transition-opacity hover:opacity-80"
            title="Visit cBioPortal"
          >
            <img 
              src="/lovable-uploads/0e406f53-235c-4c83-86e2-9d72f6a60e13.png" 
              alt="cBioPortal Logo" 
              className="h-8 sm:h-10" 
            />
          </a>
        </div>

        {/* Mobile menu button */}
        {isMobile && (
          <button 
            onClick={toggleMobileMenu}
            className="md:hidden flex items-center p-2 rounded-md focus:outline-none"
          >
            <Menu className="h-6 w-6 text-gray-600" />
          </button>
        )}

        {/* Navigation options - desktop */}
        {!isMobile && (
          <div className="flex items-center space-x-3">
            <Link to="/">
              <Button 
                variant="ghost" 
                className="text-sm sm:text-base flex items-center gap-2 text-gray-700 hover:text-blue-600 hover:bg-blue-50"
              >
                <Home className="h-4 w-4" />
                <span>Home</span>
              </Button>
            </Link>
            
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="outline" 
                    className="text-sm sm:text-base flex items-center gap-2 px-4"
                  >
                    <User className="h-4 w-4" />
                    <span className="max-w-[200px] truncate">{user.email}</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem 
                    onClick={handleLogout}
                    className="cursor-pointer text-blue-600 hover:text-blue-700"
                  >
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link to="/login">
                <Button variant="outline" className="text-sm sm:text-base flex items-center gap-2">
                  <LogIn className="h-4 w-4" />
                  Login
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Mobile navigation menu */}
      {isMobile && mobileMenuOpen && (
        <div className="md:hidden absolute left-0 right-0 top-full bg-white border-b border-gray-100 shadow-md animate-fade-in">
          <div className="flex flex-col py-2 px-4 space-y-3">
            <Link 
              to="/" 
              className="py-2 text-gray-600 hover:text-blue-600 transition-colors font-medium flex items-center gap-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              <Home className="h-4 w-4" />
              Home
            </Link>
            
            {user ? (
              <>
                <div className="py-2 px-3 text-sm text-gray-700 bg-gray-50 rounded-md flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span className="truncate">{user.email}</span>
                </div>
                <Button 
                  variant="outline" 
                  onClick={handleLogout}
                  className="w-full justify-center text-blue-600 hover:text-blue-700"
                >
                  Sign out
                </Button>
              </>
            ) : (
              <Link to="/login" onClick={() => setMobileMenuOpen(false)}>
                <Button variant="outline" className="w-full justify-center flex items-center gap-2">
                  <LogIn className="h-4 w-4" />
                  Login
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
