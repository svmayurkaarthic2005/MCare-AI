import { useState } from "react";
import { Upload, Loader2, AlertCircle, Check, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface AnalysisResponse {
  [key: string]: any;
}

export const BloodReportAnalysis = ({ userId }: { userId: string }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analysisResponse, setAnalysisResponse] = useState<AnalysisResponse | null>(null);
  const [showResponse, setShowResponse] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const MAX_FILE_SIZE = 100 * 1024; // 100KB in bytes

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setError(`File size must be less than 100KB. Current size: ${(file.size / 1024).toFixed(2)}KB`);
      toast.error("File size exceeds 100KB limit");
      return;
    }

    // Validate file type (image only)
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file");
      toast.error("Only image files are allowed");
      return;
    }

    setSelectedFile(file);

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteImage = () => {
    setSelectedFile(null);
    setPreview(null);
    setError(null);
    toast.success("Image removed");
  };

  const parseAnalysisResponse = (data: any) => {
    // If data has an 'output' field that's a string, parse it
    if (data.output && typeof data.output === "string") {
      try {
        // Remove markdown code block markers if present
        let jsonString = data.output;
        if (jsonString.includes("```json")) {
          jsonString = jsonString.replace(/```json\n?/g, "").replace(/```/g, "").trim();
        }
        // Replace escaped newlines with actual newlines
        jsonString = jsonString.replace(/\\n/g, "\n");
        return JSON.parse(jsonString);
      } catch (e) {
        console.error("Failed to parse output string:", e);
        return data;
      }
    }
    return data;
  };

  const handleSubmit = async () => {
    if (!selectedFile) {
      setError("Please select an image file");
      return;
    }

    setUploading(true);
    setError(null);
    setAnalysisResponse(null);

    try {
      // Convert file to base64 using a Promise wrapper
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(selectedFile);
      });

      const webhookUrl = import.meta.env.VITE_BLOOD_ANALYSIS_WEBHOOK_URL ||
        'https://shaven-luz-superideally.ngrok-free.dev/webhook-test/62e1f220-0827-4dbc-84cf-23c8ea9d3cf3';
      const response = await fetch(webhookUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: userId,
            image: base64Data,
            fileName: selectedFile.name,
            fileSize: selectedFile.size,
            timestamp: new Date().toISOString(),
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const parsedData = parseAnalysisResponse(data);
      setAnalysisResponse(parsedData);
      setShowResponse(true);
      toast.success("Blood report analysis submitted successfully");

      // Reset form
      setSelectedFile(null);
      setPreview(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
      setError(`Failed to submit analysis: ${errorMessage}`);
      toast.error("Failed to submit blood report");
      console.error("Submission error:", err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="w-full p-8 border border-border/50 rounded-2xl bg-gradient-to-br from-card via-card to-card/50 hover:border-primary/50 transition-all duration-500">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h3 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-2">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
              <Upload className="h-5 w-5 text-white" />
            </div>
            Blood Report Analysis
          </h3>
          <p className="text-muted-foreground">Upload blood report image for AI analysis (Max 100KB)</p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200/50">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* File Upload Section */}
        {!showResponse ? (
          <div className="space-y-4">
            {/* Preview */}
            {preview && (
              <div className="relative rounded-lg overflow-hidden border border-border/50 bg-muted/30">
                <img
                  src={preview}
                  alt="Blood report preview"
                  className="w-full h-auto max-h-64 object-contain"
                />
                <div className="absolute top-2 right-2 flex items-center gap-2">
                  <div className="bg-green-500 text-white px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1">
                    <Check className="h-3 w-3" />
                    Selected
                  </div>
                  <button
                    onClick={handleDeleteImage}
                    className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-full transition-colors"
                    title="Delete image"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* File Input */}
            <div className="relative">
              <Label htmlFor="blood-report-upload" className="block text-sm font-medium mb-3">
                Upload Blood Report Image
              </Label>
              <div className="relative border-2 border-dashed border-border/50 rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer group">
                <input
                  id="blood-report-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  disabled={uploading}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                />
                <div className="space-y-2">
                  <div className="flex justify-center">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <Upload className="h-6 w-6 text-primary" />
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Click to upload or drag and drop
                    </p>
                    <p className="text-xs text-muted-foreground">PNG, JPG, GIF up to 100KB</p>
                  </div>
                </div>
              </div>
            </div>

            {/* File Info */}
            {selectedFile && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/50">
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(2)}KB
                  </p>
                </div>
                <button
                  onClick={handleDeleteImage}
                  className="p-2 rounded-lg hover:bg-red-500/10 text-red-500 hover:text-red-600 transition-colors"
                  title="Delete image"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Submit Button */}
            <Button
              onClick={handleSubmit}
              disabled={!selectedFile || uploading}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Submit for Analysis
                </>
              )}
            </Button>
          </div>
        ) : null}

        {/* Response Section */}
        {showResponse && analysisResponse && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-green-500 flex items-center justify-center">
                  <Check className="h-4 w-4 text-white" />
                </div>
                Analysis Complete
              </h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowResponse(false);
                  setAnalysisResponse(null);
                }}
              >
                Upload Another
              </Button>
            </div>

            {/* Patient Summary */}
            {analysisResponse.patient_summary && (
              <div className="space-y-3 p-4 rounded-lg bg-gradient-to-br from-blue-50 to-blue-50/50 dark:from-blue-950/20 dark:to-blue-950/10 border border-blue-200/50">
                <div className="flex items-center gap-2">
                  <h5 className="text-base font-semibold text-foreground">Overall Status</h5>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    analysisResponse.patient_summary.overall_status?.includes("Concern") 
                      ? "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400"
                      : analysisResponse.patient_summary.overall_status?.includes("Normal")
                      ? "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                      : "bg-yellow-100 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-400"
                  }`}>
                    {analysisResponse.patient_summary.overall_status}
                  </span>
                </div>
                {analysisResponse.patient_summary.key_findings && (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Key Findings:</p>
                    <ul className="space-y-2">
                      {analysisResponse.patient_summary.key_findings.map((finding: string, idx: number) => (
                        <li key={idx} className="text-sm text-foreground flex gap-2">
                          <span className="text-primary font-bold flex-shrink-0">•</span>
                          <span>{finding}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Test Results */}
            {analysisResponse.results && Array.isArray(analysisResponse.results) && (
              <div className="space-y-3">
                <h5 className="text-base font-semibold text-foreground">Blood Test Results</h5>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {analysisResponse.results.map((result: any, idx: number) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-lg border ${
                        result.status === "High"
                          ? "bg-red-50 dark:bg-red-950/10 border-red-200/50"
                          : result.status === "Low"
                          ? "bg-orange-50 dark:bg-orange-950/10 border-orange-200/50"
                          : "bg-green-50 dark:bg-green-950/10 border-green-200/50"
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <p className="font-semibold text-foreground text-sm">{result.test_name}</p>
                        <span className={`text-xs font-medium px-2 py-1 rounded ${
                          result.status === "High"
                            ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                            : result.status === "Low"
                            ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
                            : "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                        }`}>
                          {result.status}
                        </span>
                      </div>
                      <p className="text-sm text-foreground mb-2">
                        <span className="font-semibold">{result.value}</span>
                        <span className="text-muted-foreground ml-1">{result.unit}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mb-2">
                        Normal: {result.normal_range}
                      </p>
                      {result.clinical_note && (
                        <p className="text-xs text-muted-foreground italic">{result.clinical_note}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {analysisResponse.recommendations && (
              <div className="space-y-3">
                <h5 className="text-base font-semibold text-foreground">Blood Health Recommendations</h5>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {analysisResponse.recommendations.diet && (
                    <div className="p-4 rounded-lg bg-gradient-to-br from-purple-50 to-purple-50/50 dark:from-purple-950/20 dark:to-purple-950/10 border border-purple-200/50">
                      <p className="font-semibold text-foreground mb-2 flex items-center gap-2">
                        <span className="text-lg">🍎</span> Blood-Boosting Diet
                      </p>
                      <ul className="space-y-1 text-sm text-foreground">
                        {analysisResponse.recommendations.diet.map((item: string, idx: number) => (
                          <li key={idx} className="flex gap-2">
                            <span className="text-primary flex-shrink-0">✓</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {analysisResponse.recommendations.lifestyle && (
                    <div className="p-4 rounded-lg bg-gradient-to-br from-blue-50 to-blue-50/50 dark:from-blue-950/20 dark:to-blue-950/10 border border-blue-200/50">
                      <p className="font-semibold text-foreground mb-2 flex items-center gap-2">
                        <span className="text-lg">💪</span> Blood-Healthy Lifestyle
                      </p>
                      <ul className="space-y-1 text-sm text-foreground">
                        {analysisResponse.recommendations.lifestyle.map((item: string, idx: number) => (
                          <li key={idx} className="flex gap-2">
                            <span className="text-primary flex-shrink-0">✓</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {analysisResponse.recommendations.follow_up && (
                    <div className="p-4 rounded-lg bg-gradient-to-br from-green-50 to-green-50/50 dark:from-green-950/20 dark:to-green-950/10 border border-green-200/50">
                      <p className="font-semibold text-foreground mb-2 flex items-center gap-2">
                        <span className="text-lg">📋</span> Blood Work Follow-up
                      </p>
                      <ul className="space-y-1 text-sm text-foreground">
                        {analysisResponse.recommendations.follow_up.map((item: string, idx: number) => (
                          <li key={idx} className="flex gap-2">
                            <span className="text-primary flex-shrink-0">✓</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Disclaimer */}
            {analysisResponse.disclaimer && (
              <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200/50">
                <p className="text-xs text-yellow-800 dark:text-yellow-300">
                  <span className="font-semibold">⚠️ Disclaimer:</span> {analysisResponse.disclaimer}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};
