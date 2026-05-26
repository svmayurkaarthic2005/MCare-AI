import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Activity, Menu, X, AlertTriangle } from "lucide-react";
import { supabase, AUTH_STORAGE_KEY } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { User, Session } from "@supabase/supabase-js";
import { recoverUserRole } from "@/lib/role-recovery";
import { useN8nChat } from "@/hooks/use-n8n-chat";
import { ProfileDropdown } from "@/components/dashboard/ProfileDropdown";
import Notifications from "@/components/dashboard/Notifications";
import { HealthTimeline } from "@/components/dashboard/HealthTimeline";
import { MedicationTracker } from "@/components/dashboard/MedicationTracker";
import { RecordsUpload } from "@/components/dashboard/RecordsUpload";
import { BloodReportAnalysis } from "@/components/dashboard/BloodReportAnalysis";
import { AvailableDoctors } from "@/components/dashboard/AvailableDoctors";
import { PatientAppointments } from "@/components/dashboard/PatientAppointments";
import { PatientAppointmentHistory } from "@/components/dashboard/PatientAppointmentHistory";
import ErrorBoundary from "@/components/ErrorBoundary";
import { EmergencyBookingDialog } from "@/components/dashboard/EmergencyBookingDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface DashboardProps {
  showChat?: boolean;
}

const Dashboard = ({ showChat = false }: DashboardProps) => {
  const navigate = useNavigate();
  
  // Always call hook unconditionally (Rules of Hooks)
  // The hook itself checks auth state and hides the widget when not needed
  useN8nChat();
  
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState<string>("");
  const [userRole, setUserRole] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("home");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [emergencyDialogOpen, setEmergencyDialogOpen] = useState(false);
  const [stats, setStats] = useState({
    medications: 0,
    events: 0,
    appointments: 0,
  });

  useEffect(() => {
    // If route is /dashboard/appointments, switch to appointments tab
    const loc = window.location.pathname || '';
    if (loc.endsWith('/appointments')) {
      setActiveTab('appointments');
    }

    let isMounted = true;

    const fetchUserData = async (userId: string) => {
      try {
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", userId)
          .single();

        if (profileError) throw profileError;
        if (profileData && isMounted) {
          setUserName(profileData.full_name || "");
        }

        await loadStats(userId);
      } catch (error) {
        console.error("Error fetching user data:", error);
        if (isMounted) {
          toast.error("Failed to load user data.");
        }
      }
    };

    const checkUserSession = async (currentSession: Session | null) => {
      if (!isMounted) return;

      if (currentSession?.user) {
        setUser(currentSession.user);
        setSession(currentSession);

        let roleData = null;
        let roleError = null;
        const maxRoleRetries = 3;

        // Retry fetching role if it doesn't exist yet (might be a timing issue)
        for (let attempt = 0; attempt < maxRoleRetries; attempt++) {
          const response = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", currentSession.user.id);

          if (response.error) {
            roleError = response.error;
          } else if (response.data && response.data.length > 0) {
            roleData = response.data[0];
            break;
          }
          if (attempt < maxRoleRetries - 1) {
            // Exponential backoff: 500ms, 1000ms
            await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt)));
          }
        }

        // If role not found, try recovery
        if (!roleData && !roleError) {
          console.log("Role not found, attempting recovery...");
          const recoveryResult = await recoverUserRole(currentSession.user.id);
          if (recoveryResult.success && recoveryResult.role) {
            roleData = { role: recoveryResult.role };
            console.log("Role recovered successfully:", recoveryResult.role);
          } else {
            console.error("Role recovery failed:", recoveryResult.message);
            roleError = new Error(recoveryResult.message);
          }
        }

        if (roleError && !roleData) {
          console.error("Error fetching user role:", roleError);
          toast.error("Could not verify user role.");
          setLoading(false);
          await supabase.auth.signOut();
          return;
        }

        if (!roleData) {
          console.error("No role found for user after retries and recovery");
          toast.error("Account setup incomplete. Please refresh the page.");
          setLoading(false);
          await supabase.auth.signOut();
          return;
        }

        if (isMounted) {
          if (roleData.role === "doctor") {
            navigate("/doctor-dashboard");
          } else {
            setUserRole(roleData.role);
            await fetchUserData(currentSession.user.id);
            setLoading(false);
          }
        }
      } else {
        setUser(null);
        setSession(null);
        navigate("/auth");
        setLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      checkUserSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'TOKEN_REFRESHED' && !session) {
        // Token refresh failed, sign out
        console.warn('Token refresh failed, signing out');
        localStorage.removeItem(AUTH_STORAGE_KEY);
        await supabase.auth.signOut();
        navigate("/auth");
      } else if (event === 'SIGNED_OUT' || !session) {
        // Session ended
        console.log('Session ended, redirecting to auth');
        setUser(null);
        setSession(null);
        navigate("/auth");
      } else {
        checkUserSession(session);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  const loadStats = async (userId: string) => {
    try {
      // Count active medications
      const { count: medCount } = await supabase
        .from("medications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("active", true);

      // Count health events
      const { count: eventCount } = await supabase
        .from("health_timeline")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      // Count upcoming appointments (pending and approved that haven't passed)
      // Note: We fetch and filter client-side to match PatientAppointments behavior
      const { data: appointmentsData } = await supabase
        .from("appointments")
        .select("*", { count: "exact" })
        .eq("patient_id", userId)
        .in("status", ["pending", "approved"]);

      // Get current IST time for filtering
      const now = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
      const istNow = new Date(now.getTime() + istOffset - (now.getTimezoneOffset() * 60 * 1000));

      // Filter out appointments that have passed
      const upcomingAppointments = appointmentsData?.filter(apt => {
        const aptDate = new Date(apt.appointment_date);
        return aptDate >= istNow;
      }) || [];

      // Count emergency bookings (pending only - approved go to history)
      const { count: emergencyCount } = await (supabase as any)
        .from("emergency_bookings")
        .select("*", { count: "exact", head: true })
        .eq("patient_id", userId)
        .eq("status", "pending");

      const totalAppointments = (upcomingAppointments.length || 0) + (emergencyCount || 0);

      setStats({
        medications: medCount || 0,
        events: eventCount || 0,
        appointments: totalAppointments,
      });
    } catch (error) {
      console.error("Error loading stats:", error);
    }
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Error signing out");
      return;
    }
    toast.success("Signed out successfully");
    navigate("/");
  };

  const handleMobileNavClick = (tab: string) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-secondary/30 to-background flex items-center justify-center">
        <div className="text-center">
          <Activity className="h-12 w-12 text-primary animate-pulse mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const navLinks = [
    { id: "home", label: "Home" },
    { id: "appointments", label: "Appointments" },
    { id: "history", label: "History" },
  ];

  return (
    <div className="min-h-screen pt-36 bg-gradient-to-br from-background via-background to-secondary/20">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/30 bg-background/75 backdrop-blur-2xl shadow-lg shadow-primary/5" style={{ zIndex: 9999 }}>
        <div className="container mx-auto px-6 lg:px-8">
          <div className="relative flex items-center justify-between py-6">
            <div className="flex items-center gap-3">
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                    <button 
                      type="button"
                      onClick={() => setMobileMenuOpen(true)}
                      className="md:hidden z-50 p-2.5 hover:bg-accent/20 active:bg-accent/30 rounded-lg transition-all duration-300 relative group" 
                      aria-label="Toggle menu"
                    >
                      <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-primary/10 to-accent/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      <Menu className="h-6 w-6 relative z-10 transition-transform duration-300 group-hover:rotate-180" />
                    </button>
                  </SheetTrigger>
                <SheetContent side="left" className="w-3/4 p-0 overflow-y-auto">
                  <SheetHeader className="p-4 border-b sticky top-0 bg-background z-10 flex flex-row items-center justify-between">
                    <SheetTitle>Navigation</SheetTitle>
                    <SheetClose asChild>
                      <button className="h-8 w-8 rounded-lg hover:bg-destructive/10 flex items-center justify-center transition-colors">
                        <X className="h-5 w-5 text-destructive" />
                      </button>
                    </SheetClose>
                  </SheetHeader>
                  <nav className="flex flex-col gap-4 p-4">
                    {navLinks.map((link) => (
                      <button
                        key={link.id}
                        onClick={() => handleMobileNavClick(link.id)}
                        className={`px-4 py-3 rounded-lg text-base font-medium transition-all text-left ${
                          activeTab === link.id
                            ? "bg-primary text-primary-foreground shadow-md"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/80"
                        }`}
                      >
                        {link.label}
                      </button>
                    ))}
                  </nav>
                </SheetContent>
              </Sheet>
              <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-primary via-primary-light to-accent flex items-center justify-center shadow-lg shadow-primary/30 transition-all duration-500 group-hover:shadow-2xl group-hover:shadow-primary/50 group-hover:scale-110 group-active:scale-95">
                <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-primary/20 via-transparent to-accent/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm"></div>
                <Activity className="h-7 w-7 text-primary-foreground relative z-10" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-xl lg:text-2xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">MCare</h1>
                <p className="text-xs lg:text-sm text-muted-foreground">Your Health Dashboard</p>
              </div>
            </div>

            <nav className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-1 bg-muted/50 backdrop-blur-sm p-1.5 rounded-xl border border-border/50">
              {navLinks.map((link) => (
                <button
                  key={link.id}
                  onClick={() => setActiveTab(link.id)}
                  className={`relative px-5 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                    activeTab === link.id
                      ? "text-primary-foreground bg-gradient-to-r from-primary to-primary-light shadow-md shadow-primary/25"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/80"
                  }`}
                >
                  <span className="relative z-10">{link.label}</span>
                </button>
              ))}
            </nav>
            
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Notifications userId={user.id} />
              <ProfileDropdown user={user} />
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 lg:px-8 py-10 max-w-7xl">
        {/* Welcome Section */}
          <div className="mb-12">
          <h2 className="text-4xl font-bold mb-3 leading-normal bg-gradient-to-r from-foreground via-primary to-accent bg-clip-text text-transparent">
            Welcome back, <span className="text-primary whitespace-nowrap text-2xl md:text-4xl">{userName || user.email?.split('@')[0] || 'Patient'}</span>
          </h2>
          <p className="text-muted-foreground text-lg">Here's an overview of your health today</p>
        </div>

        {/* Tabs Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">

          {/* Home Tab */}
          <TabsContent value="home" className="space-y-8">
            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <StatsCard title="Active Medications" value={stats.medications.toString()} subtitle="View history" />
              <StatsCard title="Health History Events" value={stats.events.toString()} subtitle="Complete timeline" />
              <StatsCard title="Appointments" value={stats.appointments.toString()} subtitle="Approved appointments" />
            </div>

            {/* Emergency Booking Section */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8 p-6 rounded-lg bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-950/20 dark:to-orange-950/20 border border-red-200/50">
              <div>
                <h3 className="text-2xl font-bold text-red-700 dark:text-red-400 mb-2 flex items-center gap-2">
                  <AlertTriangle className="h-6 w-6" />
                  Emergency Booking
                </h3>
                <p className="text-red-600 dark:text-red-300">Need urgent consultation? Request emergency appointment immediately</p>
              </div>
              <Button
                onClick={() => setEmergencyDialogOpen(true)}
                className="bg-red-600 hover:bg-red-700 text-white whitespace-nowrap flex-shrink-0"
              >
                <AlertTriangle className="h-4 w-4 mr-2" />
                Request Emergency
              </Button>
            </div>

            {/* Request Appointment Section */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
              <div>
                <h3 className="text-2xl font-bold text-foreground mb-2">Request Regular Appointment</h3>
                <p className="text-muted-foreground">Book scheduled appointments from available doctors</p>
              </div>
            </div>

            {/* Available Doctors */}
            <div>
              <AvailableDoctors patientId={user.id} />
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Health Timeline */}
              <div className="h-[600px]">
                <HealthTimeline userId={user.id} />
              </div>

              {/* Medications */}
              <div className="h-[600px]">
                <MedicationTracker userId={user.id} />
              </div>

              {/* Medical Records */}
              <div className="h-full lg:col-span-2">
                <RecordsUpload userId={user.id} />
              </div>

              {/* Blood Report Analysis */}
              <div className="h-full lg:col-span-2">
                <BloodReportAnalysis userId={user.id} />
              </div>
            </div>
          </TabsContent>

          {/* Upcoming Appointments Tab */}
          <TabsContent value="appointments" className="space-y-8">
            <ErrorBoundary>
              <PatientAppointments patientId={user.id} />
            </ErrorBoundary>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-8">
            <ErrorBoundary>
              <PatientAppointmentHistory patientId={user.id} />
            </ErrorBoundary>
          </TabsContent>
        </Tabs>

        {/* Emergency Booking Dialog */}
        <EmergencyBookingDialog
          open={emergencyDialogOpen}
          onOpenChange={setEmergencyDialogOpen}
          patientId={user?.id || ""}
          onBookingCreated={() => {
            setEmergencyDialogOpen(false);
            // Refresh appointments
            const refreshEvent = new CustomEvent('refreshAppointments');
            window.dispatchEvent(refreshEvent);
          }}
        />
      </div>

    </div>
  );
};

const StatsCard = ({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) => {
  return (
    <div className="group relative h-full p-8 rounded-2xl bg-gradient-to-br from-card via-card to-card/50 border border-border/50 hover:border-primary/50 transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-1">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-accent/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <div className="relative">
        <p className="text-sm font-medium text-muted-foreground mb-3">{title}</p>
        <p className="text-4xl font-bold mb-2 bg-gradient-to-br from-foreground to-primary bg-clip-text text-transparent">{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground/80">{subtitle}</p>}
      </div>
    </div>
  );
};

export default Dashboard;









