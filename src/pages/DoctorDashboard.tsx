import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Users, Calendar, FileText, Search, Menu, X } from "lucide-react";
import { supabase, AUTH_STORAGE_KEY } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import { useN8nChat } from "@/hooks/use-n8n-chat";
import { recoverUserRole } from "@/lib/role-recovery";
import { getTodayIST } from "@/lib/istTimezone";
import { ProfileDropdown } from "@/components/dashboard/ProfileDropdown";
import Notifications from "@/components/dashboard/Notifications";
import { AppointmentManagement } from "@/components/dashboard/AppointmentManagement";
import { DoctorAppointmentHistory } from "@/components/dashboard/DoctorAppointmentHistory";
import { PatientDetailsDialog } from "@/components/dashboard/PatientDetailsDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface PatientData {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  blood_type: string;
  gender: string;
  allergies: string[];
  chronic_conditions: string[];
  assigned_at: string;
  status: string;
  emergency_contact?: string;
  avatar_url?: string;
  medications?: any[];
  health_events?: any[];
  medical_records?: any[];
}

interface DoctorDashboardProps {
  showChat?: boolean;
}

const DoctorDashboard = ({ showChat = false }: DoctorDashboardProps) => {
  const navigate = useNavigate();
  
  // Always call hook unconditionally (Rules of Hooks)
  // The hook itself checks auth state and hides the widget when not needed
  useN8nChat();
  
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<PatientData[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientData | null>(null);
  const [doctorName, setDoctorName] = useState<string>("");
  const [activeTab, setActiveTab] = useState("patients");
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [doctorLicense, setDoctorLicense] = useState<string>("");
  const [doctorSpecialization, setDoctorSpecialization] = useState<string>("");
  const [stats, setStats] = useState({
    todayAppointments: 0,
    pendingReports: 0,
  });

  useEffect(() => {
    checkAuth();
  }, []);

  // Realtime subscriptions for automatic updates
  useEffect(() => {
    if (!user?.id) return;
    const uid = user.id;

    // Subscribe to appointments changes
    const appointmentsChannel = supabase
      .channel('doctor-appointments')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `doctor_id=eq.${uid}`
        },
        () => {
          loadDoctorStats(uid);
        }
      )
      .subscribe();

    // Subscribe to doctor_patients changes
    const patientsChannel = supabase
      .channel('doctor-patients')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'doctor_patients',
          filter: `doctor_id=eq.${uid}`
        },
        () => {
          fetchPatients(uid);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(appointmentsChannel);
      supabase.removeChannel(patientsChannel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const checkAuth = async () => {
    try {
      console.log("[DoctorDashboard] Starting auth check...");
      
      // Try to refresh session first (especially important after OTP signup)
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        console.warn("[DoctorDashboard] Session refresh warning:", refreshError);
        // Don't fail on refresh warning, session might still be valid
      } else {
        console.log("[DoctorDashboard] Session refreshed successfully");
      }

      // Now get the user with retries
      let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null;
      let authError: Error | null = null;
      let getRetries = 3;

      while (getRetries > 0 && !user) {
        const { data: { user: currentUser }, error: currentAuthError } = await supabase.auth.getUser();
        
        if (currentAuthError) {
          console.warn(`[DoctorDashboard] Auth check attempt failed (${4 - getRetries}/3):`, currentAuthError);
          authError = currentAuthError;
          if (getRetries > 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
            getRetries--;
          } else {
            getRetries = 0;
          }
        } else if (currentUser) {
          user = currentUser;
          authError = null;
          console.log("[DoctorDashboard] User authenticated:", user.id);
          getRetries = 0;
        } else {
          if (getRetries > 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
            getRetries--;
          } else {
            getRetries = 0;
          }
        }
      }
      
      if (authError || !user) {
        console.error("[DoctorDashboard] Auth error or no user found:", authError);
        // Clear invalid session
        localStorage.removeItem(AUTH_STORAGE_KEY);
        await supabase.auth.signOut();
        navigate("/auth");
        return;
      }

      console.log("[DoctorDashboard] User authenticated:", user.id);

      // Check if user is a doctor (handle multiple rows gracefully)
      const { data: roleDataArray, error: roleError } = await supabase
        .from("user_roles")
        .select("id, role")
        .eq("user_id", user.id);

      let roleData: { id: string; role: string } | null = null;
      
      if (roleError) {
        console.error("[DoctorDashboard] Role lookup error:", roleError);
        // Try to recover
        console.log("[DoctorDashboard] Attempting role recovery...");
        const recovery = await recoverUserRole(user.id);
        if (!recovery.success || recovery.role !== "doctor") {
          console.error("[DoctorDashboard] Doctor role recovery failed:", recovery.message);
          toast.error("Access denied: Not a doctor");
          navigate("/dashboard");
          return;
        }
        console.log("[DoctorDashboard] Doctor role recovered successfully");
      } else if (roleDataArray && roleDataArray.length > 1) {
        // Handle duplicate roles - keep first one, delete others in a single query
        console.warn("[DoctorDashboard] Found multiple role entries, cleaning up...");
        roleData = roleDataArray[0];
        const idsToDelete = roleDataArray.slice(1).map((r: any) => r.id);
        const { error: deleteError } = await supabase.from("user_roles").delete().in("id", idsToDelete);
        if (deleteError) {
          console.error("[DoctorDashboard] Error deleting duplicate roles:", deleteError);
        } else {
          console.log("[DoctorDashboard] Cleaned up duplicate roles");
        }
      } else if (roleDataArray && roleDataArray.length === 1) {
        roleData = roleDataArray[0];
      }
      
      if (!roleData || roleData.role !== "doctor") {
        console.warn("[DoctorDashboard] User is not a doctor, role:", roleData?.role);
        console.log("[DoctorDashboard] Checking if doctor_profiles exists...");
        
        // Check if doctor profile exists to help with debugging
        const { data: doctorProfileCheck } = await supabase
          .from("doctor_profiles")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();
        
        console.log("[DoctorDashboard] Doctor profile exists:", !!doctorProfileCheck);
        
        console.log("[DoctorDashboard] Attempting role recovery...");
        const recovery = await recoverUserRole(user.id);
        console.log("[DoctorDashboard] Recovery result:", recovery);
        
        if (!recovery.success || recovery.role !== "doctor") {
          console.error("[DoctorDashboard] Recovery failed, user is not a doctor");
          console.error("[DoctorDashboard] Recovery message:", recovery.message);
          navigate("/dashboard");
          return;
        }
        console.log("[DoctorDashboard] Doctor role recovered via recovery");
      }

      console.log("[DoctorDashboard] Role verified as doctor");

      // Ensure doctor profile exists
      const { data: doctorProfile, error: profileError } = await supabase
        .from("doctor_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profileError) {
        console.error("[DoctorDashboard] Doctor profile lookup error:", profileError);
        // Try to create it
        // Insert with minimal required fields (add defaults if needed)
        const { error: createError } = await supabase
          .from("doctor_profiles")
          .insert([{ user_id: user.id, license_number: "", specialization: "", available_for_consultation: true }]);

        if (createError && createError.code !== '23505') {
          console.error("[DoctorDashboard] Failed to create doctor profile:", createError);
          toast.error("Doctor profile setup incomplete. Please contact support.");
          navigate("/auth");
          return;
        }
        console.log("[DoctorDashboard] Doctor profile created");
      } else if (!doctorProfile) {
        console.warn("[DoctorDashboard] Doctor profile not found, attempting to create...");
        // Try to create doctor profile if it doesn't exist
        // Insert with minimal required fields (add defaults if needed)
        const { error: createError } = await supabase
          .from("doctor_profiles")
          .insert([{ user_id: user.id, license_number: "", specialization: "", available_for_consultation: true }]);

        if (createError && createError.code !== '23505') { // Ignore duplicate key errors
          console.error("[DoctorDashboard] Failed to create doctor profile:", createError);
          toast.error("Doctor profile setup incomplete. Please contact support.");
          navigate("/auth");
          return;
        }
        console.log("[DoctorDashboard] Doctor profile created");
      } else {
        console.log("[DoctorDashboard] Doctor profile verified");
      }

      console.log("[DoctorDashboard] All checks passed, loading data...");
      setUser(user);
      await Promise.all([
        fetchDoctorName(user.id),
        fetchPatients(user.id),
        loadDoctorStats(user.id)
      ]);
      console.log("[DoctorDashboard] Data loaded successfully");
      setLoading(false);
    } catch (error) {
      console.error("[DoctorDashboard] Auth check error:", error);
      // Clear session on any auth error
      if (error instanceof Error && error.message?.includes('Refresh Token')) {
        console.warn('[DoctorDashboard] Refresh token error, clearing session');
        localStorage.removeItem(AUTH_STORAGE_KEY);
        await supabase.auth.signOut();
      }
      toast.error("Authentication error. Please sign in again.");
      navigate("/auth");
    }
  };

  const fetchDoctorName = async (userId: string) => {
    try {
      console.log("[fetchDoctorName] Starting fetch for user:", userId);
      
      // First, get the doctor's name from profiles table
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();

      if (profileError) {
        console.error("[fetchDoctorName] Error fetching doctor profile:", profileError);
        return;
      }

      console.log("[fetchDoctorName] Profile data:", profileData);

      // Then, get license and specialization from doctor_profiles table
      // Note: doctor_profiles uses user_id (not id) as the foreign key
      const { data: doctorData, error: doctorError } = await supabase
        .from("doctor_profiles")
        .select("license_number, specialization")
        .eq("user_id", userId)
        .maybeSingle();

      if (doctorError) {
        console.error("[fetchDoctorName] Error fetching doctor profile details:", doctorError);
      }

      console.log("[fetchDoctorName] Doctor profile data:", doctorData);

      if (profileData) {
        const license = doctorData?.license_number || "";
        const specialization = doctorData?.specialization || "";

        console.log("[fetchDoctorName] Setting state:", {
          full_name: profileData.full_name,
          license_number: license,
          specialization: specialization,
        });

        setDoctorName(profileData.full_name || "");
        setDoctorLicense(license);
        setDoctorSpecialization(specialization);
        
        console.log("[fetchDoctorName] State updated successfully");
      } else {
        console.warn("[fetchDoctorName] Doctor profile not found for user:", userId);
      }
    } catch (error) {
      console.error("[fetchDoctorName] Exception fetching doctor name:", error);
    }
  };

  const loadDoctorStats = async (doctorId: string) => {
    try {
      // Get today's date range
      // Get today's date in IST
      const todayIST = getTodayIST(); // Format: YYYY-MM-DD
      const tomorrowIST = new Date();
      tomorrowIST.setUTCDate(tomorrowIST.getUTCDate() + 1);
      const tomorrowISTParts = tomorrowIST.toISOString().split('T')[0];

      // Count today's appointments based on IST date
      const { count: todayCount } = await supabase
        .from("appointments")
        .select("*", { count: "exact", head: true })
        .eq("doctor_id", doctorId)
        .gte("appointment_date", `${todayIST}T00:00:00Z`)
        .lt("appointment_date", `${tomorrowISTParts}T00:00:00Z`);

      // Count pending appointments (regular pending appointments that haven't passed)
      const { data: pendingAppointments } = await supabase
        .from("appointments")
        .select("appointment_date")
        .eq("doctor_id", doctorId)
        .eq("status", "pending");

      // Count pending emergency bookings that haven't been scheduled yet or have scheduled dates that haven't passed
      const { data: pendingEmergencies } = await supabase
        .from("emergency_bookings")
        .select("scheduled_date, requested_at")
        .eq("doctor_id", doctorId)
        .eq("status", "pending");

      // Filter out appointments that have already passed (IST-aware)
      const { hasAppointmentPassed } = await import("@/lib/istTimezone");
      
      const validPendingAppointments = (pendingAppointments || []).filter(apt => 
        !hasAppointmentPassed(apt.appointment_date)
      ).length;

      const validPendingEmergencies = (pendingEmergencies || []).filter(eb => {
        // Show if no scheduled_date yet, or if scheduled_date hasn't passed
        if (!eb.scheduled_date) return true;
        return !hasAppointmentPassed(eb.scheduled_date);
      }).length;

      setStats({
        todayAppointments: todayCount || 0,
        pendingReports: validPendingAppointments + validPendingEmergencies,
      });
    } catch (error) {
      console.error("Error loading stats:", error);
    }
  };

  // Auto-inactivate patients with no appointments in last 6 months
  const autoInactivatePatients = async (doctorId: string, assignments: any[]) => {
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const sixMonthsAgoISO = sixMonthsAgo.toISOString();

      // For each active patient, check if they have recent appointments
      const activeAssignments = assignments.filter(a => a.status === "active");
      
      for (const assignment of activeAssignments) {
        const { data: recentAppointments, error } = await supabase
          .from("appointments")
          .select("id")
          .eq("doctor_id", doctorId)
          .eq("patient_id", assignment.patient_id)
          .gte("appointment_date", sixMonthsAgoISO)
          .limit(1);

        if (error) {
          console.error(`Error checking appointments for patient ${assignment.patient_id}:`, error);
          continue;
        }

        // If no recent appointments found, mark as inactive
        if (!recentAppointments || recentAppointments.length === 0) {
          const { error: updateError } = await supabase
            .from("doctor_patients")
            .update({ status: "inactive" })
            .eq("id", assignment.id);

          if (updateError) {
            console.error(`Error inactivating patient ${assignment.patient_id}:`, updateError);
          } else {
            console.log(`Patient ${assignment.patient_id} auto-inactivated (no appointments in 6 months)`);
          }
        }
      }
    } catch (error) {
      console.error("Error in autoInactivatePatients:", error);
    }
  };

  const fetchPatients = async (doctorId: string) => {
    console.log("Fetching patients for doctor ID:", doctorId);
    try {
      // Get all assigned patients (including both active and inactive)
      const { data: assignments, error: assignError } = await supabase
        .from("doctor_patients")
        .select("id, patient_id, assigned_at, status, notes")
        .eq("doctor_id", doctorId);

      if (assignError) throw assignError;
      console.log("Assigned patient relations:", assignments);

      // Auto-inactivate patients with no recent appointments
      if (assignments && assignments.length > 0) {
        await autoInactivatePatients(doctorId, assignments);
      }

      // Filter to get active patients for display
      if (assignments && assignments.length > 0) {
        const activeAssignments = assignments.filter(a => a.status === "active");
        const patientIds = activeAssignments.map(a => a.patient_id);
        
        // Get patient profiles
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .in("id", patientIds);

        if (profileError) throw profileError;
        console.log("Fetched patient profiles:", profiles);

        const patientData: PatientData[] = profiles.map(profile => {
          const assignment = activeAssignments.find(a => a.patient_id === profile.id);
          return {
            id: profile.id,
            full_name: profile.full_name || "Unknown",
            email: profile.email || "",
            phone: profile.phone || "",
            date_of_birth: profile.date_of_birth || "",
            blood_type: profile.blood_type || "",
            gender: profile.gender || "",
            allergies: profile.allergies || [],
            chronic_conditions: profile.chronic_conditions || [],
            emergency_contact: profile.emergency_contact || "",
            avatar_url: profile.avatar_url || "",
            assigned_at: assignment?.assigned_at || "",
            status: assignment?.status || "active",
          };
        });
        console.log("Final processed patient data:", patientData);

        setPatients(patientData);
      } else {
        setPatients([]);
      }
    } catch (error) {
      console.error("Error fetching patients:", error);
      toast.error("Failed to load patients");
    }
  };

  const viewPatientDetails = async (patientId: string) => {
    console.log("Viewing details for patient ID:", patientId);
    const patient = patients.find(p => p.id === patientId);
    if (patient) {
      // Show patient info immediately and open dialog right away
      setSelectedPatient(patient);
      setDetailsDialogOpen(true);
      
      // Fetch additional patient details in background without blocking
      try {
        const [medsData, eventsData, recordsMetaData, storageFiles] = await Promise.all([
          supabase
            .from("medications")
            .select("*")
            .eq("user_id", patientId)
            .eq("active", true),
          supabase
            .from("health_timeline")
            .select("*")
            .eq("user_id", patientId)
            .order("event_date", { ascending: false })
            .limit(5),
          (supabase as any)
            .from("medical_records_meta")
            .select("*")
            .eq("user_id", patientId)
            .order("uploaded_at", { ascending: false }),
          // Also fetch files directly from storage
          supabase.storage
            .from("medical-records")
            .list(patientId + '/', {
              limit: 100,
              sortBy: { column: 'created_at', order: 'desc' }
            }),
        ]);

        if (medsData.error) {
          console.error("Error fetching medications:", medsData.error);
        }
        if (eventsData.error) {
          console.error("Error fetching health events:", eventsData.error);
        }
        if (recordsMetaData.error) {
          console.error("Error fetching medical records metadata:", recordsMetaData.error);
        }
        if (storageFiles.error) {
          console.error("Error fetching storage files:", storageFiles.error);
          console.error("Storage error details:", storageFiles.error);
        }

        console.log("Medical records metadata:", recordsMetaData.data?.length || 0, "records");
        console.log("Storage files:", storageFiles.data?.length || 0, "files");

        // Merge metadata with actual storage files
        // Always prioritize storage files as source of truth to avoid stale data
        let medicalRecords = [];
        
        if (storageFiles.data && storageFiles.data.length > 0) {
          // Filter out placeholder files
          const actualFiles = storageFiles.data.filter((file: any) => file.name !== '.emptyFolderPlaceholder');
          
          // Create records from storage files (source of truth)
          medicalRecords = actualFiles.map((file: any) => {
            // Try to find matching metadata for additional info
            const metadata = recordsMetaData.data?.find((meta: any) => {
              const metaPath = meta.file_path?.replace(`${patientId}/`, '') || meta.file_name;
              return file.name === metaPath || 
                     (meta.file_name && file.name.includes(meta.file_name)) ||
                     (meta.file_name && meta.file_name.includes(file.name));
            });
            return {
              id: file.id || file.name,
              file_name: file.name,
              file_path: `${patientId}/${file.name}`,
              size: (file as any).metadata?.size ?? (metadata as any)?.size ?? null,
              mime_type: (file as any).metadata?.mimetype ?? (metadata as any)?.mime_type ?? "application/octet-stream",
              uploaded_at: (file as any).created_at ?? (metadata as any)?.uploaded_at ?? null,
              created_at: (file as any).created_at ?? (metadata as any)?.created_at ?? null,
            };
          });
        }

        console.log("Final medical records:", medicalRecords.length, "records");

        // Update with full details
        setSelectedPatient({
          ...patient,
          medications: medsData.data || [],
          health_events: eventsData.data || [],
          medical_records: medicalRecords,
        });
      } catch (error) {
        console.error("Error fetching patient details:", error);
        // Dialog already open with basic info, no need to fail
      }
    }
  };

  // Update patient status (activate/inactivate)
  const updatePatientStatus = async (patientId: string, newStatus: "active" | "inactive") => {
    if (!user?.id) return;
    try {
      const { error } = await supabase
        .from("doctor_patients")
        .update({ status: newStatus })
        .eq("doctor_id", user.id)
        .eq("patient_id", patientId);

      if (error) {
        console.error("Error updating patient status:", error);
        toast.error(`Failed to ${newStatus === "active" ? "activate" : "inactivate"} patient`);
        return;
      }

      toast.success(`Patient ${newStatus === "active" ? "activated" : "inactivated"} successfully`);
      
      // Refresh patient list
      fetchPatients(user.id);
      
      // Update selected patient if open
      if (selectedPatient?.id === patientId) {
        setSelectedPatient({ ...selectedPatient, status: newStatus });
      }
    } catch (error) {
      console.error("Error updating patient status:", error);
      toast.error("Failed to update patient status");
    }
  };

  const handleMobileNavClick = (tab: string) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const filteredPatients = patients.filter(patient =>
    patient.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    patient.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-secondary/30 to-background flex items-center justify-center">
        <Activity className="h-12 w-12 text-primary animate-pulse" />
      </div>
    );
  }

  const navLinks = [
    { id: "patients", label: "My Patients" },
    { id: "appointments", label: "Appointments" },
    { id: "history", label: "History" },
  ];

  return (
    <div className="min-h-screen pt-24 md:pt-28 bg-gradient-to-br from-background via-background to-secondary/20">
      {/* Header - Enhanced with Landing navbar style */}
      <header className="border-b border-border/30 bg-background/75 backdrop-blur-2xl fixed top-0 left-0 w-full z-40 shadow-lg shadow-primary/5">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative flex items-center justify-between py-3 lg:py-4">
            <div className="flex items-center gap-3">
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                    <button 
                      type="button"
                      onClick={() => setMobileMenuOpen(true)}
                      className="md:hidden lg:hidden z-50 p-2 hover:bg-accent/20 active:bg-accent/30 rounded-lg transition-all duration-300 relative group" 
                      aria-label="Toggle menu"
                    >
                      <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-primary/10 to-accent/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      <Menu className="h-5 w-5 sm:h-6 sm:w-6 relative z-10 transition-transform duration-300 group-hover:rotate-180" />
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
                  <nav className="flex flex-col gap-2 p-4">
                    {navLinks.map((link) => (
                      <button
                        type="button"
                        key={link.id}
                        onClick={() => handleMobileNavClick(link.id)}
                        className={`group relative px-4 py-3 rounded-lg text-base font-medium transition-all ${
                          activeTab === link.id
                            ? "bg-primary text-primary-foreground shadow-md"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {activeTab !== link.id && (
                          <>
                            <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-primary/10 via-accent/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                            <div className="absolute inset-0 rounded-lg border border-transparent group-hover:border-primary/30 transition-colors duration-300"></div>
                          </>
                        )}
                        <span className="relative z-10 flex items-center gap-2">
                          {link.label}
                          <span className="inline-block opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-1">→</span>
                        </span>
                      </button>
                    ))}
                  </nav>
                </SheetContent>
              </Sheet>
              <div className="h-9 w-9 sm:h-10 sm:w-10 lg:h-12 lg:w-12 rounded-lg bg-gradient-to-br from-primary via-primary-light to-accent flex items-center justify-center shadow-lg shadow-primary/30 transition-all duration-500 group-hover:shadow-2xl group-hover:shadow-primary/50 group-hover:scale-110">
                <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-primary/20 via-transparent to-accent/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm"></div>
                <Activity className="h-6 w-6 lg:h-7 lg:w-7 text-primary-foreground relative z-10" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-xl lg:text-2xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">Doctor Dashboard</h1>
                <p className="text-xs lg:text-sm text-muted-foreground">Patient Management</p>
              </div>
            </div>

            {/* Desktop Navigation - Centered with Enhanced Effects */}
            <nav className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 items-center gap-1 bg-muted/50 backdrop-blur-sm p-1.5 rounded-xl border border-border/50">
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

            <div className="flex items-center gap-2 md:gap-3">
              <ThemeToggle />
              {user && <Notifications userId={user.id} />}
              {user && <ProfileDropdown user={user} />}
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-10 max-w-7xl">
        {/* Welcome Section */}
        <div className="mb-8 md:mb-12">
          <h2 className="text-2xl md:text-4xl font-bold mb-2 md:mb-3 text-primary">
            Welcome, {doctorName?.startsWith('Dr.') ? doctorName : `Dr. ${doctorName || user?.email?.split('@')[0] || 'Doctor'}`}
          </h2>
          <p className="text-muted-foreground text-base md:text-lg">Manage your patients and appointments</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8 mb-8 md:mb-12">
          <Card className="group relative p-4 md:p-8 bg-gradient-to-br from-card via-card to-card/50 border-border/50 hover:border-primary/50 transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-1">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-accent/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative flex items-center gap-3 md:gap-5">
              <div className="p-3 md:p-4 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 group-hover:from-primary/30 group-hover:to-primary/20 transition-all duration-300 flex-shrink-0">
                <Users className="h-6 w-6 md:h-8 md:w-8 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs md:text-sm font-medium text-muted-foreground mb-1">Total Patients</p>
                <p className="text-2xl md:text-3xl font-bold bg-gradient-to-br from-foreground to-primary bg-clip-text text-transparent">{patients.length}</p>
              </div>
            </div>
          </Card>
          <Card className="group relative p-4 md:p-8 bg-gradient-to-br from-card via-card to-card/50 border-border/50 hover:border-primary/50 transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-1">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-accent/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative flex items-center gap-3 md:gap-5">
              <div className="p-3 md:p-4 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/10 group-hover:from-accent/30 group-hover:to-accent/20 transition-all duration-300 flex-shrink-0">
                <Calendar className="h-6 w-6 md:h-8 md:w-8 text-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-xs md:text-sm font-medium text-muted-foreground mb-1">Today's Appointments</p>
                <p className="text-2xl md:text-3xl font-bold bg-gradient-to-br from-foreground to-accent bg-clip-text text-transparent">{stats.todayAppointments}</p>
              </div>
            </div>
          </Card>
          <Card className="group relative p-4 md:p-8 bg-gradient-to-br from-card via-card to-card/50 border-border/50 hover:border-primary/50 transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-1">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-accent/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative flex items-center gap-3 md:gap-5">
              <div className="p-3 md:p-4 rounded-2xl bg-gradient-to-br from-primary-light/20 to-primary-light/10 group-hover:from-primary-light/30 group-hover:to-primary-light/20 transition-all duration-300 flex-shrink-0">
                <FileText className="h-6 w-6 md:h-8 md:w-8 text-primary-light" />
              </div>
              <div className="min-w-0">
                <p className="text-xs md:text-sm font-medium text-muted-foreground mb-1">Pending Reports</p>
                <p className="text-2xl md:text-3xl font-bold bg-gradient-to-br from-foreground to-primary-light bg-clip-text text-transparent">{stats.pendingReports}</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Main Content */}
        <Card className="p-4 md:p-8 bg-gradient-to-br from-card via-card to-card/50 border-border/50 shadow-xl">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsContent value="patients">
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search patients by name or email..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                {filteredPatients.length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground mb-2">
                      {searchQuery ? "No patients found matching your search" : "No patients assigned yet"}
                    </p>
                    {!searchQuery && (
                      <p className="text-sm text-muted-foreground">
                        Patients need to be assigned to you through the doctor_patients table.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-md border overflow-x-auto hidden md:block max-h-[600px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-card z-10">
                        <TableRow>
                          <TableHead>Patient Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Blood Type</TableHead>
                          <TableHead>Age</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPatients.map((patient) => (
                          <TableRow key={patient.id}>
                            <TableCell className="font-medium">{patient.full_name}</TableCell>
                            <TableCell>{patient.email}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{patient.blood_type || "N/A"}</Badge>
                            </TableCell>
                            <TableCell>
                              {patient.date_of_birth
                                ? new Date().getFullYear() -
                                  new Date(patient.date_of_birth).getFullYear()
                                : "N/A"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={patient.status === "active" ? "default" : "secondary"}>
                                {patient.status === "active" ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => viewPatientDetails(patient.id)}
                              >
                                View Details
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                
                {/* Mobile Card View */}
                {filteredPatients.length > 0 && (
                  <div className="md:hidden space-y-3 max-h-[600px] overflow-y-auto pr-2">
                    {filteredPatients.map((patient) => (
                      <Card key={patient.id} className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-base mb-2 truncate">{patient.full_name}</h4>
                            <div className="space-y-1 text-sm">
                              <p className="text-muted-foreground truncate">{patient.email}</p>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="text-xs">{patient.blood_type || "N/A"}</Badge>
                                <span className="text-muted-foreground text-xs">•</span>
                                <span className="text-xs text-muted-foreground">
                                  {patient.date_of_birth
                                    ? `${new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear()} years`
                                    : "Age N/A"}
                                </span>
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => viewPatientDetails(patient.id)}
                            className="flex-shrink-0 whitespace-nowrap h-9 px-4"
                          >
                            View
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="appointments">
              <AppointmentManagement doctorId={user?.id || ""} />
            </TabsContent>

            <TabsContent value="history">
              <DoctorAppointmentHistory 
                doctorId={user?.id || ""} 
                doctorName={doctorName}
                doctorLicense={doctorLicense}
                doctorSpecialization={doctorSpecialization}
              />
            </TabsContent>
          </Tabs>
        </Card>
      </div>

      {/* Patient Details Dialog */}
      <PatientDetailsDialog
        patient={selectedPatient}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        onSave={() => {
          fetchPatients(user?.id || "");
          if (selectedPatient) {
            viewPatientDetails(selectedPatient.id);
          }
        }}
        onStatusChange={updatePatientStatus}
      />

    </div>
  );
};

export default DoctorDashboard;
