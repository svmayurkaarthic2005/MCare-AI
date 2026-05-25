import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Loader2, Lock, Bell, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const Settings = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  
  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  
  // Notification preferences
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [appointmentAlerts, setAppointmentAlerts] = useState(true);
  const [loadingNotifications, setLoadingNotifications] = useState(false);

  // Doctor availability
  const [isAvailable, setIsAvailable] = useState<boolean>(true);
  const [availabilitySaving, setAvailabilitySaving] = useState<boolean>(false);

  // Session information
  const [sessionInfo, setSessionInfo] = useState<{
    email?: string;
    lastSignIn?: string;
    browser?: string;
    device?: string;
  }>({});

  // Load notification preferences on mount
  useEffect(() => {
    const initializeSettings = async () => {
      await loadUserRole();
      loadNotificationPreferences();
      loadSessionInfo();
    };
    
    initializeSettings();
  }, []);

  const loadUserRole = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setUserId(user.id); // Store the user ID

      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .single();

      if (error) throw error;
      if (data) {
        setUserRole(data.role);
        // Load doctor availability immediately if user is a doctor
        if (data.role === "doctor") {
          loadDoctorAvailabilityForUser(user.id);
        }
      }
    } catch (error) {
      console.error("Error loading user role:", error);
    }
  };

  const loadDoctorAvailabilityForUser = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("doctor_profiles")
        .select("available_for_consultation")
        .eq("user_id", userId)
        .single();

      if (error) {
        console.warn("Doctor profile not found, using default", error);
        return;
      }

      if (data) {
        setIsAvailable(data.available_for_consultation);
      }
    } catch (error) {
      console.error("Error loading doctor availability:", error);
    }
  };

  const loadNotificationPreferences = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("profiles")
        .select("send_email, send_whatsapp")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.warn("Notification preferences not found, using defaults", error);
        return;
      }

      if (data) {
        const prefs = data as unknown as { send_email?: boolean; send_whatsapp?: boolean };
        setEmailNotifications(prefs.send_email ?? true);
        setAppointmentAlerts(prefs.send_whatsapp ?? true);
      }
    } catch (error) {
      console.error("Error loading notification preferences:", error);
    }
  };

  const loadSessionInfo = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const userAgent = navigator.userAgent;
      
      // Improved browser detection
      let browserInfo = "Unknown";
      if (userAgent.includes("Firefox")) {
        const match = userAgent.match(/Firefox\/(\d+)/);
        browserInfo = match ? `Firefox ${match[1]}` : "Firefox";
      } else if (userAgent.includes("Chrome") && !userAgent.includes("Chromium")) {
        const match = userAgent.match(/Chrome\/(\d+)/);
        browserInfo = match ? `Chrome ${match[1]}` : "Chrome";
      } else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
        const match = userAgent.match(/Version\/(\d+)/);
        browserInfo = match ? `Safari ${match[1]}` : "Safari";
      } else if (userAgent.includes("Edge")) {
        const match = userAgent.match(/Edg\/(\d+)/);
        browserInfo = match ? `Edge ${match[1]}` : "Edge";
      } else if (userAgent.includes("Opera") || userAgent.includes("OPR")) {
        const match = userAgent.match(/(?:OPR|Opera)\/(\d+)/);
        browserInfo = match ? `Opera ${match[1]}` : "Opera";
      } else if (userAgent.includes("Chromium")) {
        const match = userAgent.match(/Chromium\/(\d+)/);
        browserInfo = match ? `Chromium ${match[1]}` : "Chromium";
      }
      
      const deviceInfo = /Mobile|Android|iPhone|iPad|iPod/.test(userAgent) ? "Mobile" : "Desktop";
      
      const lastSignIn = user.last_sign_in_at 
        ? new Date(user.last_sign_in_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        : "Not available";

      setSessionInfo({
        email: user.email,
        lastSignIn,
        browser: browserInfo,
        device: deviceInfo
      });
    } catch (error) {
      console.error("Error loading session info:", error);
    }
  };

  const loadDoctorAvailability = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await loadDoctorAvailabilityForUser(user.id);
    } catch (error) {
      console.error("Error loading doctor availability:", error);
    }
  };

  const updateDoctorAvailability = async (value: boolean) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("User not authenticated");
        return;
      }

      setAvailabilitySaving(true);

      // Get doctor's ID first
      const { data: doctorData, error: doctorError } = await supabase
        .from("doctor_profiles")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (doctorError || !doctorData) {
        throw new Error("Doctor profile not found");
      }

      const { error } = await supabase
        .from("doctor_profiles")
        .update({ available_for_consultation: value })
        .eq("id", doctorData.id);

      if (error) throw error;

      setIsAvailable(value);
      toast.success(
        value
          ? "You are now available for consultations"
          : "You are no longer available for consultations"
      );
    } catch (error: any) {
      console.error("Error updating availability:", error);
      toast.error("Failed to update availability");
    } finally {
      setAvailabilitySaving(false);
    }
  };

  const updateNotificationPreference = async (field: string, value: boolean) => {
    setLoadingNotifications(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const updateData: Record<string, boolean> = {};
      if (field === "email_notifications") {
        updateData.send_email = value;
      } else if (field === "appointment_alerts") {
        updateData.send_whatsapp = value;
      }

      const { error } = await supabase
        .from("profiles")
        .update(updateData)
        .eq("id", user.id);

      if (error) throw error;

      toast.success("Notification preference updated");
    } catch (error) {
      console.error("Error updating notification preference:", error);
      toast.error("Failed to update notification preference");
    } finally {
      setLoadingNotifications(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentPassword) {
      toast.error("Please enter your current password");
      return;
    }
    
    if (newPassword.length < 6) {
      toast.error("New password must be at least 6 characters long");
      return;
    }
    
    if (newPassword !== confirmNewPassword) {
      toast.error("New passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !user.email) {
        throw new Error("User not found");
      }

      // Verify current password by attempting to sign in
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (signInError) {
        throw new Error("Current password is incorrect");
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (updateError) throw updateError;

      toast.success("Password updated successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (error: any) {
      console.error("Error updating password:", error);
      toast.error(error.message || "Failed to update password");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      const { error } = await supabase.functions.invoke('delete-account', {
        method: 'POST',
      });

      if (error) {
        toast.error("Failed to delete account. Please try again.");
        console.error("Delete account error:", error);
        return;
      }

      await supabase.auth.signOut();
      window.location.href = "/";
    } catch (err) {
      console.error("Delete account error:", err);
      toast.error("Failed to delete account. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary/30 to-background p-4">
      <div className="max-w-4xl mx-auto py-8">
        <Button
          variant="ghost"
          onClick={() => navigate("/dashboard")}
          className="mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>

        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="text-muted-foreground mt-1">
              Manage your account preferences and security
            </p>
          </div>

          {/* Profile Information */}
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <Shield className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Profile Information</h2>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground text-sm">Profile ID</Label>
                <div className="flex items-center gap-2">
                  <code className="bg-muted p-2 rounded text-sm font-mono flex-1 break-all">
                    {userId}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(userId);
                      toast.success("Profile ID copied to clipboard");
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          {/* Password Change */}
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <Lock className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Change Password</h2>
            </div>
            
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current Password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  placeholder="Enter your current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmNewPassword">Confirm New Password</Label>
                <Input
                  id="confirmNewPassword"
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  required
                />
              </div>

              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  "Update Password"
                )}
              </Button>
            </form>
          </Card>

          {/* Notification Preferences */}
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <Bell className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Notifications</h2>
            </div>

            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="email-notifications">Email Notifications</Label>
                  <p className="text-sm text-muted-foreground">
                    Receive updates and alerts via email
                  </p>
                </div>
                <Switch
                  id="email-notifications"
                  checked={emailNotifications}
                  onCheckedChange={(checked) => {
                    setEmailNotifications(checked);
                    updateNotificationPreference("email_notifications", checked);
                  }}
                  disabled={loadingNotifications}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="appointment-alerts">Appointment Alerts</Label>
                  <p className="text-sm text-muted-foreground">
                    Reminders for upcoming appointments
                  </p>
                </div>
                <Switch
                  id="appointment-alerts"
                  checked={appointmentAlerts}
                  onCheckedChange={(checked) => {
                    setAppointmentAlerts(checked);
                    updateNotificationPreference("appointment_alerts", checked);
                  }}
                  disabled={loadingNotifications}
                />
              </div>

            </div>
          </Card>

          {/* Doctor Availability */}
          {userRole === "doctor" && (
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-6">
                <Bell className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Availability</h2>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="doctor-availability">Available for Consultations</Label>
                    <p className="text-sm text-muted-foreground">
                      Show up in patient searches when available
                    </p>
                  </div>
                  <Switch
                    id="doctor-availability"
                    checked={isAvailable}
                    onCheckedChange={(checked) => {
                      updateDoctorAvailability(checked);
                    }}
                    disabled={availabilitySaving}
                  />
                </div>
              </div>
            </Card>
          )}

          {/* Privacy & Security */}
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <Shield className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Privacy & Security</h2>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="font-medium mb-2">Delete Account</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Permanently delete your account and all associated data
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Account
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will permanently delete your
                        account and remove all your data from our servers.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDeleteAccount}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete Account
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </Card>

          {/* Session Info */}
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Session Information</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email:</span>
                <span className="font-medium">{sessionInfo.email || "Loading..."}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Device:</span>
                <span className="font-medium">{sessionInfo.device || "Loading..."}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Browser:</span>
                <span className="font-medium text-xs">{sessionInfo.browser || "Loading..."}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Sign In:</span>
                <span className="font-medium">{sessionInfo.lastSignIn || "Loading..."}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Settings;
