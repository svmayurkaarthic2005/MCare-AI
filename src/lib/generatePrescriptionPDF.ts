// @ts-ignore - html2pdf.js doesn't have TypeScript definitions but works at runtime
import html2pdf from 'html2pdf.js';
// @ts-ignore - QRCode import uses different module structure
import * as QRCodeLib from 'qrcode';

export interface Medicine {
  id: string;
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  notes?: string;
}

export interface PrescriptionData {
  id: string;
  doctorName: string;
  doctorLicense?: string;
  doctorSpecialization?: string;
  patientName: string;
  patientEmail: string;
  patientTemperature?: string;
  appointmentDate: string;
  medicines: Medicine[];
  generalNotes?: string;
  createdAt: string;
}

/**
 * Generate QR code data URL for prescription sharing
 */
export const generatePrescriptionQRCode = async (prescription: PrescriptionData): Promise<string> => {
  try {
    // Create a compact string representation of the prescription
    const prescriptionText = formatPrescriptionAsText(prescription);
    
    // Generate QR code as data URL with optimized settings for better scannability
    const qrCodeUrl = await QRCodeLib.toDataURL(prescriptionText, {
      errorCorrectionLevel: 'M',  // Changed from 'H' to 'M' for better compatibility
      type: 'image/png',
      quality: 0.95,
      margin: 2,  // Increased from 1 to 2 for better spacing
      width: 250,  // Increased from 200 to 250 for better clarity
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    return qrCodeUrl;
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw error;
  }
};

/**
 * Format prescription as compact text for QR code
 */
const formatPrescriptionAsText = (prescription: PrescriptionData): string => {
  const medicinesText = prescription.medicines
    .map((med, idx) => {
      const notesPart = med.notes ? ` (${med.notes})` : '';
      return `${idx + 1}. ${med.medicine_name} ${med.dosage}, ${med.frequency}, ${med.duration}${notesPart}`;
    })
    .join('\n');

  return `PRESCRIPTION
Patient: ${prescription.patientName}
Doctor: ${prescription.doctorName}
Date: ${new Date(prescription.createdAt).toLocaleDateString()}
Medicines:
${medicinesText}
${prescription.generalNotes ? `\nInstructions: ${prescription.generalNotes}` : ''}`;
};

/**
 * Generate formatted PDF from prescription data
 */
export const generatePrescriptionPDF = async (
  prescription: PrescriptionData,
  qrCodeUrl?: string
): Promise<void> => {
  const element = document.createElement('div');
  element.innerHTML = createPrescriptionHTML(prescription, qrCodeUrl);
  document.body.appendChild(element);

  try {
    const options = {
      margin: [10, 10, 20, 10],
      filename: `prescription-${prescription.patientName}-${new Date().getTime()}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' },
      pagebreak: { mode: 'avoid-all' },
      logging: false,
    };

    await html2pdf().set(options).from(element).save();
  } finally {
    // Always remove the element, even if pdf generation throws
    document.body.removeChild(element);
  }
};

/**
 * Create formatted HTML for prescription following MCare template
 */
const createPrescriptionHTML = (prescription: PrescriptionData, qrCodeUrl?: string): string => {
  const medicinesRows = prescription.medicines
    .map((med) => {
      return `
        <tr>
          <td>${med.medicine_name}</td>
          <td>${med.dosage}</td>
          <td>${med.frequency}</td>
          <td>${med.duration}</td>
        </tr>
      `;
    })
    .join('');

  const createdDate = new Date(prescription.createdAt);
  const formattedDate = createdDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Mcare Prescription</title>
      <style>
        body {
          font-family: Arial, Helvetica, sans-serif;
          margin: 40px;
          margin-bottom: 60px;
          line-height: 1.6;
          color: #000000;
          background-color: #ffffff;
        }

        /* MCare Header */
        .header {
          text-align: center;
          margin-bottom: 10px;
        }

        .header h1 {
          font-size: 30px;
          margin: 0;
          padding: 0;
          letter-spacing: 1px;
          color: #000000;
        }

        hr {
          border: none;
          border-top: 2px solid #444;
          margin: 10px 0 30px 0;
        }

        /* Section titles */
        h2 {
          font-size: 20px;
          margin-bottom: 5px;
          border-bottom: 1px solid #aaa;
          padding-bottom: 3px;
          color: #000000;
        }

        /* Data table formatting */
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 25px;
        }

        table td {
          padding: 6px 4px;
          vertical-align: top;
          color: #000000;
        }

        table strong {
          color: #000000;
          font-weight: bold;
        }

        .med-table th, .med-table td {
          border: 1px solid #888;
          padding: 8px;
          color: #000000;
        }

        .med-table th {
          background-color: #f5f5f5;
          font-weight: bold;
          color: #000000;
        }

        /* Signature */
        .signature-block {
          margin-top: 50px;
          text-align: right;
        }

        .signature-img {
          height: 80px;
          width: auto;
          margin-bottom: 5px;
        }

        .footer {
          text-align: center;
          margin-top: 40px;
          margin-bottom: 20px;
          padding: 15px;
          font-size: 11px;
          color: #333333;
          line-height: 1.4;
        }
      </style>
    </head>

    <body>

      <div class="header">
        <h1>Mcare</h1>
        <hr>
      </div>

      <!-- Doctor Section -->
      <h2>Doctor Details</h2>
      <table>
        <tr><td><strong>Name:</strong></td><td>${prescription.doctorName || 'N/A'}</td></tr>
        <tr><td><strong>Specialization:</strong></td><td>${prescription.doctorSpecialization || 'N/A'}</td></tr>
        <tr><td><strong>License No:</strong></td><td>${prescription.doctorLicense || 'N/A'}</td></tr>
      </table>

      <!-- Patient Section -->
      <h2>Patient Details</h2>
      <table>
        <tr><td><strong>Name:</strong></td><td>${prescription.patientName}</td></tr>
        <tr><td><strong>Email:</strong></td><td>${prescription.patientEmail}</td></tr>
        ${prescription.patientTemperature ? `<tr><td><strong>Temperature:</strong></td><td>${prescription.patientTemperature}°F</td></tr>` : ''}
      </table>

      <!-- Appointment Info -->
      <h2>Consultation Info</h2>
      <table>
        <tr><td><strong>Appointment ID:</strong></td><td>${prescription.id}</td></tr>
      </table>

      <!-- Medicines -->
      <h2>Prescribed Medicines</h2>
      <table class="med-table">
        <thead>
          <tr>
            <th>Medicine</th>
            <th>Dosage</th>
            <th>Frequency</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          ${medicinesRows}
        </tbody>
      </table>

      <!-- Notes -->
      <h2 style="margin-top: 20px;">Doctor Notes</h2>
      <p style="color: #000000;">${prescription.generalNotes || 'N/A'}</p>

      <!-- General Instructions -->
      <h2 style="margin-top: 20px;">General Instructions</h2>
      <p style="color: #000000;">Please follow the prescribed medicines as per the dosage and frequency mentioned above. If you experience any adverse effects, please consult your doctor immediately.</p>

      <!-- QR Code Section -->
      <h2 style="margin-top: 20px;">Prescription QR Code</h2>
      ${qrCodeUrl ? `
        <div style="text-align: center; margin-bottom: 5px;">
          <img src="${qrCodeUrl}" alt="Prescription QR Code" style="width: 120px; height: 120px; border: 2px solid #333;">
          <p style="font-size: 11px; color: #666; margin: 5px 0 0 0;">Scan to share prescription details</p>
        </div>
      ` : `<p style="color: #000000;">N/A</p>`}

      <div class="footer">
        This document is digitally generated by Mcare and does not require a physical signature.
      </div>

    </body>
    </html>
  `;
};

/**
 * Download prescription as PDF
 */
export const downloadPrescriptionPDF = async (prescription: PrescriptionData): Promise<void> => {
  try {
    // Generate QR code
    const qrCodeUrl = await generatePrescriptionQRCode(prescription);

    // Generate and download PDF
    await generatePrescriptionPDF(prescription, qrCodeUrl);

    console.log('Prescription PDF downloaded successfully');
  } catch (error) {
    console.error('Error downloading prescription PDF:', error);
    throw error;
  }
};
