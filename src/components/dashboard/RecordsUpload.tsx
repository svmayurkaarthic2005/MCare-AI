import { useState, useEffect } from "react";
import { FileHeart, Upload, Trash2, Download, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface MedicalRecord {
  name: string;
  id: string;
  created_at: string;
  metadata: Record<string, any>;
}

const RECORD_CATEGORIES = [
  { value: "lab", label: "Lab Results" },
  { value: "prescription", label: "Prescriptions" },
  { value: "imaging", label: "Imaging" },
  { value: "report", label: "Reports" },
  { value: "other", label: "Other" },
];

export const RecordsUpload = ({ userId }: { userId: string }) => {
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    loadRecords();
  }, [userId]);

  const loadRecords = async () => {
    const { data, error } = await supabase.storage
      .from("medical-records")
      .list(`${userId}/`, {
        limit: 100,
        offset: 0,
        sortBy: { column: "created_at", order: "desc" },
      });

    if (error) {
      console.error("Error loading records:", error);
      toast.error("Failed to load medical records");
      return;
    }

    // Filter out the .emptyFolderPlaceholder file
    const filteredData = (data || []).filter(file => file.name !== '.emptyFolderPlaceholder');
    setRecords(filteredData);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size must be less than 10MB");
      return;
    }

    setUploading(true);

    const fileExt = file.name.split(".").pop();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${userId}/${Date.now()}-${sanitizedName}`;

    const { error } = await supabase.storage
      .from("medical-records")
      .upload(fileName, file);

    setUploading(false);

    if (error) {
      toast.error("Failed to upload file");
      console.error("Upload error:", error);
      return;
    }

    toast.success("File uploaded successfully");
    loadRecords();
    
    // Reset input
    event.target.value = "";
  };

  const handleDownload = async (fileName: string) => {
    setDownloading(fileName);

    const { data, error } = await supabase.storage
      .from("medical-records")
      .download(`${userId}/${fileName}`);

    setDownloading(null);

    if (error) {
      toast.error("Failed to download file");
      console.error("Download error:", error);
      return;
    }

    // Create download link and clean up reliably
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
  };

  const handleDelete = async (fileName: string) => {
    const { error } = await supabase.storage
      .from("medical-records")
      .remove([`${userId}/${fileName}`]);

    if (error) {
      toast.error("Failed to delete file");
      console.error("Delete error:", error);
      return;
    }

    toast.success("File deleted successfully");
    loadRecords();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const getFileCategory = (fileName: string) => {
    const lower = fileName.toLowerCase();
    if (lower.includes("lab") || lower.includes("test")) return "lab";
    if (lower.includes("prescription") || lower.includes("rx")) return "prescription";
    if (lower.includes("xray") || lower.includes("mri") || lower.includes("ct") || lower.includes("scan")) return "imaging";
    if (lower.includes("report")) return "report";
    return "other";
  };


  return (
    <Card className="p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
            <FileHeart className="h-6 w-6 text-accent" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">Medical Records</h3>
            <p className="text-sm text-muted-foreground hidden sm:block">
              {records.length === 0 ? "Upload and manage documents" : `${records.length} total records`}
            </p>
          </div>
        </div>
      </div>

      {/* Upload Section */}
      <div className="mt-6">
        <label htmlFor="file-upload">
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer">
            {uploading ? (
              <>
                <Loader2 className="h-10 w-10 text-primary mx-auto mb-2 animate-spin" />
                <p className="font-medium">Uploading...</p>
              </>
            ) : (
              <>
                <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                <p className="font-medium mb-1">Drop files to upload</p>
                <p className="text-sm text-muted-foreground">or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">Max size: 10MB</p>
              </>
            )}
          </div>
          <input
            id="file-upload"
            type="file"
            className="hidden"
            onChange={handleFileUpload}
            disabled={uploading}
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          />
        </label>
      </div>

      {/* Records List */}
      {records.length > 0 && (
        <div className="mt-6">
          <div className="mb-4">
            <h4 className="text-sm font-medium">All Files ({records.length})</h4>
          </div>
          <div className="space-y-3">
            {records.map((record) => {
              const category = getFileCategory(record.name);
              const categoryInfo = RECORD_CATEGORIES.find(c => c.value === category);
              
              return (
                <div
                  key={record.id}
                  className="flex items-start justify-between p-4 rounded-lg bg-secondary/30 border border-border hover:shadow-md transition-shadow"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                        {categoryInfo?.label || "Other"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(record.created_at), "MMM dd, yyyy 'at' h:mm a")}
                      </span>
                    </div>
                    <p className="font-medium truncate mb-1">{record.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {record.metadata?.size ? formatFileSize(record.metadata.size) : "Unknown size"}
                      {record.metadata?.mimetype && ` • ${record.metadata.mimetype.split('/')[1]?.toUpperCase() || 'FILE'}`}
                    </p>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDownload(record.name)}
                      disabled={downloading === record.name}
                      title="Download"
                    >
                      {downloading === record.name ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(record.name)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {records.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <FileHeart className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
          <p className="font-medium mb-1">No records uploaded yet</p>
          <p className="text-sm">Upload your first medical document to get started</p>
        </div>
      )}
    </Card>
  );
};
