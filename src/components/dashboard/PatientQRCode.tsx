import { QRCodeSVG } from "qrcode.react";
import { Download, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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
  emergency_contact?: string;
  medications?: any[];
  health_events?: any[];
  medical_records?: any[];
}

export const PatientQRCode = ({ patient }: { patient: PatientData }) => {
  // Generate comprehensive patient data for QR Code in readable text format
  const generateQRContent = () => {
    const lines = [
      "PATIENT CLINICAL SUMMARY",
      "========================",
      "",
      "PATIENT DEMOGRAPHICS",
      `ID: ${patient.id}`,
      `Name: ${patient.full_name}`,
      `Phone: ${patient.phone || "N/A"}`,
      `DOB: ${patient.date_of_birth ? new Date(patient.date_of_birth).toLocaleDateString() : "N/A"}`,
      `Gender: ${patient.gender || "N/A"}`,
      "",
      "MEDICAL INFORMATION",
      `Blood Type: ${patient.blood_type || "N/A"}`,
      `Allergies: ${patient.allergies?.length > 0 ? patient.allergies.join("; ") : "None"}`,
      `Conditions: ${patient.chronic_conditions?.length > 0 ? patient.chronic_conditions.join("; ") : "None"}`,
      `Emergency: ${patient.emergency_contact || "N/A"}`,
    ];

    // Add medications if available
    if (patient.medications && patient.medications.length > 0) {
      lines.push("");
      lines.push("MEDICATIONS");
      patient.medications.forEach((med: any) => {
        lines.push(`- ${med.name || "Unknown"} ${med.dosage ? `(${med.dosage})` : ""}`);
      });
    }

    return lines.join("\n");
  };

  const patientDataString = generateQRContent();

  const downloadQRCode = () => {
    const svg = document.getElementById("patient-qr-code");
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      const pngFile = canvas.toDataURL("image/png");

      const downloadLink = document.createElement("a");
      downloadLink.download = `${patient.full_name}-qr-code.png`;
      downloadLink.href = pngFile;
      try {
        document.body.appendChild(downloadLink);
        downloadLink.click();
      } finally {
        document.body.removeChild(downloadLink);
      }
    };

    // Use encodeURIComponent instead of btoa to handle non-ASCII characters
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`;
  };

  return (
    <div className="w-full md:w-auto">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="w-full md:w-auto text-xs md:text-sm">
            <QrCode className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
            <span className="hidden sm:inline">Generate QR Code</span>
            <span className="inline sm:hidden">QR</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="w-[95vw] max-w-md p-4 md:p-6">
          <DialogHeader>
            <DialogTitle>Patient QR Code</DialogTitle>
            <DialogDescription>
              Scan this QR code to access key patient information
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="p-4 md:p-6 bg-white rounded-lg border-2 border-gray-200 w-full flex items-center justify-center">
              <QRCodeSVG
                id="patient-qr-code"
                value={patientDataString}
                size={Math.min(280, window.innerWidth - 80)}
                level="H"
                includeMargin={true}
                marginSize={4}
              />
            </div>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              <strong>{patient.full_name}</strong>
              <br />
              <span className="text-xs">Scan with camera or QR code reader</span>
            </p>
            <Button onClick={downloadQRCode} className="w-full">
              <Download className="h-4 w-4 mr-2" />
              Download QR Code
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
