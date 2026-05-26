import { useState, useEffect, createContext, useContext } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import ScrollToTop from "@/components/ScrollToTop";
import { supabase, AUTH_STORAGE_KEY } from "@/integrations/supabase/client";
import { FloatingAIAssistant } from "@/components/dashboard/FloatingAIAssistant";
import mayurPhoto from "@/assets/mayur-photo.jpg";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import DoctorDashboard from "./pages/DoctorDashboard";
import Auth from "./pages/Auth";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import Services from "./pages/Services";
import About from "./pages/About";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// Create context for page transitions
interface TransitionContextType {
  isTransitioning: boolean;
  rippleOrigin: { x: number; y: number };
  startTransition: (x: number, y: number) => void;
}

const TransitionContext = createContext<TransitionContextType>({
  isTransitioning: false,
  rippleOrigin: { x: 0, y: 0 },
  startTransition: () => {},
});

export const usePageTransition = () => useContext(TransitionContext);

// Transition overlay component
const TransitionOverlay = ({ isActive, origin }: { isActive: boolean; origin: { x: number; y: number } }) => {
  if (!isActive) return null;

  return (
    <motion.div
      className="fixed inset-0 z-[9999] pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Ripple effect */}
      <motion.div
        className="absolute rounded-full bg-primary/20"
        style={{
          left: origin.x,
          top: origin.y,
          x: '-50%',
          y: '-50%',
        }}
        initial={{ width: 0, height: 0, opacity: 0.8 }}
        animate={{
          width: '300vw',
          height: '300vw',
          opacity: 0,
        }}
        transition={{
          duration: 0.8,
          ease: [0.645, 0.045, 0.355, 1],
        }}
      />
      {/* Fade overlay */}
      <motion.div
        className="absolute inset-0 bg-background"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.95 }}
        transition={{ duration: 0.4, ease: 'easeInOut' }}
      />
    </motion.div>
  );
};

// Page wrapper with animations
const PageWrapper = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
        transition={{
          duration: 0.5,
          ease: [0.645, 0.045, 0.355, 1],
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
};

const AppContent = () => {
  const [showCookieBanner, setShowCookieBanner] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [rippleOrigin, setRippleOrigin] = useState({ x: 0, y: 0 });
  const [user, setUser] = useState<any>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const cookieConsent = localStorage.getItem('cookieConsent');
    if (!cookieConsent) {
      setShowCookieBanner(true);
    }

    // Check for authenticated user with retry logic
    const checkUser = async () => {
      const maxRetries = 3;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          
          if (sessionError) {
            console.error(`Auth session error (attempt ${attempt + 1}):`, sessionError);
            lastError = sessionError;
            
            // Handle refresh token errors by clearing session
            if (sessionError.message?.includes('Refresh Token') || sessionError.message?.includes('Invalid')) {
              console.warn('Clearing invalid session due to refresh token error');
              localStorage.removeItem(AUTH_STORAGE_KEY);
              try {
                await supabase.auth.signOut();
              } catch (e) {
                console.error('Failed to sign out:', e);
              }
              setUser(null);
              return;
            }
            
            // Only retry on network errors
            if (attempt < maxRetries - 1 && sessionError.message?.includes('Network')) {
              await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
              continue;
            }
            throw sessionError;
          }

          if (!session) {
            setUser(null);
            return;
          }
          
          try {
            const { data: { user }, error } = await supabase.auth.getUser();
            if (error) {
              console.error('Auth error:', error);
              // Handle refresh token errors
              if (error.message?.includes('Refresh Token')) {
                console.warn('Clearing session due to refresh token error');
                localStorage.removeItem(AUTH_STORAGE_KEY);
              }
              // Clear invalid session
              try {
                await supabase.auth.signOut();
              } catch (signOutErr) {
                console.error('Failed to sign out:', signOutErr);
              }
              setUser(null);
            } else {
              setUser(user);
            }
          } catch (userErr) {
            console.error('Failed to get user:', userErr);
            setUser(null);
          }
          return;
        } catch (err) {
          lastError = err as Error;
          console.error(`Session check failed (attempt ${attempt + 1}):`, err);
          
          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            continue;
          }
        }
      }

      console.error('Failed to check session after retries:', lastError);
      setUser(null);
    };

    checkUser();

    // Listen for auth changes with error handling
    let subscription: any;
    try {
      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        try {
          if (event === 'TOKEN_REFRESHED') {
            console.log('Token refreshed successfully');
            setUser(session?.user || null);
            setIsLoggingOut(false);
          } else if (event === 'SIGNED_OUT') {
            setIsLoggingOut(true);
            setUser(null);
          } else if (event === 'SIGNED_IN') {
            setIsLoggingOut(false);
            setUser(session?.user || null);
          } else if (event === 'USER_UPDATED') {
            setIsLoggingOut(false);
            setUser(session?.user || null);
          } else {
            setIsLoggingOut(false);
            setUser(session?.user || null);
          }
        } catch (err) {
          console.error('Error handling auth state change:', err);
          setUser(null);
          setIsLoggingOut(false);
        }
      });
      subscription = data.subscription;
    } catch (err) {
      console.error('Failed to set up auth state listener:', err);
    }

    return () => {
      if (subscription) {
        try {
          subscription.unsubscribe();
        } catch (err) {
          console.error('Error unsubscribing from auth changes:', err);
        }
      }
    };
  }, []);

  const handleAcceptCookies = () => {
    localStorage.setItem('cookieConsent', 'accepted');
    setShowCookieBanner(false);
    // TODO: Enable analytics/tracking here if needed
    // Example: window.gtag('consent', 'update', { analytics_storage: 'granted' });
  };

  const handleDeclineCookies = () => {
    localStorage.setItem('cookieConsent', 'declined');
    setShowCookieBanner(false);
  };

  const startTransition = (x: number, y: number) => {
    setRippleOrigin({ x, y });
    setIsTransitioning(true);
    setTimeout(() => setIsTransitioning(false), 800);
  };

  return (
    <TransitionContext.Provider value={{ isTransitioning, rippleOrigin, startTransition }}>
      <ScrollToTop />
      <Toaster />
      <Sonner />
      <TransitionOverlay isActive={isTransitioning} origin={rippleOrigin} />
      <PageWrapper>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/dashboard" element={<Dashboard showChat={true} />} />
          <Route path="/doctor-dashboard" element={<DoctorDashboard showChat={true} />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/services" element={<Services />} />
          <Route path="/about" element={<About />} />
          {/* Appointment redirect routes */}
          <Route path="/appointment" element={<Navigate to="/dashboard" replace />} />
          <Route path="/appointments" element={<Navigate to="/dashboard" replace />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </PageWrapper>

      {/* Global Cookie Consent Banner */}
      {showCookieBanner && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border shadow-2xl">
          <div className="container mx-auto px-4 py-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Shield className="h-5 w-5 text-primary" />
                </div>
                <div className="text-sm">
                  <p className="font-medium mb-1">We value your privacy</p>
                  <p className="text-muted-foreground">
                    We use cookies to enhance your browsing experience and analyze our traffic. By clicking "Accept", you consent to our use of cookies.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeclineCookies}
                  className="hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
                >
                  Decline
                </Button>
                <Button
                  size="sm"
                  onClick={handleAcceptCookies}
                  className="bg-primary hover:bg-primary/90"
                >
                  Accept Cookies
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global Floating AI Assistant - Only show on dashboard when authenticated */}
      {Boolean(user?.id) && !isLoggingOut && location.pathname === "/dashboard" && (
        <FloatingAIAssistant userId={user.id} />
      )}
    </TransitionContext.Provider>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppContent />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
