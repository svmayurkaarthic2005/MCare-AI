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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Upload, X, Download, Plus, Trash2, QrCode, Eye } from "lucide-react";
import { toast } from "sonner";
import { downloadPrescriptionPDF, generatePrescriptionQRCode } from "@/lib/generatePrescriptionPDF";

interface Medicine {
  id: string;
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  notes?: string;
}

interface Prescription {
  id: string;
  medicines: Medicine[];
  notes?: string;
  file_url?: string;
  file_path?: string;
  created_at: string;
}

interface PrescriptionUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentId: string;
  doctorId: string;
  patientId: string;
  patientName: string;
  patientEmail: string;
  doctorName: string;
  doctorLicense?: string;
  doctorSpecialization?: string;
  appointmentDate: string;
  prescriptions?: Prescription[];
  onPrescriptionAdded?: () => void;
  isEmergencyBooking?: boolean;
}

export const PrescriptionUploadDialog = ({
  open,
  onOpenChange,
  appointmentId,
  doctorId,
  patientId,
  patientName,
  patientEmail,
  doctorName,
  doctorLicense,
  doctorSpecialization,
  appointmentDate,
  prescriptions = [],
  onPrescriptionAdded,
  isEmergencyBooking = false,
}: PrescriptionUploadDialogProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [currentMedicine, setCurrentMedicine] = useState<Partial<Medicine>>({
    medicine_name: "",
    dosage: "",
    frequency: "",
    duration: "",
    notes: "",
  });
  const [prescriptionNotes, setPrescriptionNotes] = useState("");
  const [patientTemperature, setPatientTemperature] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [qrPreviewUrl, setQrPreviewUrl] = useState<string | null>(null);
  const [showQrPreview, setShowQrPreview] = useState(false);
  const [generatingQR, setGeneratingQR] = useState(false);
  // Confirmation state for delete — avoids blocking window.confirm
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Fetch and log doctor info when dialog opens or props change
  useEffect(() => {
    if (open) {
      console.log("PrescriptionUploadDialog opened with doctor info:", {
        doctorName,
        doctorLicense,
        doctorSpecialization,
        patientName,
        patientEmail,
      });

      // If doctor license or specialization are empty, try to fetch from doctor_profiles
      if (!doctorLicense || !doctorSpecialization) {
        fetchDoctorProfileInfo();
      }
    }
  }, [open, doctorName, doctorLicense, doctorSpecialization, patientName, patientEmail]);

  const fetchDoctorProfileInfo = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn("[fetchDoctorProfileInfo] No user found");
        return;
      }

      // Query doctor_profiles by user_id using maybeSingle to handle missing data gracefully
      const { data, error } = await (supabase as any)
        .from("doctor_profiles")
        .select("license_number, specialization")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("[fetchDoctorProfileInfo] Error fetching doctor profile:", error);
        return;
      }

      if (data) {
        console.log("[fetchDoctorProfileInfo] Fetched doctor profile info:", {
          license_number: data.license_number,
          specialization: data.specialization,
        });
      } else {
        console.warn("[fetchDoctorProfileInfo] No doctor profile found for user:", user.id);
      }
    } catch (error) {
      console.error("[fetchDoctorProfileInfo] Exception fetching doctor profile:", error);
    }
  };

  const generateMedicineId = () => `med-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const addMedicine = () => {
    if (!currentMedicine.medicine_name?.trim() || !currentMedicine.dosage?.trim() || 
        !currentMedicine.frequency?.trim() || !currentMedicine.duration?.trim()) {
      toast.error("Please fill in all medicine details");
      return;
    }

    const newMedicine: Medicine = {
      id: generateMedicineId(),
      medicine_name: currentMedicine.medicine_name || "",
      dosage: currentMedicine.dosage || "",
      frequency: currentMedicine.frequency || "",
      duration: currentMedicine.duration || "",
      notes: currentMedicine.notes || "",
    };

    setMedicines([...medicines, newMedicine]);
    setCurrentMedicine({
      medicine_name: "",
      dosage: "",
      frequency: "",
      duration: "",
      notes: "",
    });
    toast.success("Medicine added");
  };

  const removeMedicine = (id: string) => {
    setMedicines(medicines.filter(m => m.id !== id));
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File size must be less than 10MB");
        return;
      }

      // Validate file type
      const validTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
      if (!validTypes.includes(file.type)) {
        toast.error("File must be PDF, JPG, or PNG");
        return;
      }

      setSelectedFile(file);

      // Create preview for images
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setPreviewUrl(e.target?.result as string);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const uploadFile = async (file: File): Promise<string | null> => {
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${appointmentId}-${Date.now()}.${fileExt}`;
      const filePath = `prescriptions/${patientId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("medical-records")
        .upload(filePath, file, { upsert: false });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        throw uploadError;
      }

      // Get public URL
      const { data } = supabase.storage
        .from("medical-records")
        .getPublicUrl(filePath);

      return data.publicUrl;
    } catch (error) {
      console.error("Error uploading file:", error);
      toast.error("Failed to upload file");
      return null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (medicines.length === 0) {
      toast.error("Please add at least one medicine");
      return;
    }

    setIsSubmitting(true);
    setIsUploading(selectedFile ? true : false);

    try {
      let fileUrl: string | null = null;
      let filePath: string | null = null;

      // Upload file if selected
      if (selectedFile) {
        fileUrl = await uploadFile(selectedFile);
        if (!fileUrl) {
          setIsSubmitting(false);
          setIsUploading(false);
          return;
        }
        filePath = `prescriptions/${patientId}/${selectedFile.name}`;
      }

      // Insert prescription record with doctor information
      const { error: insertError } = await (supabase as any)
        .from("prescriptions")
        .insert([
          {
            ...(isEmergencyBooking 
              ? { emergency_booking_id: appointmentId }
              : { appointment_id: appointmentId }
            ),
            doctor_id: doctorId,
            patient_id: patientId,
            medicines: medicines,
            notes: prescriptionNotes || null,
            file_url: fileUrl,
            file_path: filePath,
            doctor_name: doctorName || "Doctor",
            doctor_license: doctorLicense || "N/A",
            doctor_specialization: doctorSpecialization || "General Practice",
          },
        ]);

      if (insertError) throw insertError;

      toast.success("Prescription uploaded successfully");

      // Reset form
      setMedicines([]);
      setCurrentMedicine({
        medicine_name: "",
        dosage: "",
        frequency: "",
        duration: "",
        notes: "",
      });
      setPrescriptionNotes("");
      setPatientTemperature("");
      setSelectedFile(null);
      setPreviewUrl(null);

      onPrescriptionAdded?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error adding prescription:", error);
      toast.error("Failed to add prescription");
    } finally {
      setIsSubmitting(false);
      setIsUploading(false);
    }
  };

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
      a.download = `Prescription-${prescription.created_at.split("T")[0]}.pdf`;
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

  const deletePrescription = async (prescriptionId: string) => {
    // Use state-based confirmation instead of blocking window.confirm
    setConfirmDeleteId(prescriptionId);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    const prescriptionId = confirmDeleteId;
    setConfirmDeleteId(null);

    try {
      const { error } = await (supabase as any)
        .from("prescriptions")
        .delete()
        .eq("id", prescriptionId);

      if (error) throw error;

      toast.success("Prescription deleted successfully");
      onPrescriptionAdded?.();
    } catch (error) {
      console.error("Error deleting prescription:", error);
      toast.error("Failed to delete prescription");
    }
  };

  const generateAndPreviewQR = async () => {
    if (medicines.length === 0) {
      toast.error("Please add at least one medicine first");
      return;
    }

    setGeneratingQR(true);
    try {
      console.log("[generateAndPreviewQR] Doctor info:", {
        doctorName,
        doctorLicense,
        doctorSpecialization,
      });

      const prescriptionData = {
        id: `TEMP-${Date.now()}`,
        doctorName,
        doctorLicense: doctorLicense?.trim() || "N/A",
        doctorSpecialization: doctorSpecialization?.trim() || "General",
        patientName,
        patientEmail,
        patientTemperature: patientTemperature || undefined,
        appointmentDate,
        medicines,
        generalNotes: prescriptionNotes,
        createdAt: new Date().toISOString(),
      };

      console.log("[generateAndPreviewQR] Prescription data:", prescriptionData);

      const qrUrl = await generatePrescriptionQRCode(prescriptionData);
      setQrPreviewUrl(qrUrl);
      setShowQrPreview(true);
      toast.success("QR code generated");
    } catch (error) {
      console.error("Error generating QR:", error);
      toast.error("Failed to generate QR code");
    } finally {
      setGeneratingQR(false);
    }
  };

  const previewAndDownloadPDF = async () => {
    if (medicines.length === 0) {
      toast.error("Please add at least one medicine first");
      return;
    }

    try {
      console.log("[previewAndDownloadPDF] Doctor info:", {
        doctorName,
        doctorLicense,
        doctorSpecialization,
      });

      const prescriptionData = {
        id: `TEMP-${Date.now()}`,
        doctorName,
        doctorLicense: doctorLicense?.trim() || "N/A",
        doctorSpecialization: doctorSpecialization?.trim() || "General",
        patientName,
        patientEmail,
        patientTemperature: patientTemperature || undefined,
        appointmentDate,
        medicines,
        generalNotes: prescriptionNotes,
        createdAt: new Date().toISOString(),
      };

      await downloadPrescriptionPDF(prescriptionData);
      toast.success("PDF downloaded successfully");
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.error("Failed to generate PDF");
    }
  };

  const downloadPrescriptionWithQR = async (prescription: Prescription) => {
    try {
      console.log("[downloadPrescriptionWithQR] Doctor info:", {
        doctorName,
        doctorLicense,
        doctorSpecialization,
      });

      const prescriptionData = {
        id: prescription.id,
        doctorName,
        doctorLicense: doctorLicense?.trim() || "N/A",
        doctorSpecialization: doctorSpecialization?.trim() || "General",
        patientName,
        patientEmail,
        patientTemperature: patientTemperature || undefined,
        appointmentDate,
        medicines: prescription.medicines,
        generalNotes: prescription.notes,
        createdAt: prescription.created_at,
      };

      console.log("[downloadPrescriptionWithQR] Prescription data:", prescriptionData);

      await downloadPrescriptionPDF(prescriptionData);
      toast.success("Prescription PDF downloaded");
    } catch (error) {
      console.error("Error downloading prescription:", error);
      toast.error("Failed to download prescription");
    }
  };

  return (
  <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-2xl max-h-[90vh] overflow-y-auto sm:max-w-md md:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">Manage Prescriptions</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Add or view prescriptions for {patientName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Existing Prescriptions */}
          {prescriptions.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-semibold text-sm">Existing Prescriptions</h4>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {prescriptions.map((prescription) => (
                  <Card key={prescription.id} className="p-3 bg-gradient-to-r from-primary/5 to-accent/5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <h5 className="font-medium text-sm">
                            Prescription ({prescription.medicines.length} medicine{prescription.medicines.length !== 1 ? 's' : ''})
                          </h5>
                        </div>
                        <div className="space-y-1 text-xs">
                          {prescription.medicines.map((med, idx) => (
                            <div key={med.id} className="bg-background/50 p-1.5 rounded">
                              <p className="font-medium text-xs">{idx + 1}. {med.medicine_name}</p>
                              <p className="text-muted-foreground">
                                {med.dosage} • {med.frequency} • {med.duration}
                              </p>
                              {med.notes && (
                                <p className="text-muted-foreground italic text-xs">
                                  Note: {med.notes}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                        {prescription.notes && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Instructions: {prescription.notes}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(prescription.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0 flex-wrap sm:flex-nowrap justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => downloadPrescriptionWithQR(prescription)}
                          title="Download prescription as PDF with QR code"
                          className="h-7 w-7 p-0 sm:h-8 sm:w-8"
                        >
                          <Download className="h-3 w-3 sm:h-4 sm:w-4" />
                        </Button>
                        {prescription.file_url && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => downloadPrescription(prescription)}
                            title="Download uploaded prescription file"
                            className="h-7 w-7 p-0 sm:h-8 sm:w-8"
                          >
                            <FileText className="h-3 w-3 sm:h-4 sm:w-4" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deletePrescription(prescription.id)}
                          title="Delete prescription"
                          className="h-7 w-7 p-0 sm:h-8 sm:w-8"
                        >
                          <X className="h-3 w-3 sm:h-4 sm:w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Add New Prescription Form */}
          <div className="space-y-3 pt-4 border-t">
            <h4 className="font-semibold text-sm">Add New Prescription</h4>
            <form onSubmit={handleSubmit} className="space-y-3">
              {/* Medicines List */}
              {medicines.length > 0 && (
                <div className="space-y-2 bg-primary/5 p-3 rounded-lg border border-primary/10">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Medicines ({medicines.length})</span>
                  </div>
                  <div className="space-y-2">
                    {medicines.map((medicine, idx) => (
                      <div key={medicine.id} className="flex items-start justify-between gap-2 bg-background p-2 rounded">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">{idx + 1}. {medicine.medicine_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {medicine.dosage} • {medicine.frequency} • {medicine.duration}
                          </p>
                          {medicine.notes && (
                            <p className="text-xs text-muted-foreground italic">
                              {medicine.notes}
                            </p>
                          )}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => removeMedicine(medicine.id)}
                          className="h-8 w-8 p-0 flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add Medicine Form */}
              <div className="space-y-2 bg-accent/5 p-3 rounded-lg border border-accent/10">
                <label className="text-xs font-semibold">Add Medicine</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Name *</label>
                    <Input
                      placeholder="e.g., Paracetamol"
                      value={currentMedicine.medicine_name || ""}
                      onChange={(e) =>
                        setCurrentMedicine({
                          ...currentMedicine,
                          medicine_name: e.target.value,
                        })
                      }
                      disabled={isSubmitting}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Dosage *</label>
                    <Input
                      placeholder="e.g., 500mg"
                      value={currentMedicine.dosage || ""}
                      onChange={(e) =>
                        setCurrentMedicine({
                          ...currentMedicine,
                          dosage: e.target.value,
                        })
                      }
                      disabled={isSubmitting}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Frequency *</label>
                    <Input
                      placeholder="e.g., 3 times daily"
                      value={currentMedicine.frequency || ""}
                      onChange={(e) =>
                        setCurrentMedicine({
                          ...currentMedicine,
                          frequency: e.target.value,
                        })
                      }
                      disabled={isSubmitting}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Duration *</label>
                    <Input
                      placeholder="e.g., 7 days"
                      value={currentMedicine.duration || ""}
                      onChange={(e) =>
                        setCurrentMedicine({
                          ...currentMedicine,
                          duration: e.target.value,
                        })
                      }
                      disabled={isSubmitting}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium">Additional Notes</label>
                  <Textarea
                    placeholder="e.g., Take with food, avoid alcohol"
                    value={currentMedicine.notes || ""}
                    onChange={(e) =>
                      setCurrentMedicine({
                        ...currentMedicine,
                        notes: e.target.value,
                      })
                    }
                    disabled={isSubmitting}
                    rows={1}
                    className="text-xs"
                  />
                </div>

                <Button
                  type="button"
                  onClick={addMedicine}
                  disabled={isSubmitting}
                  variant="secondary"
                  size="sm"
                  className="w-full h-8 text-xs"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Medicine to Prescription
                </Button>
              </div>

              {/* General Prescription Notes */}
              <div className="space-y-1">
                <label className="text-xs font-medium">General Instructions</label>
                <Textarea
                  placeholder="e.g., Take all medicines daily at 8am, 2pm, and 8pm"
                  value={prescriptionNotes}
                  onChange={(e) => setPrescriptionNotes(e.target.value)}
                  disabled={isSubmitting}
                  rows={2}
                />
              </div>

              {/* Patient Temperature */}
              <div className="space-y-1">
                <label className="text-xs font-medium">Patient Temperature (°F)</label>
                <Input
                  type="number"
                  placeholder="e.g., 98.6"
                  value={patientTemperature}
                  onChange={(e) => setPatientTemperature(e.target.value)}
                  disabled={isSubmitting}
                  step="0.1"
                  className="h-8 text-xs"
                />
              </div>

              {/* QR Code Preview */}
              {showQrPreview && qrPreviewUrl && (
                <div className="space-y-2 bg-blue/5 p-3 rounded-lg border border-blue/10">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <QrCode className="h-4 w-4" />
                      QR Code Preview
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowQrPreview(false)}
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex justify-center">
                    <img
                      src={qrPreviewUrl}
                      alt="Prescription QR Code"
                      className="w-32 h-32 border rounded"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Scan this QR code to share prescription details
                  </p>
                </div>
              )}

              {/* Preview and Generate Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={generateAndPreviewQR}
                  disabled={isSubmitting || medicines.length === 0 || generatingQR}
                  className="text-xs h-9 w-full whitespace-nowrap"
                >
                  <QrCode className="h-3 w-3 mr-1 flex-shrink-0" />
                  <span className="hidden sm:inline">{generatingQR ? "Generating..." : "Preview QR"}</span>
                  <span className="sm:hidden">{generatingQR ? "QR..." : "QR"}</span>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={previewAndDownloadPDF}
                  disabled={isSubmitting || medicines.length === 0}
                  className="text-xs h-9 w-full whitespace-nowrap"
                >
                  <Eye className="h-3 w-3 mr-1 flex-shrink-0" />
                  <span className="hidden sm:inline">Download PDF</span>
                  <span className="sm:hidden">PDF</span>
                </Button>
              </div>

              {/* File Upload */}
              <div className="space-y-2">
                <label className="text-xs font-medium">Upload Prescription File (Optional)</label>
                <div className="border-2 border-dashed border-primary/30 rounded-lg p-4 text-center hover:border-primary/50 transition-colors cursor-pointer">
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFileSelect}
                    disabled={isSubmitting}
                    className="hidden"
                    id="prescription-file"
                  />
                  <label htmlFor="prescription-file" className="cursor-pointer block">
                    <Upload className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                    <p className="text-xs font-medium">
                      {selectedFile ? selectedFile.name : "Click to upload or drag and drop"}
                    </p>
                    <p className="text-xs text-muted-foreground">PDF, JPG or PNG (max 10MB)</p>
                  </label>
                </div>

                {previewUrl && (
                  <div className="relative max-h-[200px] rounded-lg overflow-hidden border">
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="w-full h-auto object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        setPreviewUrl(null);
                      }}
                      className="absolute top-2 right-2 bg-destructive text-white rounded-full p-1 hover:bg-destructive/80"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              <DialogFooter className="pt-2 flex flex-col-reverse sm:flex-row gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting || medicines.length === 0} className="w-full sm:w-auto">
                  {isUploading
                    ? "Uploading..."
                    : isSubmitting
                      ? "Saving..."
                      : "Upload Prescription"}
                </Button>
              </DialogFooter>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog open={!!confirmDeleteId} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Prescription</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this prescription? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
  );
};

