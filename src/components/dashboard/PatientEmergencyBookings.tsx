import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, Clock, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface EmergencyBookingStatus {
  id: string;
  doctor_id: string;
  status: string;
  urgency_level: string;
  reason: string;
  requested_at: string;
  responded_at?: string;
  doctor_name?: string;
  doctor_specialization?: string;
  doctor_notes?: string;
}

interface PatientEmergencyBookingsProps {
  patientId: string;
}

export const PatientEmergencyBookings = ({ patientId }: PatientEmergencyBookingsProps) => {
  const [bookings, setBookings] = useState<EmergencyBookingStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (patientId) {
      fetchEmergencyBookings();
      const cleanup = subscribeToChanges();
      return cleanup;
    }
  }, [patientId]);

  const fetchEmergencyBookings = async () => {
    try {
      setLoading(true);
      const { data: bookingsData, error: bookingsError } = await (supabase as any)
        .from("emergency_bookings")
        .select("id, doctor_id, status, urgency_level, reason, requested_at, responded_at, doctor_notes")
        .eq("patient_id", patientId)
        .order("requested_at", { ascending: false });

      if (bookingsError) {
        console.error("Error fetching emergency bookings:", bookingsError);
        return;
      }

      if (!bookingsData || bookingsData.length === 0) {
        setBookings([]);
        return;
      }

      // Get unique doctor IDs
      const doctorIds = [...new Set(bookingsData.map((b: any) => b.doctor_id))];

      // Fetch doctor profiles
      const { data: doctorProfilesData } = await (supabase as any)
        .from("doctor_profiles")
        .select("user_id, specialization")
        .in("user_id", doctorIds as string[]);

      // Fetch doctor names from profiles
      const { data: profilesData } = await (supabase as any)
        .from("profiles")
        .select("id, full_name")
        .in("id", doctorIds as string[]);

      // Create maps for quick lookup
      const doctorProfileMap = new Map(
        doctorProfilesData?.map((d: any) => [d.user_id, d.specialization]) || []
      );
      const profileMap = new Map(
        profilesData?.map((p: any) => [p.id, p.full_name]) || []
      );

      // Format bookings with doctor info
      const formatted = bookingsData.map((booking: any) => ({
        id: booking.id,
        doctor_id: booking.doctor_id,
        status: booking.status,
        urgency_level: booking.urgency_level,
        reason: booking.reason,
        requested_at: booking.requested_at,
        responded_at: booking.responded_at,
        contact_number: booking.contact_number,
        doctor_name: profileMap.get(booking.doctor_id) || "Doctor",
        doctor_specialization: doctorProfileMap.get(booking.doctor_id),
        doctor_notes: booking.doctor_notes,
      }));

      setBookings(formatted);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  const subscribeToChanges = () => {
    const channel = supabase
      .channel("patient-emergency-bookings")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "emergency_bookings",
          filter: `patient_id=eq.${patientId}`,
        },
        () => {
          fetchEmergencyBookings();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case "rejected":
        return <XCircle className="h-5 w-5 text-red-600" />;
      case "pending":
        return <AlertTriangle className="h-5 w-5 text-orange-600" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-600" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "approved":
        return "Approved - Doctor will contact you soon";
      case "rejected":
        return "Rejected - Consider booking a regular appointment";
      case "pending":
        return "Pending - Waiting for doctor response";
      case "completed":
        return "Completed";
      default:
        return status;
    }
  };

  if (loading) {
    return <p className="text-muted-foreground">Loading emergency bookings...</p>;
  }

  if (bookings.length === 0) {
    return (
      <Card className="p-6 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
        <p className="text-muted-foreground font-medium">
          No pending emergency bookings
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Create an emergency booking when you need urgent medical assistance
        </p>
      </Card>
    );
  }

  // Filter to show only pending bookings on the home page
  const pendingBookings = bookings.filter((b) => b.status === "pending");

  if (pendingBookings.length === 0) {
    return (
      <Card className="p-6 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
        <p className="text-muted-foreground font-medium">
          No pending emergency bookings
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Your approved bookings appear in your appointment history
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {pendingBookings.map((booking) => (
        <Card
          key={booking.id}
          className="p-4 border-l-4 border-l-orange-500 hover:shadow-md transition-shadow"
        >
          <div className="space-y-3">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                {getStatusIcon(booking.status)}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">
                    {booking.doctor_name?.startsWith('Dr.') ? booking.doctor_name : `Dr. ${booking.doctor_name || "Doctor"}`}
                    {booking.doctor_specialization && (
                      <span className="text-xs text-muted-foreground ml-2">
                        ({booking.doctor_specialization})
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {booking.reason}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0 flex-wrap md:flex-nowrap">
                <Badge className={getUrgencyColor(booking.urgency_level)}>
                  {booking.urgency_level.toUpperCase()}
                </Badge>
                <Badge
                  variant={
                    booking.status === "approved"
                      ? "default"
                      : booking.status === "rejected"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {booking.status.toUpperCase()}
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>
                  {formatDistanceToNow(new Date(booking.requested_at), {
                    addSuffix: true,
                  })}
                </span>
              </div>
              {booking.responded_at && (
                <span className="text-green-600 font-medium">
                  Responded {formatDistanceToNow(new Date(booking.responded_at), { addSuffix: true })}
                </span>
              )}
            </div>

            <p className="text-sm text-gray-700 p-3 bg-gray-50 rounded">
              {getStatusText(booking.status)}
            </p>

            {booking.doctor_notes && (
              <div className="p-3 bg-blue-50 border-l-2 border-blue-300 rounded">
                <p className="text-xs font-semibold text-blue-900 mb-1">
                  Doctor's Instructions:
                </p>
                <p className="text-xs text-blue-800">{booking.doctor_notes}</p>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
};
