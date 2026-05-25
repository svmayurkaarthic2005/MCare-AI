import { useState, useCallback, useRef } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import Cropper from "react-easy-crop";
import { Slider } from "@/components/ui/slider";

interface ProfilePhotoUploadProps {
  userId: string;
  currentPhotoUrl?: string | null;
  userInitials: string;
  onPhotoUpdate: (url: string) => void;
}

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (error) => reject(error));
    image.src = url;
  });

async function getCroppedImg(imageSrc: string, pixelCrop: any): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("No 2d context");
  }

  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
    }, "image/jpeg");
  });
}

export const ProfilePhotoUpload = ({
  userId,
  currentPhotoUrl,
  userInitials,
  onPhotoUpdate,
}: ProfilePhotoUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onCropComplete = useCallback((croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File size must be less than 5MB");
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      setImageSrc(reader.result as string);
      setCropDialogOpen(true);
    });
    reader.readAsDataURL(file);
  };

  const handleCropSave = async () => {
    if (!imageSrc || !croppedAreaPixels) return;

    setUploading(true);

    try {
      const croppedBlob = await getCroppedImg(imageSrc, croppedAreaPixels);
      
      // Delete old avatar if exists
      if (currentPhotoUrl) {
        // Extract just the filename from the URL (last path segment)
        const oldFileName = currentPhotoUrl.split("/").pop();
        if (oldFileName) {
          // Storage path must include the userId folder prefix
          await supabase.storage.from("avatars").remove([`${userId}/${oldFileName}`]);
        }
      }

      // Upload new avatar
      const fileExt = "jpg";
      const fileName = `${userId}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, croppedBlob, {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("avatars")
        .getPublicUrl(fileName);

      // Update profile with new avatar URL
      const { error: updateError } = await (supabase as any)
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", userId);

      if (updateError) throw updateError;

      onPhotoUpdate(publicUrl);
      toast.success("Profile photo updated successfully!");
      setCropDialogOpen(false);
      setImageSrc(null);
    } catch (error) {
      console.error("Error uploading photo:", error);
      toast.error("Failed to upload photo");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <>
      <div className="flex flex-col items-center gap-4">
        <Avatar className="h-32 w-32">
          <AvatarImage src={currentPhotoUrl || undefined} />
          <AvatarFallback className="text-3xl">{userInitials}</AvatarFallback>
        </Avatar>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Camera className="h-4 w-4 mr-2" />
            Change Photo
          </Button>
          {currentPhotoUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="hover:text-red-600 hover:bg-red-50"
              onClick={async () => {
                try {
                  const oldFileName = currentPhotoUrl.split("/").pop();
                  if (oldFileName) {
                    await supabase.storage.from("avatars").remove([`${userId}/${oldFileName}`]);
                  }
                  await (supabase as any)
                    .from("profiles")
                    .update({ avatar_url: null })
                    .eq("id", userId);
                  onPhotoUpdate("");
                  toast.success("Photo removed");
                } catch (error) {
                  toast.error("Failed to remove photo");
                }
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="hidden"
        />
      </div>

      <Dialog open={cropDialogOpen} onOpenChange={setCropDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Crop Your Photo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative h-96 bg-muted">
              {imageSrc && (
                <Cropper
                  image={imageSrc}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                />
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Zoom</label>
              <Slider
                value={[zoom]}
                min={1}
                max={3}
                step={0.1}
                onValueChange={(value) => setZoom(value[0])}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleCropSave}
                disabled={uploading}
                className="flex-1"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  "Save Photo"
                )}
              </Button>
              <Button
                variant="outline"
                className="hover:bg-red-50 hover:text-red-600"
                onClick={() => {
                  setCropDialogOpen(false);
                  setImageSrc(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
