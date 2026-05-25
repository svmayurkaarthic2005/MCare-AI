import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, Clock, Phone } from "lucide-react";
import { toast } from "sonner";

interface Doctor {
  id: string;
  full_name: string;
  specialization?: string;
}

interface EmergencyBookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  onBookingCreated?: () => void;
}

export const EmergencyBookingDialog = ({
  open,
  onOpenChange,
  patientId,
  onBookingCreated,
}: EmergencyBookingDialogProps) => {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<string>("");
  const [urgencyLevel, setUrgencyLevel] = useState<string>("high");
  const [reason, setReason] = useState<string>("");
  const [contactNumber, setContactNumber] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) {
      fetchDoctors();
    }
  }, [open]);

  const fetchDoctors = async () => {
    try {
      setLoading(true);
      // Fetch ALL doctors from doctor_profiles
      const { data: doctorData, error: doctorError } = await supabase
        .from("doctor_profiles")
        .select("user_id, specialization");

      if (doctorError) {
        console.error("Error fetching doctor profiles:", doctorError);
        toast.error("Failed to load doctors");
        return;
      }

      // Get user info for each doctor
      const doctorIds = doctorData?.map((doc: any) => doc.user_id) || [];
      
      if (doctorIds.length === 0) {
        setDoctors([]);
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", doctorIds);

      if (profileError) {
        console.error("Error fetching profiles:", profileError);
        toast.error("Failed to load doctor names");
        return;
      }

      // Combine data
      const profileMap = new Map<string, string>(profileData?.map((p: any) => [p.id, p.full_name as string]) || []);
      
      const formattedDoctors = doctorData?.map((doc: any) => {
        const fullName = profileMap.get(doc.user_id) || "[Name not available]";
        const doctorName = fullName.startsWith('Dr.') ? fullName : `Dr. ${fullName}`;
        return {
          id: doc.user_id,
          full_name: doctorName,
          specialization: doc.specialization,
        };
      }) || [];

      console.log("Loaded doctors:", formattedDoctors);
      setDoctors(formattedDoctors);
    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to load doctors");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedDoctor) {
      toast.error("Please select a doctor");
      return;
    }

    if (!reason.trim()) {
      toast.error("Please provide a reason for emergency booking");
      return;
    }

    if (!contactNumber.trim()) {
      toast.error("Please provide a contact number");
      return;
    }

    // Validate phone number format: digits, spaces, +, -, (, ) only; min 7 digits
    const phoneDigits = contactNumber.replace(/\D/g, "");
    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      toast.error("Please enter a valid contact number (7–15 digits)");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await (supabase as any).from("emergency_bookings").insert({
        patient_id: patientId,
        doctor_id: selectedDoctor,
        reason: reason.trim(),
        urgency_level: urgencyLevel,
        status: "pending",
        contact_number: contactNumber.trim(),
      });

      if (error) {
        console.error("Error creating emergency booking:", error);
        toast.error("Failed to create emergency booking");
        return;
      }

      toast.success("Emergency booking request sent to doctor!");

      // Notify the doctor about the new emergency booking
      try {
        await supabase.functions.invoke('create-notification', {
          body: {
            user_id: selectedDoctor,
            title: '🚨 URGENT: Emergency booking request',
            message: `Emergency booking request (${urgencyLevel.toUpperCase()}) - Reason: ${reason.trim()}. Contact: ${contactNumber.trim()}`,
            type: 'emergency',
            link: `/doctor-dashboard`,
          },
        });
        console.log('Doctor notified about emergency booking request');
      } catch (notifErr) {
        console.error('Failed to notify doctor about emergency booking:', notifErr);
      }

      setReason("");
      setContactNumber("");
      setSelectedDoctor("");
      setUrgencyLevel("high");
      onOpenChange(false);
      onBookingCreated?.();
    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to create emergency booking");
    } finally {
      setIsSubmitting(false);
    }
  };

  const urgencyColors = {
    high: "bg-orange-100 text-orange-800",
    critical: "bg-red-100 text-red-800",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 flex flex-col gap-0 overflow-hidden h-[90vh]">
        <DialogHeader className="px-6 pt-6 flex-shrink-0 border-b">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-6 w-6 text-red-600" />
            <div>
              <DialogTitle>Emergency Booking</DialogTitle>
              <DialogDescription>
                Request urgent appointment with a doctor
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="space-y-6 p-6">
          {/* Important Notice */}
          <Card className="border-red-200 bg-red-50 p-4">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-800">
                <p className="font-semibold mb-1">
                  For life-threatening emergencies, call 911 immediately
                </p>
                <p>
                  This feature is for urgent but non-life-threatening medical
                  consultations
                </p>
              </div>
            </div>
          </Card>

          {/* Select Doctor */}
          <div className="space-y-2">
            <label className="text-sm font-semibold">Select Doctor</label>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading doctors...</p>
            ) : doctors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No doctors available at the moment
              </p>
            ) : (
              <Select value={selectedDoctor} onValueChange={setSelectedDoctor}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a doctor" />
                </SelectTrigger>
                <SelectContent>
                  {doctors.map((doc) => (
                    <SelectItem key={doc.id} value={doc.id}>
                      <div className="flex flex-col gap-0.5 min-w-max">
                        <span className="font-medium text-sm text-foreground">{doc.full_name?.startsWith('Dr.') ? doc.full_name : `Dr. ${doc.full_name}`}</span>
                        {doc.specialization && (
                          <span className="text-xs text-slate-600 pl-0.5">
                            {doc.specialization}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Urgency Level */}
          <div className="space-y-2">
            <label className="text-sm font-semibold">Urgency Level</label>
            <Select value={urgencyLevel} onValueChange={setUrgencyLevel}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high">
                  <Badge className="bg-orange-100 text-orange-800">High</Badge>
                </SelectItem>
                <SelectItem value="critical">
                  <Badge className="bg-red-100 text-red-800">Critical</Badge>
                </SelectItem>
              </SelectContent>
            </Select>
            <div className={`p-2 rounded text-sm ${urgencyColors[urgencyLevel as keyof typeof urgencyColors]}`}>
              <p className="font-semibold">
                {urgencyLevel.toUpperCase()} PRIORITY
              </p>
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <label className="text-sm font-semibold">Reason for Emergency</label>
            <Textarea
              placeholder="Describe your medical emergency, symptoms, or urgent concern..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              Provide detailed information about your symptoms and reason for
              urgent consultation
            </p>
          </div>

          {/* Contact Number */}
          <div className="space-y-2">
            <label className="text-sm font-semibold flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Contact Number
            </label>
            <Input
              type="tel"
              placeholder="Enter your contact number"
              value={contactNumber}
              onChange={(e) => setContactNumber(e.target.value)}
              pattern="[0-9+\-\s]+"
            />
            <p className="text-xs text-muted-foreground">
              Doctor will use this to reach you immediately
            </p>
          </div>

          {/* Info Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card className="p-3 bg-blue-50 border-blue-200">
              <div className="flex gap-2">
                <Clock className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-semibold text-blue-900">Quick Response</p>
                  <p className="text-blue-700">
                    Doctor will respond within minutes
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-3 bg-green-50 border-green-200">
              <div className="flex gap-2">
                <AlertCircle className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-semibold text-green-900">Prioritized</p>
                  <p className="text-green-700">
                    Your request will be prioritized
                  </p>
                </div>
              </div>
            </Card>
          </div>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 px-6 py-6 flex-shrink-0 border-t">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedDoctor || !reason.trim()}
            className="bg-red-600 hover:bg-red-700"
          >
            {isSubmitting ? "Requesting..." : "Request Emergency Booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
