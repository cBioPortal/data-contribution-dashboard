import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogIn, Menu, User, ChevronDown, Home, Bell } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { logout as kcLogout } from "@/services/keycloak";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthToken } from '@/hooks/useAuthToken';
import { fetchProfile } from '@/services/profileApi';

const Header = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => fetchProfile(token as string),
    enabled: Boolean(token),
    refetchInterval: 60_000,
  });
  const user = profile?.user ?? null;
  const unreadCount = profile?.notifications.unreadCount ?? 0;

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const handleLogout = () => {
    queryClient.removeQueries({ queryKey: ['profile'] });
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
              src="/images/cbioportal-logo-header.png"
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
            
            {token ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="outline" 
                    className="text-sm sm:text-base flex items-center gap-2 px-4"
                  >
                    <User className="h-4 w-4" />
                    <span className="max-w-[200px] truncate">{user?.email || 'Account'}</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem asChild>
                    <Link to="/profile" className="flex cursor-pointer items-center justify-between">
                      <span>My profile</span>
                      {unreadCount > 0 && (
                        <span className="rounded-full bg-orange-600 px-2 py-0.5 text-xs font-semibold text-white">
                          {unreadCount}
                        </span>
                      )}
                    </Link>
                  </DropdownMenuItem>
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
            
            {token ? (
              <>
                <div className="py-2 px-3 text-sm text-gray-700 bg-gray-50 rounded-md flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span className="truncate">{user?.email || 'Account'}</span>
                </div>
                <Link
                  to="/profile"
                  className="flex items-center justify-between py-2 text-gray-600 hover:text-blue-600 transition-colors font-medium"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span>My profile</span>
                  {unreadCount > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800">
                      <Bell className="h-3 w-3" />
                      {unreadCount}
                    </span>
                  )}
                </Link>
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
