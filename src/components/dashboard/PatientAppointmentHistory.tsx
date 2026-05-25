import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, User, MessageSquare, Star, Pill, Download, AlertTriangle, Video } from "lucide-react";
import { toast } from "sonner";
import { AppointmentFeedbackDialog } from "./AppointmentFeedbackDialog";
import { VideoChatDialog } from "./VideoChatDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { downloadPrescriptionPDF } from "@/lib/generatePrescriptionPDF";
import { canStartVideoCall } from "@/lib/istTimezone";

interface Appointment {
  id: string;
  doctor_id: string;
  appointment_date: string;
  status: string;
  reason: string;
  notes?: string;
  doctor_name?: string;
  isEmergencyBooking?: boolean;
  urgency_level?: string;
  consultation_type?: string;
}

interface Feedback {
  id: string;
  patient_feedback?: string;
  patient_rating?: number;
  doctor_feedback?: string;
  doctor_rating?: number;
}

interface Prescription {
  id: string;
  medicines: Array<{
    id: string;
    medicine_name: string;
    dosage: string;
    frequency: string;
    duration: string;
    notes?: string;
  }>;
  notes?: string;
  file_url?: string;
  file_path?: string;
  doctor_name?: string;
  doctor_license?: string;
  doctor_specialization?: string;
  created_at: string;
}

export const PatientAppointmentHistory = ({ patientId }: { patientId: string }) => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [feedbacks, setFeedbacks] = useState<Record<string, Feedback>>({});
  const [prescriptions, setPrescriptions] = useState<Record<string, Prescription[]>>({});
  const [loading, setLoading] = useState(true);
  const [patientName, setPatientName] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [feedbackDialog, setFeedbackDialog] = useState<{
    open: boolean;
    appointmentId: string;
    doctorId: string;
    doctorName: string;
  } | null>(null);
  const [videoChatOpen, setVideoChatOpen] = useState(false);
  const [selectedAppointmentForVideo, setSelectedAppointmentForVideo] = useState<Appointment | null>(null);
  
  const isMountedRef = useRef(true);

  // Memoized fetch functions to prevent recreation on every render
  const fetchPatientInfo = useCallback(async () => {
    try {
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select("full_name, email")
        .eq("id", patientId)
        .single();

      if (error) throw error;

      if (isMountedRef.current && data) {
        setPatientName(data.full_name || "");
        setPatientEmail(data.email || "");
      }
    } catch (error) {
      console.error("Error fetching patient info:", error);
    }
  }, [patientId]);

  const fetchAppointmentHistory = useCallback(async () => {
    try {
      // Fetch regular appointments
      const { data: appointments, error: apptError } = await (supabase as any)
        .from("appointments")
        .select("*")
        .eq("patient_id", patientId)
        .in("status", ["completed", "cancelled", "rejected", "approved"])
        .order("appointment_date", { ascending: false });

      if (apptError) throw apptError;

      // Fetch ALL emergency bookings (not just completed) to show history
      let emergencyBookings: any[] = [];
      const { data: emergencyData, error: emergencyError } = await (supabase as any)
        .from("emergency_bookings")
        .select("id, doctor_id, status, urgency_level, reason, responded_at, scheduled_date, doctor_notes, requested_at, created_at")
        .eq("patient_id", patientId)
        .in("status", ["completed", "cancelled", "rejected", "approved"]);

      if (emergencyError) {
        if (emergencyError.code !== 'PGRST116') {
          console.warn("[fetchAppointmentHistory] Error fetching emergency bookings:", emergencyError);
        }
      } else if (emergencyData && emergencyData.length > 0) {
        console.log("[fetchAppointmentHistory] Fetched emergency bookings (APPROVED ONLY):", emergencyData.map(eb => ({
          id: eb.id,
          status: eb.status,
          scheduled_date: eb.scheduled_date,
          responded_at: eb.responded_at
        })));
        // Sort in code since order() might have issues
        emergencyBookings = emergencyData.sort((a, b) => {
          const dateA = new Date(a.responded_at || a.scheduled_date || a.requested_at || a.created_at || 0).getTime();
          const dateB = new Date(b.responded_at || b.scheduled_date || b.requested_at || b.created_at || 0).getTime();
          return dateB - dateA;
        });
      }

      // Combine both data sources
      let allAppointments = [...(appointments || [])];

      // Add emergency bookings to history
      if (emergencyBookings && emergencyBookings.length > 0) {
        const emergencyDoctorIds = [...new Set(emergencyBookings.map(eb => eb.doctor_id))];
        const { data: doctorProfiles } = await (supabase as any)
          .from("profiles")
          .select("id, full_name")
          .in("id", emergencyDoctorIds);

        const emergencyAppointments = emergencyBookings.map(eb => {
          // IMPORTANT: Use scheduled_date (actual appointment time) as primary source
          // DO NOT use responded_at (doctor's response time) as it's not the appointment time
          // Only use responded_at as fallback if scheduled_date is missing
          const appointmentTime = eb.scheduled_date 
            ? eb.scheduled_date 
            : (eb.responded_at || eb.requested_at || new Date().toISOString());
          
          return {
            id: eb.id,
            doctor_id: eb.doctor_id,
            appointment_date: appointmentTime,
            status: eb.status === 'rejected' ? 'cancelled' : eb.status, // Normalize status for UI
            reason: eb.reason,
            notes: eb.doctor_notes,
            doctor_name: (doctorProfiles as any[])?.find((doc: any) => doc.id === eb.doctor_id)?.full_name || "Unknown Doctor",
            isEmergencyBooking: true,
            urgency_level: eb.urgency_level,
          };
        });

        allAppointments = [...allAppointments, ...emergencyAppointments];
      }

      // Sort by date
      allAppointments.sort((a, b) => 
        new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime()
      );

      // Fetch doctor names for regular appointments (if not already fetched)
      const appointmentsNeedingDoctors = allAppointments.filter(apt => !apt.doctor_name);
      if (appointmentsNeedingDoctors.length > 0) {
        const doctorIds = [...new Set(appointmentsNeedingDoctors.map(apt => apt.doctor_id))];
        const { data: doctorProfiles } = await (supabase as any)
          .from("profiles")
          .select("id, full_name")
          .in("id", doctorIds);

        allAppointments = allAppointments.map(apt => ({
          ...apt,
          doctor_name: apt.doctor_name || (doctorProfiles as any[])?.find((doc: any) => doc.id === apt.doctor_id)?.full_name || "Unknown Doctor"
        }));
      }

      console.log("[fetchAppointmentHistory] Loaded appointments:", allAppointments.length, "items");
      console.log("[fetchAppointmentHistory] Appointment IDs:", allAppointments.map(a => ({ id: a.id, isEmergency: a.isEmergencyBooking })));
      if (isMountedRef.current) {
        setAppointments(allAppointments);
      }
    } catch (error) {
      console.error("Error fetching appointment history:", error);
      if (isMountedRef.current) {
        toast.error("Failed to load appointment history");
      }
    }
  }, [patientId]);

  const fetchFeedbacks = useCallback(async () => {
    try {
      const { data, error } = await (supabase as any)
        .from("appointment_feedback")
        .select("*")
        .eq("patient_id", patientId);

      if (error) throw error;

      const feedbackMap: Record<string, Feedback> = {};
      (data as any[])?.forEach((feedback: any) => {
        feedbackMap[feedback.appointment_id] = feedback as Feedback;
      });
      if (isMountedRef.current) {
        setFeedbacks(feedbackMap);
      }
    } catch (error) {
      console.error("Error fetching feedbacks:", error);
    }
  }, [patientId]);

  const fetchPrescriptions = useCallback(async () => {
    try {
      // Fetch all prescriptions for this patient
      const { data, error } = await (supabase as any)
        .from("prescriptions")
        .select(`
          id,
          appointment_id,
          emergency_booking_id,
          doctor_id,
          patient_id,
          medicines,
          notes,
          file_url,
          file_path,
          doctor_name,
          doctor_license,
          doctor_specialization,
          created_at,
          updated_at
        `)
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[fetchPrescriptions] Error fetching prescriptions:", error);
        return; // Don't throw, let page show without prescriptions
      }

      if (!data || data.length === 0) {
        console.log("[fetchPrescriptions] No prescriptions found for patient");
        if (isMountedRef.current) {
          setPrescriptions({});
        }
        return;
      }

      console.log("[fetchPrescriptions] Fetched prescriptions:", data.length);

      // Collect all unique doctor IDs from prescriptions that don't have doctor info
      const prescriptionsNeedingDoctorInfo = (data as any[]).filter((p: any) => !p.doctor_name || !p.doctor_license);
      const doctorIds = [...new Set(prescriptionsNeedingDoctorInfo.map((p: any) => p.doctor_id).filter(Boolean))];
      
      let doctorProfiles: any[] = [];
      let doctorNames: any[] = [];

      // Only fetch doctor info if we have prescriptions missing it
      if (doctorIds.length > 0) {
        const [{ data: profiles = [], error: profileError }, { data: names = [], error: nameError }] = await Promise.all([
          (supabase as any)
            .from("doctor_profiles")
            .select("user_id, specialization, license_number")
            .in("user_id", doctorIds),
          (supabase as any)
            .from("profiles")
            .select("id, full_name")
            .in("id", doctorIds)
        ]);

        if (profileError) {
          console.warn("[fetchPrescriptions] Error fetching doctor profiles:", profileError);
        }
        if (nameError) {
          console.warn("[fetchPrescriptions] Error fetching doctor names:", nameError);
        }

        doctorProfiles = profiles || [];
        doctorNames = names || [];
      }

      // For each prescription, attach doctor info if missing
      const prescriptionsWithDoctorInfo = ((data || []) as any[]).map((prescription: any) => {
        // Use stored info if available, otherwise fetch from doctor profiles
        let doctorName = prescription.doctor_name;
        let doctorLicense = prescription.doctor_license;
        let doctorSpecialization = prescription.doctor_specialization;

        if (!doctorName || !doctorLicense) {
          const doctorProfile = doctorProfiles?.find((dp: any) => dp.user_id === prescription.doctor_id);
          const doctorNameRecord = doctorNames?.find((dn: any) => dn.id === prescription.doctor_id);
          
          doctorName = doctorName || doctorNameRecord?.full_name || "Unknown Doctor";
          doctorLicense = doctorLicense || doctorProfile?.license_number || "N/A";
          doctorSpecialization = doctorSpecialization || doctorProfile?.specialization || "General Practice";
        }

        return {
          ...prescription,
          doctor_name: doctorName,
          doctor_license: doctorLicense,
          doctor_specialization: doctorSpecialization
        };
      });

      // Build prescription map using either appointment_id or emergency_booking_id as key
      const prescriptionMap: Record<string, Prescription[]> = {};
      prescriptionsWithDoctorInfo.forEach((prescription) => {
        // Use appointment_id if it exists, otherwise use emergency_booking_id
        const appointmentId = prescription.appointment_id || prescription.emergency_booking_id;
        if (appointmentId) {
          if (!prescriptionMap[appointmentId]) {
            prescriptionMap[appointmentId] = [];
          }
          prescriptionMap[appointmentId].push(prescription as any);
        } else {
          console.warn("[fetchPrescriptions] Prescription has neither appointment_id nor emergency_booking_id:", prescription.id);
        }
      });

      console.log("[fetchPrescriptions] Prescription map keys:", Object.keys(prescriptionMap));
      console.log("[fetchPrescriptions] Total prescriptions mapped:", prescriptionsWithDoctorInfo.length);
      console.log("[fetchPrescriptions] Sample prescriptions:", prescriptionsWithDoctorInfo.slice(0, 2).map(p => ({
        id: p.id,
        appointment_id: p.appointment_id,
        emergency_booking_id: p.emergency_booking_id,
        patient_id: p.patient_id,
        key_used: p.appointment_id || p.emergency_booking_id
      })));
      if (isMountedRef.current) {
        setPrescriptions(prescriptionMap);
      }
    } catch (error) {
      console.error("[fetchPrescriptions] Unexpected error:", error);
    }
  }, [patientId]);

  // CRITICAL FIX: Only trigger initial load once when patientId changes
  useEffect(() => {
    if (!patientId) {
      setLoading(false);
      return;
    }
    
    isMountedRef.current = true;
    setLoading(true);

    // Execute all fetches in parallel
    Promise.all([
      fetchPatientInfo(),
      fetchAppointmentHistory(),
      fetchFeedbacks(),
      fetchPrescriptions()
    ]).catch((error) => {
      console.error("Error loading appointment history data:", error);
    }).finally(() => {
      if (isMountedRef.current) {
        setLoading(false);
      }
    });

    // Cleanup function
    return () => {
      isMountedRef.current = false;
    };
  }, [patientId, fetchPatientInfo, fetchAppointmentHistory, fetchFeedbacks, fetchPrescriptions]);

  const downloadPrescription = async (prescription: Prescription) => {
    if (!prescription.file_url) {
      toast.error("No file available for download");
      return;
    }

    try {
      const response = await fetch(prescription.file_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const medicineName = prescription.medicines?.[0]?.medicine_name || "Prescription";
      a.download = `Prescription-${medicineName}-${prescription.created_at.split("T")[0]}.pdf`;
      try {
        document.body.appendChild(a);
        a.click();
      } finally {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error("Error downloading prescription:", error);
      toast.error("Failed to download prescription");
    }
  };

  const getDoctorProfile = async (doctorId: string) => {
    try {
      console.log("[getDoctorProfile] Fetching doctor profile for:", doctorId);
      
      const { data, error } = await (supabase as any)
        .from("doctor_profiles")
        .select("specialization, license_number")
        .eq("user_id", doctorId)
        .maybeSingle();

      if (error) {
        console.warn("[getDoctorProfile] Error fetching doctor profile:", error);
        return { specialization: "General Practice", license_number: "N/A" };
      }

      if (!data) {
        console.warn("[getDoctorProfile] No doctor profile found for doctor:", doctorId);
        return { specialization: "General Practice", license_number: "N/A" };
      }

      const result = {
        specialization: data.specialization?.trim() || "General Practice",
        license_number: data.license_number?.trim() || "N/A"
      };
      
      console.log("[getDoctorProfile] Doctor profile fetched:", result);
      return result;
    } catch (error) {
      console.error("[getDoctorProfile] Exception getting doctor profile:", error);
      return { specialization: "General Practice", license_number: "N/A" };
    }
  };

  const canProvideFeedback = (appointment: Appointment) => {
    const appointmentDate = new Date(appointment.appointment_date);
    const now = new Date();
    // Allow feedback for completed appointments OR approved appointments that have passed
    return (appointment.status === "completed" || appointment.status === "approved") && appointmentDate < now;
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      completed: { variant: "default" as const, label: "Completed" },
      approved: { variant: "default" as const, label: "Approved" },
      cancelled: { variant: "destructive" as const, label: "Cancelled" },
      rejected: { variant: "destructive" as const, label: "Rejected" },
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || { variant: "secondary" as const, label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getUrgencyBadge = (urgency?: string) => {
    let normalized = (urgency || "").toLowerCase();
    if (!normalized) normalized = "high";
    if (normalized === "medium" || normalized === "low") normalized = "high";

    const urgencyBadges: { [key: string]: string } = {
      critical: "bg-red-600 text-white",
      high: "bg-orange-500 text-white",
    };
    const className = urgencyBadges[normalized] || "bg-orange-500 text-white";
    return (
      <Badge className={`${className} gap-0.5 sm:gap-1 uppercase text-xs font-bold px-1.5 sm:px-2 py-0.5 sm:py-1`}>
        <AlertTriangle className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
        <span className="hidden sm:inline">{normalized}</span>
      </Badge>
    );
  };

  if (loading) {
    return (
      <Card className="p-6">
        <h3 className="text-xl font-semibold mb-4">Appointment History</h3>
        <p className="text-muted-foreground">Loading...</p>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden bg-gradient-to-br from-card to-card/50 border-primary/10 shadow-[var(--shadow-card)]">
        <div className="p-3 sm:p-6 border-b border-primary/10 bg-gradient-to-r from-primary/5 to-transparent">
          <div className="flex items-center gap-2 sm:gap-3 justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="h-8 sm:h-10 w-8 sm:w-10 rounded-lg bg-gradient-to-br from-primary to-primary-light flex items-center justify-center shadow-md">
                <Calendar className="h-4 sm:h-5 w-4 sm:w-5 text-primary-foreground" />
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-semibold">Appointment History</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">Your past consultations and feedback</p>
              </div>
            </div>
          </div>
        </div>
        
        {appointments.length === 0 ? (
          <div className="text-center py-8 sm:py-12 px-3 sm:px-6">
            <Calendar className="h-12 sm:h-16 w-12 sm:w-16 text-muted-foreground/50 mx-auto mb-2 sm:mb-3" />
            <p className="text-muted-foreground font-medium text-sm sm:text-base">No previous appointments</p>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">Your appointment history will appear here</p>
          </div>
        ) : (
          <ScrollArea className="h-[600px] p-4 sm:p-6">
            <div className="space-y-3 pr-4">
              {appointments.map((appointment) => (
                <Card
                  key={appointment.id}
                  className="group p-2 sm:p-4 border-primary/10 hover:shadow-[var(--shadow-glow)] hover:border-primary/30 transition-all duration-300 bg-gradient-to-br from-card to-card/80"
                >
                  <div className="space-y-1.5 sm:space-y-3">
                    {/* Header with doctor name and urgency badge */}
                    <div className="flex items-center justify-between gap-1.5 min-w-0">
                      <p className="text-xs sm:text-sm font-medium group-hover:text-primary transition-colors truncate flex-1">{appointment.doctor_name}</p>
                      {(appointment as any).isEmergency || (appointment as any).isEmergencyBooking && appointment.urgency_level && (
                        <span className="flex-shrink-0">{getUrgencyBadge(appointment.urgency_level)}</span>
                      )}
                    </div>

                    {/* Date, time and status row */}
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground flex-1">
                        <span>{new Date(appointment.appointment_date).toLocaleDateString()}</span>
                        <span>{new Date(appointment.appointment_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="flex-shrink-0">{getStatusBadge(appointment.status)}</div>
                    </div>

                    {appointment.reason && (
                      <div className="text-xs bg-muted/30 p-2 sm:p-2.5 rounded break-words"><span className="font-medium">Reason:</span> <span className="ml-1">{appointment.reason}</span></div>
                    )}
                    {appointment.notes && (
                      <div className="text-xs bg-muted/30 p-2 sm:p-2.5 rounded break-words"><span className="font-medium">Notes:</span> <span className="ml-1">{appointment.notes}</span></div>
                    )}

                    {/* Call button - shown 30 min before to 1 hour after appointment */}
                    {appointment.status === "approved" && canStartVideoCall(appointment.appointment_date) && (!appointment.consultation_type || appointment.consultation_type === 'online') && (
                      <div className="pt-1.5 sm:pt-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedAppointmentForVideo(appointment);
                            setVideoChatOpen(true);
                          }}
                          className="bg-blue-600 hover:bg-blue-700 text-white gap-1 h-8 w-full sm:w-auto text-xs font-medium"
                        >
                          <Video className="h-3 w-3" />
                          Join Call
                        </Button>
                      </div>
                    )}

                    {canProvideFeedback(appointment) && (
                      <div className="pt-1.5 sm:pt-2 border-t border-primary/10 space-y-1.5 sm:space-y-2">
                        <div className="flex gap-2 flex-wrap">
                          {appointment.status === "approved" && (!appointment.consultation_type || appointment.consultation_type === 'online') && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedAppointmentForVideo(appointment);
                                setVideoChatOpen(true);
                              }}
                              className="bg-blue-600 hover:bg-blue-700 text-white gap-1 h-8 text-xs font-medium"
                            >
                              <Video className="h-3 w-3" />
                              Join Call
                            </Button>
                          )}
                          
                          {feedbacks[appointment.id]?.patient_feedback ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full sm:w-auto text-xs h-8 border-primary/20 hover:bg-primary/10"
                              onClick={() =>
                                setFeedbackDialog({
                                  open: true,
                                  appointmentId: appointment.id,
                                  doctorId: appointment.doctor_id,
                                  doctorName: appointment.doctor_name || "Doctor",
                                })
                              }
                            >
                              Edit Feedback
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() =>
                                setFeedbackDialog({
                                  open: true,
                                  appointmentId: appointment.id,
                                  doctorId: appointment.doctor_id,
                                  doctorName: appointment.doctor_name || "Doctor",
                                })
                              }
                              className="sm:w-auto w-full bg-gradient-to-r from-primary to-primary-light hover:shadow-md transition-all h-8 text-xs"
                            >
                              <MessageSquare className="h-3 w-3 mr-1" />
                              Provide Feedback
                            </Button>
                          )}
                        </div>
                        
                        {feedbacks[appointment.id]?.patient_feedback ? (
                          <div className="space-y-0.5 sm:space-y-1">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                              <div className="flex items-center gap-1">
                                <MessageSquare className="h-3 w-3 text-primary flex-shrink-0" />
                                <span className="text-xs font-medium">Your Feedback</span>
                              </div>
                              <div className="flex items-center gap-0.5">
                                {Array.from({ length: 5 }).map((_, i) => (
                                  <Star
                                    key={i}
                                    className={`h-3 w-3 ${
                                      i < (feedbacks[appointment.id]?.patient_rating || 0)
                                        ? "fill-yellow-400 text-yellow-400"
                                        : "text-muted-foreground"
                                    }`}
                                  />
                                ))}
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground bg-primary/5 p-1 sm:p-1.5 rounded break-words">
                              {feedbacks[appointment.id]?.patient_feedback}
                            </p>
                          </div>
                        ) : null}

                        {feedbacks[appointment.id]?.doctor_feedback && (
                          <div className="space-y-0.5 sm:space-y-1 bg-accent/5 p-1 sm:p-1.5 rounded border border-accent/20">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                              <span className="text-xs font-medium">Doctor's Feedback</span>
                              <div className="flex items-center gap-0.5">
                                {Array.from({ length: 5 }).map((_, i) => (
                                  <Star
                                    key={i}
                                    className={`h-3 w-3 ${
                                      i < (feedbacks[appointment.id]?.doctor_rating || 0)
                                        ? "fill-yellow-400 text-yellow-400"
                                        : "text-muted-foreground"
                                    }`}
                                  />
                                ))}
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground break-words">
                              {feedbacks[appointment.id]?.doctor_feedback}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}
      </Card>

      {feedbackDialog && (
        <AppointmentFeedbackDialog
          open={feedbackDialog.open}
          onOpenChange={(open) => !open && setFeedbackDialog(null)}
          appointmentId={feedbackDialog.appointmentId}
          patientId={patientId}
          doctorId={feedbackDialog.doctorId}
          userRole="patient"
          doctorName={feedbackDialog.doctorName}
          existingFeedback={feedbacks[feedbackDialog.appointmentId]}
        />
      )}

      {selectedAppointmentForVideo && (
        <VideoChatDialog
          isOpen={videoChatOpen}
          onClose={() => {
            setVideoChatOpen(false);
            setSelectedAppointmentForVideo(null);
          }}
          appointmentId={selectedAppointmentForVideo.id}
          patientId={patientId}
          doctorId={selectedAppointmentForVideo.doctor_id}
          doctorName={selectedAppointmentForVideo.doctor_name || "Doctor"}
          userRole="patient"
          consultationType={selectedAppointmentForVideo.consultation_type || "online"}
        />
      )}
    </>
  );
};
