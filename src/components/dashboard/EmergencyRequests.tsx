import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, Clock, Phone, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface EmergencyRequest {
  id: string;
  patient_id: string;
  reason: string;
  urgency_level: string;
  status: string;
  requested_at: string;
  patient_name?: string;
  patient_email?: string;
  doctor_notes?: string;
}

interface EmergencyRequestsProps {
  doctorId: string;
}

export const EmergencyRequests = ({ doctorId }: EmergencyRequestsProps) => {
  const [requests, setRequests] = useState<EmergencyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<EmergencyRequest | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [doctorNotes, setDoctorNotes] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (doctorId) {
      fetchEmergencyRequests();
      const cleanup = subscribeToChanges();
      return cleanup;
    }
  }, [doctorId]);

  const fetchEmergencyRequests = async () => {
    try {
      setLoading(true);
      const { data: requestsData, error: requestsError } = await (supabase as any)
        .from("emergency_bookings")
        .select("id, patient_id, reason, urgency_level, status, requested_at, doctor_notes")
        .eq("doctor_id", doctorId)
        .eq("status", "pending")
        .order("requested_at", { ascending: false });

      if (requestsError) {
        console.error("Error fetching emergency requests:", requestsError);
        return;
      }

      if (!requestsData || requestsData.length === 0) {
        setRequests([]);
        return;
      }

      // Get unique patient IDs
      const patientIds = [...new Set((requestsData as any[]).map((r: any) => r.patient_id))];

      // Fetch patient names and emails
      const { data: profilesData } = await (supabase as any)
        .from("profiles")
        .select("id, full_name, email")
        .in("id", patientIds);

      // Create map for quick lookup
      const profileMap = new Map<string, { full_name: string; email: string }>(
        profilesData?.map((p: any) => [
          p.id,
          { full_name: p.full_name, email: p.email },
        ]) || []
      );

      // Format requests with patient info
      const formatted = requestsData.map((req: any) => ({
        id: req.id,
        patient_id: req.patient_id,
        reason: req.reason,
        urgency_level: req.urgency_level,
        status: req.status,
        requested_at: req.requested_at,
        contact_number: req.contact_number,
        patient_name: profileMap.get(req.patient_id)?.full_name || "Patient",
        patient_email: profileMap.get(req.patient_id)?.email,
        doctor_notes: req.doctor_notes,
      }));

      setRequests(formatted);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  const subscribeToChanges = () => {
    const channel = (supabase as any)
      .channel("doctor-emergency-requests")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "emergency_bookings",
          filter: `doctor_id=eq.${doctorId}`,
        },
        () => {
          fetchEmergencyRequests();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleApprove = async (requestId: string) => {
    setIsProcessing(true);
    try {
      if (!selectedRequest) return;

      // First, get the emergency booking details
      const { data: bookingData, error: bookingError } = await (supabase as any)
        .from("emergency_bookings")
        .select("*")
        .eq("id", requestId)
        .single();

      if (bookingError) {
        console.error("Error fetching booking data:", bookingError);
        throw bookingError;
      }

      if (!bookingData) {
        console.error("No booking data found");
        throw new Error("Could not find emergency booking");
      }

      console.log("Booking data:", bookingData);

      // Set scheduled date to now + 1 hour for the emergency appointment
      const appointmentDate = new Date();
      appointmentDate.setHours(appointmentDate.getHours() + 1);
      const scheduledDate = appointmentDate.toISOString();
      
      console.log("Current time:", new Date().toISOString());
      console.log("Scheduled appointment time:", scheduledDate);

      // Update emergency booking status and scheduled date (DO NOT create in appointments table)
      const { error: updateError } = await (supabase as any)
        .from("emergency_bookings")
        .update({
          status: "approved",
          responded_at: new Date().toISOString(),
          scheduled_date: scheduledDate,
          doctor_notes: doctorNotes,
        })
        .eq("id", requestId);

      if (updateError) throw updateError;
      
      console.log("Emergency booking approved with scheduled date:", scheduledDate);

      toast.success("Emergency booking approved! Appointment scheduled.");
      setShowDetailDialog(false);
      setDoctorNotes("");
      setSelectedRequest(null);
      
      // Refresh emergency requests after successful approval
      setTimeout(() => {
        fetchEmergencyRequests();
      }, 500);
    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to approve emergency booking");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async (requestId: string) => {
    setIsProcessing(true);
    try {
      const { error } = await (supabase as any)
        .from("emergency_bookings")
        .update({
          status: "rejected",
          responded_at: new Date().toISOString(),
          doctor_notes: doctorNotes,
        })
        .eq("id", requestId);

      if (error) throw error;

      toast.success("Emergency booking rejected");
      setShowDetailDialog(false);
      setDoctorNotes("");
      setSelectedRequest(null);
      fetchEmergencyRequests();
    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to reject emergency booking");
    } finally {
      setIsProcessing(false);
    }
  };

  const getUrgencyColor = (level: string) => {
    const colors = {
      low: "bg-blue-100 text-blue-800",
      medium: "bg-yellow-100 text-yellow-800",
      high: "bg-orange-100 text-orange-800",
      critical: "bg-red-100 text-red-800",
    };
    return colors[level as keyof typeof colors] || colors.high;
  };

  if (loading) {
    return <p className="text-muted-foreground">Loading emergency requests...</p>;
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="p-6 border-b">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-md">
              <AlertCircle className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Emergency Booking Requests</h3>
              <p className="text-sm text-muted-foreground">
                {requests.length} pending request{requests.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </div>

        <ScrollArea className="h-[600px] w-full">
          <div className="space-y-3 p-6">
            {/* Pending Requests */}
            {requests.length > 0 && (
              <div className="space-y-3">
                <h4 className="font-semibold text-sm text-muted-foreground">
                  PENDING REQUESTS
                </h4>
                {requests.map((request) => (
                  <Card
                    key={request.id}
                    className="p-3 sm:p-4 border-primary/10 hover:shadow-md transition-all cursor-pointer"
                    onClick={() => {
                      setSelectedRequest(request);
                      setDoctorNotes(request.doctor_notes || "");
                      setShowDetailDialog(true);
                    }}
                  >
                    <div className="space-y-2 sm:space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-xs sm:text-sm">
                            {request.patient_name || "Patient"}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {request.patient_email}
                          </p>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <Badge className={getUrgencyColor(request.urgency_level)}>
                            {request.urgency_level.toUpperCase()}
                          </Badge>
                        </div>
                      </div>

                      <p className="text-xs sm:text-sm line-clamp-2 text-gray-900 font-medium">
                        {request.reason}
                      </p>

                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span className="truncate">
                            {formatDistanceToNow(new Date(request.requested_at), {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2 pt-2 w-full">
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 flex-1 text-xs sm:text-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRequest(request);
                            setDoctorNotes("");
                            setShowDetailDialog(true);
                          }}
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="flex-1 text-xs sm:text-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRequest(request);
                            setDoctorNotes("");
                            setShowDetailDialog(true);
                          }}
                        >
                          <XCircle className="h-3 w-3 mr-1" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {requests.length === 0 && (
              <div className="text-center py-12">
                <AlertCircle className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">
                  No pending emergency booking requests
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </Card>

      {/* Detail Dialog */}
      {selectedRequest && (
        <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Emergency Booking Details</DialogTitle>
              <DialogDescription>
                Patient: {selectedRequest.patient_name}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <p className="text-sm font-semibold">Urgency Level</p>
                <Badge className={getUrgencyColor(selectedRequest.urgency_level)}>
                  {selectedRequest.urgency_level.toUpperCase()}
                </Badge>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Reason</p>
                <p className="text-sm p-3 bg-slate-100 text-slate-900 rounded border border-slate-200">
                  {selectedRequest.reason}
                </p>
              </div>

              {selectedRequest.status === "pending" && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Doctor Notes</p>
                  <Textarea
                    placeholder="Add notes or instructions for the patient..."
                    value={doctorNotes}
                    onChange={(e) => setDoctorNotes(e.target.value)}
                    className="min-h-[100px] text-slate-900"
                  />
                </div>
              )}

              {selectedRequest.doctor_notes && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Doctor Notes</p>
                  <p className="text-sm p-3 bg-slate-100 text-slate-900 rounded border border-slate-200">
                    {selectedRequest.doctor_notes}
                  </p>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDetailDialog(false)}
              >
                Close
              </Button>
              {selectedRequest.status === "pending" && (
                <>
                  <Button
                    className="bg-red-600 hover:bg-red-700"
                    onClick={() => handleReject(selectedRequest.id)}
                    disabled={isProcessing}
                  >
                    {isProcessing ? "Processing..." : "Reject"}
                  </Button>
                  <Button
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => handleApprove(selectedRequest.id)}
                    disabled={isProcessing}
                  >
                    {isProcessing ? "Processing..." : "Approve"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
