import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MessageSquare, Star, Calendar, PlusCircle, Upload, Video } from "lucide-react";
import { toast } from "sonner";
import { AppointmentFeedbackDialog } from "./AppointmentFeedbackDialog";
import { VideoChatDialog } from "./VideoChatDialog";
import { PrescriptionUploadDialog } from "./PrescriptionUploadDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { hasAppointmentPassed, canStartVideoCall } from "@/lib/istTimezone";

interface Appointment {
  id: string;
  patient_id: string;
  appointment_date: string;
  status: string;
  reason: string;
  notes?: string;
  patient_name?: string;
  patient_email?: string;
  is_emergency_booking?: boolean;
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
  medicines: any[];
  notes?: string;
  file_url?: string;
  file_path?: string;
  created_at: string;
}

export const DoctorAppointmentHistory = ({ 
  doctorId, 
  doctorName = "",
  doctorLicense = "",
  doctorSpecialization = ""
}: { 
  doctorId: string;
  doctorName?: string;
  doctorLicense?: string;
  doctorSpecialization?: string;
}) => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [feedbacks, setFeedbacks] = useState<Record<string, Feedback>>({});
  const [prescriptions, setPrescriptions] = useState<Record<string, Prescription[]>>({});
  const [loading, setLoading] = useState(true);
  const [feedbackDialog, setFeedbackDialog] = useState<{
    open: boolean;
    appointmentId: string;
    patientId: string;
    patientName: string;
  } | null>(null);
  const [prescriptionDialog, setPrescriptionDialog] = useState<{
    open: boolean;
    appointmentId: string;
    patientId: string;
    patientName: string;
    patientEmail: string;
    appointmentDate: string;
    isEmergencyBooking?: boolean;
  } | null>(null);
  const [videoChatOpen, setVideoChatOpen] = useState(false);
  const [selectedAppointmentForVideo, setSelectedAppointmentForVideo] = useState<Appointment | null>(null);

  // Refs so realtime callbacks always call the latest fetch functions
  const fetchAppointmentHistoryRef = useRef<() => void>(() => {});
  const fetchFeedbacksRef = useRef<() => void>(() => {});
  const fetchPrescriptionsRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (doctorId) {
      fetchAppointmentHistory();
      fetchFeedbacks();
      fetchPrescriptions();
    }
  }, [doctorId]);

  // Real-time subscriptions
  useEffect(() => {
    if (!doctorId) return;

    try {
      const appointmentsChannel = supabase
        .channel('doctor-appointment-history')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'appointments',
            filter: `doctor_id=eq.${doctorId}`
          },
          () => {
            fetchAppointmentHistoryRef.current();
          }
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
            console.warn('Realtime subscription unavailable for appointment history');
          }
        });

      const feedbackChannel = supabase
        .channel('doctor-feedback-updates')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'appointment_feedback',
            filter: `doctor_id=eq.${doctorId}`
          },
          () => {
            fetchFeedbacksRef.current();
          }
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
            console.warn('Realtime subscription unavailable for feedback updates');
          }
        });

      const emergencyBookingsChannel = supabase
        .channel('doctor-emergency-bookings')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'emergency_bookings',
            filter: `doctor_id=eq.${doctorId}`
          },
          () => {
            fetchAppointmentHistoryRef.current();
          }
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
            console.warn('Realtime subscription unavailable for emergency bookings');
          }
        });

      return () => {
        supabase.removeChannel(appointmentsChannel);
        supabase.removeChannel(feedbackChannel);
        supabase.removeChannel(emergencyBookingsChannel);
      };
    } catch (error) {
      console.error('Failed to set up realtime subscriptions:', error);
      return () => {}; // No cleanup needed if subscription failed
    }
  }, [doctorId]);

  const fetchAppointmentHistory = async () => {
    try {
      setLoading(true);
      
      // Fetch regular appointments
      const { data, error } = await (supabase as any)
        .from("appointments")
        .select("*")
        .eq("doctor_id", doctorId)
        .in("status", ["completed", "cancelled", "rejected", "approved"])
        .order("appointment_date", { ascending: false });

      if (error) throw error;

      // Fetch approved emergency bookings
      const { data: emergencyBookings, error: emergencyError } = await (supabase as any)
        .from("emergency_bookings")
        .select("id, patient_id, status, urgency_level, reason, responded_at, scheduled_date, doctor_notes")
        .eq("doctor_id", doctorId)
        .eq("status", "approved")
        .order("scheduled_date", { ascending: false });

      if (emergencyError) throw emergencyError;
      
      // Debug: Log emergency bookings to check scheduled_date values
      if (emergencyBookings && emergencyBookings.length > 0) {
        console.log('[DoctorAppointmentHistory] Emergency bookings:', emergencyBookings.map(eb => ({
          id: eb.id,
          scheduled_date: eb.scheduled_date,
          responded_at: eb.responded_at,
          status: eb.status
        })));
      }

      // Combine both data sources
      let allAppointments: any[] = [...(data || [])];

      // Add approved emergency bookings as appointments
      if (emergencyBookings && emergencyBookings.length > 0) {
        const emergencyPatientIds = [...new Set((emergencyBookings as any[]).map((eb: any) => eb.patient_id))];
        const { data: patientProfiles } = await (supabase as any)
          .from("profiles")
          .select("id, full_name, email")
          .in("id", emergencyPatientIds);

        const emergencyAppointments = (emergencyBookings as any[]).map((eb: any) => {
          // IMPORTANT: Use scheduled_date (the actual booked appointment time) as the primary source
          // scheduled_date is set when doctor approves the emergency booking
          // DO NOT use responded_at (doctor's response time) as it's not the appointment time
          
          let appointmentTime = eb.scheduled_date;
          
          if (!appointmentTime) {
            console.warn(`[DoctorAppointmentHistory] Emergency booking ${eb.id} missing scheduled_date, falling back to responded_at`);
            appointmentTime = eb.responded_at;
          }
          
          if (!appointmentTime) {
            console.error(`[DoctorAppointmentHistory] Emergency booking ${eb.id} has no scheduled_date or responded_at!`);
            appointmentTime = new Date().toISOString();
          }
          
          return {
            id: eb.id,
            patient_id: eb.patient_id,
            doctor_id: doctorId,
            appointment_date: appointmentTime,
            status: "approved",
            reason: eb.reason,
            notes: `Emergency - ${eb.urgency_level?.toUpperCase()} | ${eb.reason}`,
            patient_name: (patientProfiles as any[])?.find((p: any) => p.id === eb.patient_id)?.full_name || "Unknown Patient",
            patient_email: (patientProfiles as any[])?.find((p: any) => p.id === eb.patient_id)?.email || "",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_emergency_booking: true,
          };
        });

        allAppointments = [...allAppointments, ...emergencyAppointments];
      }

      // Sort by appointment date
      allAppointments.sort((a, b) => 
        new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime()
      );

      // Fetch patient names for regular appointments (if not already fetched)
      const appointmentsNeedingPatients = allAppointments.filter((apt: any) => !apt.patient_name);
      if (appointmentsNeedingPatients.length > 0) {
        const patientIds = [...new Set(appointmentsNeedingPatients.map((apt: any) => apt.patient_id))];
        const { data: patientProfiles } = await (supabase as any)
          .from("profiles")
          .select("id, full_name, email")
          .in("id", patientIds);

        allAppointments = allAppointments.map((apt: any) => ({
          ...apt,
          patient_name: apt.patient_name || (patientProfiles as any[])?.find((p: any) => p.id === apt.patient_id)?.full_name || "Unknown Patient",
          patient_email: apt.patient_email || (patientProfiles as any[])?.find((p: any) => p.id === apt.patient_id)?.email || ""
        }));
      }

      setAppointments(allAppointments);
    } catch (error) {
      console.error("Error fetching appointment history:", error);
      toast.error("Failed to load appointment history");
    } finally {
      setLoading(false);
    }
  };

  const fetchFeedbacks = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from("appointment_feedback")
        .select("*")
        .eq("doctor_id", doctorId);

      if (error) throw error;

      const feedbackMap: Record<string, Feedback> = {};
      (data as any[])?.forEach((feedback: any) => {
        feedbackMap[feedback.appointment_id] = feedback as Feedback;
      });
      setFeedbacks(feedbackMap);
    } catch (error) {
      console.error("Error fetching feedbacks:", error);
    }
  };

  const fetchPrescriptions = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from("prescriptions")
        .select("*")
        .eq("doctor_id", doctorId);

      if (error) throw error;

      const prescriptionMap: Record<string, Prescription[]> = {};
      (data as any[])?.forEach((prescription: any) => {
        if (!prescriptionMap[prescription.appointment_id]) {
          prescriptionMap[prescription.appointment_id] = [];
        }
        prescriptionMap[prescription.appointment_id].push(prescription as Prescription);
      });
      setPrescriptions(prescriptionMap);
    } catch (error) {
      console.error("Error fetching prescriptions:", error);
    }
  };

  // Keep refs in sync so realtime callbacks always use the latest versions
  fetchAppointmentHistoryRef.current = fetchAppointmentHistory;
  fetchFeedbacksRef.current = fetchFeedbacks;
  fetchPrescriptionsRef.current = fetchPrescriptions;

  const canProvideFeedback = (appointment: Appointment) => {
    const appointmentDate = new Date(appointment.appointment_date);
    const now = new Date();
    // Allow feedback for completed appointments OR approved appointments that have passed
    return (appointment.status === "completed" || appointment.status === "approved") && appointmentDate < now;
  };

  const cancelAppointment = async (appointment: Appointment) => {
    try {
      // Prevent cancelling after appointment time
      if (hasAppointmentPassed(appointment.appointment_date)) {
        toast.error("Cannot cancel an appointment that has already passed");
        return;
      }

      const isEmergency = !!appointment.is_emergency_booking;
      const tableName = isEmergency ? "emergency_bookings" : "appointments";

      const updatePayload: any = {
        status: "cancelled",
        updated_at: new Date().toISOString(),
      };

      // Use doctor_notes for emergency bookings, notes for regular appointments
      if (isEmergency) {
        updatePayload.doctor_notes = "";
      } else {
        updatePayload.notes = "";
      }

      const { error } = await (supabase as any)
        .from(tableName)
        .update(updatePayload)
        .eq("id", appointment.id);

      if (error) throw error;

      toast.success("Appointment cancelled successfully");
      await fetchAppointmentHistory();
    } catch (err) {
      console.error("Error cancelling appointment:", err);
      toast.error("Failed to cancel appointment");
    }
  };

  const getStatusBadge = (status: string, notes?: string) => {
    const isEmergency = notes?.includes("Emergency -");
    const statusConfig = {
      completed: { variant: "default" as const, label: "Completed" },
      approved: { variant: "default" as const, label: isEmergency ? "Emergency - Approved" : "Approved" },
      cancelled: { variant: "destructive" as const, label: "Cancelled" },
      rejected: { variant: "destructive" as const, label: "Rejected" },
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || { variant: "secondary" as const, label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  if (loading) {
    return <p className="text-muted-foreground">Loading history...</p>;
  }

  return (
    <>
      <Card className="overflow-hidden bg-gradient-to-br from-card to-card/50 border-primary/10 shadow-[var(--shadow-card)]">
        <div className="p-3 sm:p-4 border-b border-primary/10 bg-gradient-to-r from-primary/5 to-transparent">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="h-8 sm:h-10 w-8 sm:w-10 rounded-lg bg-gradient-to-br from-primary to-primary-light flex items-center justify-center shadow-md">
              <Calendar className="h-4 sm:h-5 w-4 sm:w-5 text-primary-foreground" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-semibold">Appointment History</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">Past consultations and feedback</p>
            </div>
          </div>
        </div>
        
        {appointments.length === 0 ? (
          <div className="text-center py-8 sm:py-12 px-3 sm:px-6">
            <Calendar className="h-12 sm:h-16 w-12 sm:w-16 text-muted-foreground/50 mx-auto mb-2 sm:mb-3" />
            <p className="text-muted-foreground font-medium text-sm sm:text-base">No appointment history</p>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">Your completed appointments will appear here</p>
          </div>
        ) : (
          <ScrollArea className="h-[600px] w-full">
            <div className="space-y-2 sm:space-y-2.5 p-2 sm:p-3">
              {appointments.map((appointment) => (
                <Card key={appointment.id} className="group p-2 sm:p-2.5 border-primary/10 hover:shadow-[var(--shadow-glow)] hover:border-primary/30 transition-all duration-300 bg-gradient-to-br from-card to-card/80">
                  <div className="space-y-1 sm:space-y-1.5">
                    <div className="flex flex-col gap-1.5 sm:gap-2">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-xs sm:text-sm group-hover:text-primary transition-colors truncate">{appointment.patient_name}</p>
                          <p className="text-xs text-muted-foreground truncate hidden sm:block">{appointment.patient_email}</p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {getStatusBadge(appointment.status, appointment.notes)}
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                        <div className="flex gap-1 sm:gap-2 text-xs text-muted-foreground">
                          <span className="truncate">{new Date(appointment.appointment_date).toLocaleDateString()}</span>
                          <span className="text-xs text-muted-foreground">{new Date(appointment.appointment_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="flex w-full sm:w-auto flex-col sm:flex-row sm:items-center gap-2 sm:gap-2 sm:ml-auto">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!appointment.is_emergency_booking && !hasAppointmentPassed(appointment.appointment_date)}
                            onClick={() =>
                              setPrescriptionDialog({
                                open: true,
                                appointmentId: appointment.id,
                                patientId: appointment.patient_id,
                                patientName: appointment.patient_name || "Patient",
                                patientEmail: appointment.patient_email || "",
                                appointmentDate: appointment.appointment_date,
                                isEmergencyBooking: appointment.is_emergency_booking || false,
                              })
                            }
                            className="w-full sm:w-8 h-9 sm:h-8 p-2 sm:p-0 flex items-center justify-center border-primary/20 hover:bg-primary/10"
                            title={appointment.is_emergency_booking ? "Add or manage prescription for this emergency appointment" : hasAppointmentPassed(appointment.appointment_date) ? "Add or manage prescription for this appointment" : "Prescription can only be added after appointment time"}
                          >
                            <Upload className="h-3 w-3 sm:h-4 sm:w-4" />
                          </Button>
                          {appointment.status === "approved" && !hasAppointmentPassed(appointment.appointment_date) && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => cancelAppointment(appointment)}
                              className="w-full sm:w-auto h-8 sm:h-8 px-3 text-xs hover:bg-destructive hover:text-destructive-foreground transition-colors"
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {appointment.reason && (
                      <p className="text-xs bg-muted/30 p-1 rounded break-words"><span className="font-medium">Reason:</span> {appointment.reason}</p>
                    )}
                    {appointment.notes && (
                      <p className="text-xs bg-muted/30 p-1 rounded break-words"><span className="font-medium">Notes:</span> {appointment.notes}</p>
                    )}

                    {/* Call button - shown 30 min before to 1 hour after appointment */}
                    {appointment.status === "approved" && canStartVideoCall(appointment.appointment_date) && (!appointment.consultation_type || appointment.consultation_type === 'online') && (
                      <div className="pt-1 sm:pt-1.5">
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedAppointmentForVideo(appointment);
                            setVideoChatOpen(true);
                          }}
                          className="bg-blue-600 hover:bg-blue-700 text-white gap-1 h-8 text-xs w-full sm:w-auto font-medium"
                        >
                          <Video className="h-3 w-3" />
                          Start Call
                        </Button>
                      </div>
                    )}

                    {canProvideFeedback(appointment) && (
                      <div className="pt-1 sm:pt-1.5 border-t border-primary/10 space-y-1 sm:space-y-1.5">
                        {feedbacks[appointment.id]?.doctor_feedback ? (
                          <div className="space-y-1 sm:space-y-2">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-1">
                              <div className="flex items-center gap-1">
                                <MessageSquare className="h-3 w-3 text-primary flex-shrink-0" />
                                <span className="text-xs font-medium">Your Feedback</span>
                              </div>
                              <div className="flex items-center gap-0.5">
                                {Array.from({ length: 5 }).map((_, i) => (
                                  <Star
                                    key={i}
                                    className={`h-2.5 w-2.5 ${
                                      i < (feedbacks[appointment.id]?.doctor_rating || 0)
                                        ? "fill-yellow-400 text-yellow-400"
                                        : "text-muted-foreground"
                                    }`}
                                  />
                                ))}
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground bg-primary/5 p-1 sm:p-1.5 rounded break-words">
                              {feedbacks[appointment.id]?.doctor_feedback}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setFeedbackDialog({
                                  open: true,
                                  appointmentId: appointment.id,
                                  patientId: appointment.patient_id,
                                  patientName: appointment.patient_name || "Patient",
                                })
                              }
                              className="border-primary/20 hover:bg-primary/10 h-8 text-xs"
                            >
                              Edit Feedback
                            </Button>
                          </div>
                        ) : null}

                        <Button
                          size="sm"
                          onClick={() =>
                            setFeedbackDialog({
                              open: true,
                              appointmentId: appointment.id,
                              patientId: appointment.patient_id,
                              patientName: appointment.patient_name || "Patient",
                            })
                          }
                          className="sm:w-auto w-full bg-gradient-to-r from-primary to-primary-light hover:shadow-md transition-all h-8 text-xs"
                        >
                          <MessageSquare className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                          Provide Feedback
                        </Button>

                        {feedbacks[appointment.id]?.patient_feedback && (
                          <div className="space-y-1 sm:space-y-2 bg-accent/5 p-2 sm:p-3 rounded-lg border border-accent/20">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
                              <span className="text-xs sm:text-sm font-medium">Patient's Feedback</span>
                              <div className="flex items-center gap-1">
                                {Array.from({ length: 5 }).map((_, i) => (
                                  <Star
                                    key={i}
                                    className={`h-2.5 w-2.5 sm:h-3 sm:w-3 ${
                                      i < (feedbacks[appointment.id]?.patient_rating || 0)
                                        ? "fill-yellow-400 text-yellow-400"
                                        : "text-muted-foreground"
                                    }`}
                                  />
                                ))}
                              </div>
                            </div>
                            <p className="text-xs sm:text-sm text-muted-foreground">
                              {feedbacks[appointment.id]?.patient_feedback}
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
          patientId={feedbackDialog.patientId}
          doctorId={doctorId}
          userRole="doctor"
          patientName={feedbackDialog.patientName}
          existingFeedback={feedbacks[feedbackDialog.appointmentId]}
        />
      )}

      {prescriptionDialog && (
        <PrescriptionUploadDialog
          open={prescriptionDialog.open}
          onOpenChange={(open) => {
            if (!open) setPrescriptionDialog(null);
          }}
          appointmentId={prescriptionDialog.appointmentId}
          doctorId={doctorId}
          patientId={prescriptionDialog.patientId}
          patientName={prescriptionDialog.patientName}
          patientEmail={prescriptionDialog.patientEmail}
          doctorName={doctorName}
          doctorLicense={doctorLicense}
          doctorSpecialization={doctorSpecialization}
          appointmentDate={prescriptionDialog.appointmentDate}
          prescriptions={prescriptions[prescriptionDialog.appointmentId] || []}
          onPrescriptionAdded={() => {
            fetchPrescriptions();
          }}
          isEmergencyBooking={prescriptionDialog.isEmergencyBooking}
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
          patientId={selectedAppointmentForVideo.patient_id}
          doctorId={doctorId}
          doctorName={doctorName || "Doctor"}
          userRole="doctor"
          consultationType={selectedAppointmentForVideo.consultation_type || "online"}
        />
      )}
    </>
  );
};
