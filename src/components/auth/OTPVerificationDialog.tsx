import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface OTPVerificationDialogProps {
  open: boolean;
  email: string;
  onVerificationSuccess: () => void;
  onClose?: () => void;
}

export const OTPVerificationDialog = ({
  open,
  email,
  onVerificationSuccess,
  onClose,
}: OTPVerificationDialogProps) => {
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [canResend, setCanResend] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  // Countdown timer for resend
  useEffect(() => {
    if (resendCountdown > 0) {
      const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (resendCountdown === 0 && !canResend && open) {
      setCanResend(true);
    }
  }, [resendCountdown, canResend, open]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setOtp("");
      setError("");
      setSuccess(false);
      if (!canResend && resendCountdown === 0) {
        setCanResend(true);
      }
    }
  }, [open]);

  const handleVerifyOTP = async () => {
    if (!otp || otp.length !== 8) {
      setError("Please enter a valid 8-digit OTP");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Verify the OTP
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: "email",
      });

      if (verifyError) {
        setError(verifyError.message || "Invalid OTP. Please try again.");
        console.error("OTP verification error:", verifyError);
        setLoading(false);
        return;
      }

      if (!data.user) {
        setError("OTP verification failed. Please try again.");
        setLoading(false);
        return;
      }

      // OTP verified successfully
      setSuccess(true);
      setLoading(false);
      toast.success("Email verified successfully!");
      
      // Call success callback after a brief delay
      setTimeout(() => {
        onVerificationSuccess();
      }, 1500);
    } catch (err) {
      setError("An error occurred. Please try again.");
      console.error("OTP verification error:", err);
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (!canResend || resendLoading) return;

    setResendLoading(true);
    setError("");

    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
      });

      if (resendError) {
        setError(resendError.message || "Failed to resend OTP. Please try again.");
        console.error("Resend OTP error:", resendError);
        setResendLoading(false);
        return;
      }

      toast.success("OTP sent to your email!");
      setCanResend(false);
      setResendCountdown(60); // 60 second cooldown
      setOtp(""); // Clear the input
      setResendLoading(false);
    } catch (err) {
      setError("Failed to resend OTP. Please try again.");
      console.error("Resend OTP error:", err);
      setResendLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      // Only allow closing if the dialog is intentionally closed (not by accidental outside click)
      // We prevent closing while in the middle of verification
      if (!isOpen && !loading && !resendLoading) {
        onClose?.();
      }
    }}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => {
        // Prevent closing dialog by clicking/tapping outside on mobile or desktop
        e.preventDefault();
      }} onEscapeKeyDown={(e) => {
        // Prevent closing dialog with ESC key unless not loading
        if (loading || resendLoading) {
          e.preventDefault();
        }
      }}>
        <DialogHeader>
          <DialogTitle>Verify Your Email</DialogTitle>
          <DialogDescription>
            We've sent an 8-digit verification code to {email}
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center justify-center py-8">
            <CheckCircle2 className="h-12 w-12 text-green-600 mb-4" />
            <p className="text-lg font-semibold text-green-600">Email Verified!</p>
            <p className="text-sm text-muted-foreground mt-2">
              Completing your signup...
            </p>
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* OTP Input */}
            <div className="space-y-2">
              <Label htmlFor="otp">Verification Code</Label>
              <div className="flex justify-center">
                <InputOTP
                  maxLength={8}
                  value={otp}
                  onChange={setOtp}
                  disabled={loading}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                    <InputOTPSlot index={6} />
                    <InputOTPSlot index={7} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex gap-3 p-3 rounded-lg bg-red-50 border border-red-200">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Verify Button */}
            <Button
              onClick={handleVerifyOTP}
              disabled={loading || otp.length !== 8}
              className="w-full"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify Code"
              )}
            </Button>

            {/* Resend OTP Section */}
            <div className="text-center space-y-3 pt-2 border-t">
              <p className="text-sm text-muted-foreground">
                Didn't receive the code?
              </p>
              <Button
                variant="outline"
                onClick={handleResendOTP}
                disabled={!canResend || resendLoading}
                className="w-full"
              >
                {resendLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : canResend ? (
                  "Resend Code"
                ) : (
                  `Resend in ${resendCountdown}s`
                )}
              </Button>
            </div>

            {/* Help Text */}
            <div className="text-center text-xs text-muted-foreground">
              <p>Check your spam folder if you don't see the email</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
