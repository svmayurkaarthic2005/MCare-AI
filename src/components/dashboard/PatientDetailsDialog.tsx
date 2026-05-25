import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EditPatientDetails } from "./EditPatientDetails";
import { PatientQRCode } from "./PatientQRCode";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { generatePatientClinicalSummaryPDF } from "@/lib/generatePatientPDF";
import { useEffect, useState } from "react";

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

interface PatientDetailsDialogProps {
  patient: PatientData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  onStatusChange?: (patientId: string, newStatus: "active" | "inactive") => Promise<void>;
  doctorName?: string;
}

export function PatientDetailsDialog({
  patient,
  open,
  onOpenChange,
  onSave,
  onStatusChange,
  doctorName,
}: PatientDetailsDialogProps) {
  const [currentDoctor, setCurrentDoctor] = useState<string>(doctorName || "");
  const [isChangingStatus, setIsChangingStatus] = useState(false);

  useEffect(() => {
    const fetchCurrentDoctor = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile, error } = await (supabase as any)
            .from("profiles")
            .select("full_name")
            .eq("id", user.id)
            .single();
          
          if (error) {
            if (error.code !== "PGRST116") {
              console.error("Error fetching doctor profile:", error);
            }
            return;
          }
          
          if (profile?.full_name) {
            setCurrentDoctor(profile.full_name);
          }
        }
      } catch (error) {
        console.error("Error in fetchCurrentDoctor:", error);
      }
    };

    if (open && !doctorName) {
      fetchCurrentDoctor();
    }
  }, [open, doctorName]);

  if (!patient) return null;

  const handleDownloadPDF = () => {
    try {
      generatePatientClinicalSummaryPDF(patient, {
        name: currentDoctor,
        id: patient.id,
      });
      toast.success("PDF downloaded successfully");
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.error("Failed to generate PDF");
    }
  };

  const handleStatusChange = async () => {
    if (!patient || !onStatusChange) return;
    
    const newStatus = patient.status === "active" ? "inactive" : "active";
    setIsChangingStatus(true);
    try {
      await onStatusChange(patient.id, newStatus);
    } finally {
      setIsChangingStatus(false);
    }
  };

  const getFullFilePath = (filePath: string, fileName: string): string => {
    // If file_path already starts with patient.id, use it as-is
    if (filePath && filePath.startsWith(patient.id + '/')) {
      return filePath;
    }
    // If file_path doesn't include any slashes, it's just a filename
    if (filePath && !filePath.includes('/')) {
      return `${patient.id}/${filePath}`;
    }
    // If file_path has slashes but doesn't start with patient.id, prepend it
    if (filePath && filePath.includes('/')) {
      return `${patient.id}/${filePath}`;
    }
    // Fallback: if file_path is empty or invalid, try to construct from file_name
    // Extract just the filename part (after the last slash or timestamp)
    const cleanFileName = fileName.includes('/') ? fileName.split('/').pop() || fileName : fileName;
    // Try to find the file by listing storage
    return `${patient.id}/${cleanFileName}`;
  };

  const findFileInStorage = async (fileName: string): Promise<string | null> => {
    try {
      // List all files in the patient's folder
      const { data, error } = await supabase.storage
        .from("medical-records")
        .list(patient.id + '/', {
          limit: 100,
          sortBy: { column: 'created_at', order: 'desc' }
        });

      if (error) {
        console.error("Error listing files:", error);
        return null;
      }

      // Try to find a file that matches the fileName
      const matchingFile = data?.find(file => 
        file.name === fileName || 
        file.name.includes(fileName) ||
        fileName.includes(file.name)
      );

      if (matchingFile) {
        return `${patient.id}/${matchingFile.name}`;
      }

      // If no exact match, return the first file (fallback)
      if (data && data.length > 0) {
        return `${patient.id}/${data[0].name}`;
      }

      return null;
    } catch (error) {
      console.error("Error finding file in storage:", error);
      return null;
    }
  };

  const handleRecordDownload = async (filePath: string, fileName: string) => {
    try {
      let fullPath = getFullFilePath(filePath, fileName);
      console.log("Downloading file - Original path:", filePath, "File name:", fileName, "Full path:", fullPath);
      
      let { data, error } = await supabase.storage
        .from("medical-records")
        .download(fullPath);
      
      // If download fails, try to find the file in storage
      if (error) {
        console.warn("Initial download failed, searching for file in storage...");
        const foundPath = await findFileInStorage(fileName);
        if (foundPath) {
          fullPath = foundPath;
          console.log("Found file at:", fullPath);
          const result = await supabase.storage
            .from("medical-records")
            .download(fullPath);
          data = result.data;
          error = result.error;
        }
      }
      
      if (error || !data) {
        console.error("Error downloading file:", error);
        console.error("Attempted path:", fullPath);
        toast.error("Failed to download file. File may not exist in storage.");
        return;
      }
      
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      try {
        document.body.appendChild(a);
        a.click();
      } finally {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error("Error downloading file:", error);
      toast.error("Failed to download file");
    }
  };

  const handleRecordView = async (filePath: string, fileName: string) => {
    try {
      let fullPath = getFullFilePath(filePath, fileName);
      console.log("Viewing file - Original path:", filePath, "File name:", fileName, "Full path:", fullPath);
      
      let { data, error } = await supabase.storage
        .from("medical-records")
        .createSignedUrl(fullPath, 60);
      
      // If creating signed URL fails, try to find the file in storage
      if (error) {
        console.warn("Initial signed URL creation failed, searching for file in storage...");
        const foundPath = await findFileInStorage(fileName);
        if (foundPath) {
          fullPath = foundPath;
          console.log("Found file at:", fullPath);
          const result = await supabase.storage
            .from("medical-records")
            .createSignedUrl(fullPath, 60);
          data = result.data;
          error = result.error;
        }
      }
      
      if (error || !data?.signedUrl) {
        console.error("Error creating signed URL:", error);
        console.error("Attempted path:", fullPath);
        toast.error("Failed to open file. File may not exist in storage.");
        return;
      }
      
      window.open(data.signedUrl, "_blank");
    } catch (error) {
      console.error("Error viewing file:", error);
      toast.error("Failed to open file");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] w-[95vw] md:w-full p-3 md:p-6">
        <DialogHeader>
          <div className="flex flex-col gap-3 md:gap-0">
            <div className="flex items-center gap-3 md:gap-4 min-w-0">
              <Avatar className="h-12 w-12 md:h-16 md:w-16 flex-shrink-0">
                <AvatarImage src={patient.avatar_url || undefined} />
                <AvatarFallback className="text-lg md:text-xl">
                  {patient.full_name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?'}
                </AvatarFallback>
              </Avatar>
              <DialogTitle className="text-lg md:text-2xl truncate">{patient.full_name}</DialogTitle>
            </div>
            <div className="flex flex-wrap gap-2 md:absolute md:top-6 md:right-16 md:flex-nowrap">
              <Button
                onClick={handleStatusChange}
                disabled={isChangingStatus || !onStatusChange}
                variant={patient.status === "active" ? "outline" : "default"}
                title={patient.status === "active" ? "Deactivate patient" : "Activate patient"}
                size="sm"
                className="text-xs md:text-sm flex-1 md:flex-none"
              >
                {patient.status === "active" ? "Deactivate" : "Activate"}
              </Button>
              <Button
                onClick={handleDownloadPDF}
                className="gap-2 text-xs md:text-sm flex-1 md:flex-none"
                size="sm"
                title="Download patient clinical summary as PDF"
              >
                <Download className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">PDF</span>
              </Button>
              <div className="flex-1 md:flex-none">
                <PatientQRCode patient={patient} />
              </div>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="h-[60vh] md:h-[70vh] pr-2 md:pr-4">
          <div className="space-y-3 md:space-y-6">
            <EditPatientDetails patient={patient} onSave={onSave} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6 mt-3 md:mt-6">
              <Card className="p-3 md:p-4">
                <h4 className="font-semibold mb-2 md:mb-3 text-xs md:text-sm">Personal Information</h4>
                <div className="space-y-1 md:space-y-2 text-xs md:text-sm">
                  <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-2">
                    <span className="text-muted-foreground">Email:</span>
                    <span className="break-all sm:text-right">{patient.email}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-2">
                    <span className="text-muted-foreground">Phone:</span>
                    <span className="sm:text-right">{patient.phone || "N/A"}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-2">
                    <span className="text-muted-foreground">Gender:</span>
                    <span className="sm:text-right">{patient.gender || "N/A"}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-2">
                    <span className="text-muted-foreground">Date of Birth:</span>
                    <span className="sm:text-right">
                      {patient.date_of_birth
                        ? new Date(patient.date_of_birth).toLocaleDateString()
                        : "N/A"}
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-2">
                    <span className="text-muted-foreground">Emergency Contact:</span>
                    <span className="break-all sm:text-right">{patient.emergency_contact || "N/A"}</span>
                  </div>
                </div>
              </Card>

              <Card className="p-3 md:p-4">
                <h4 className="font-semibold mb-2 md:mb-3 text-sm md:text-base">Medical Information</h4>
                <div className="space-y-2 text-xs md:text-sm">
                  <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-2">
                    <span className="text-muted-foreground">Blood Type:</span>
                    <Badge variant="outline" className="self-start sm:self-auto">{patient.blood_type || "N/A"}</Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Allergies:</span>
                    <div className="flex flex-wrap gap-1">
                      {patient.allergies?.length > 0 ? (
                        patient.allergies.map((allergy, i) => (
                          <Badge key={i} variant="secondary">
                            {allergy}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm">None</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">
                      Chronic Conditions:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {patient.chronic_conditions?.length > 0 ? (
                        patient.chronic_conditions.map((condition, i) => (
                          <Badge key={i} variant="secondary">
                            {condition}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm">None</span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-3 md:p-4">
                <h4 className="font-semibold mb-2 md:mb-3 text-xs md:text-sm">Active Medications</h4>
                <div className="space-y-1 md:space-y-2 text-xs md:text-sm">
                  {patient.medications && patient.medications.length > 0 ? (
                    patient.medications.map((med: any) => (
                      <div key={med.id} className="border-b pb-1 md:pb-2">
                        <p className="font-medium text-xs md:text-sm">{med.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {med.dosage} - {med.frequency}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-xs">No active medications</p>
                  )}
                </div>
              </Card>

              <Card className="p-3 md:p-4">
                <h4 className="font-semibold mb-2 md:mb-3 text-xs md:text-sm">Recent Health Events</h4>
                <div className="space-y-1 md:space-y-2 text-xs md:text-sm">
                  {patient.health_events && patient.health_events.length > 0 ? (
                    patient.health_events.map((event: any) => (
                      <div key={event.id} className="border-b pb-1 md:pb-2">
                        <p className="font-medium text-xs md:text-sm">{event.title}</p>
                        <p className="text-muted-foreground text-xs">
                          {new Date(event.event_date).toLocaleDateString()}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-xs">No recent events</p>
                  )}
                </div>
              </Card>

              <Card className="p-3 md:p-4 md:col-span-2">
                <h4 className="font-semibold mb-2 md:mb-3 text-xs md:text-sm">Medical Records</h4>
                <div className="space-y-2 text-xs md:text-sm">
                  {patient.medical_records && patient.medical_records.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
                      {patient.medical_records.map((record: any) => (
                        <div key={record.id} className="p-2 md:p-3 border rounded-lg flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 md:gap-3 bg-secondary/30">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate text-xs md:text-sm">{record.file_name}</p>
                            <p className="text-muted-foreground text-xs">
                              {new Date(record.uploaded_at || record.created_at).toLocaleDateString()}
                            </p>
                            {record.size && (
                              <p className="text-muted-foreground text-xs">
                                {(record.size / 1024 / 1024).toFixed(2)} MB
                              </p>
                            )}
                          </div>
                          <div className="shrink-0 flex gap-1 md:gap-2 w-full sm:w-auto">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => handleRecordView(record.file_path || '', record.file_name)}
                              className="flex-1 sm:flex-auto h-8 text-xs md:text-sm"
                            >
                              View
                            </Button>
                            <Button 
                              variant="default" 
                              size="sm" 
                              onClick={() => handleRecordDownload(record.file_path || '', record.file_name)}
                              className="flex-1 sm:flex-auto h-8 text-xs md:text-sm"
                            >
                              Download
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs md:text-sm">No medical records uploaded</p>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
