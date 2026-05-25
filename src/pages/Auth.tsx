import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, AUTH_STORAGE_KEY } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Activity, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { SignupDebugPanel } from "@/components/debug/SignupDebugPanel";
import { OTPVerificationDialog } from "@/components/auth/OTPVerificationDialog";

type UserRole = "patient" | "doctor" | "admin";

const Auth = () => {
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(false);
  const [signupStep, setSignupStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // OTP verification state
  const [showOTPDialog, setShowOTPDialog] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<UserRole | null>(null);

  // Basic auth fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Common fields
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<UserRole>("patient");

  // Patient-specific fields
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [bloodType, setBloodType] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [allergies, setAllergies] = useState("");
  const [chronicConditions, setChronicConditions] = useState("");

  // Doctor-specific fields
  const [specialization, setSpecialization] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [hospitalAffiliation, setHospitalAffiliation] = useState("");

  useEffect(() => {
    // Clean up any invalid sessions on mount
    const cleanupInvalidSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error || !session) {
          // Clear any corrupted session data
          localStorage.removeItem(AUTH_STORAGE_KEY);
          console.log('Cleared invalid session');
        } else if (session) {
          navigate("/dashboard");
        }
      } catch (err) {
        console.error('Session check error:', err);
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    };

    cleanupInvalidSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        // Stay on auth page
        console.log('User signed out');
      } else if (event === 'TOKEN_REFRESHED' && !session) {
        // Token refresh failed, clear session
        console.warn('Token refresh failed, clearing session');
        localStorage.removeItem(AUTH_STORAGE_KEY);
        await supabase.auth.signOut();
      } else if (event === 'SIGNED_IN' && session) {
        console.log('User signed in');
        navigate("/dashboard");
      }
    });

    // Keyboard shortcut for debug panel: Ctrl+Shift+D
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
        e.preventDefault();
        setShowDebugPanel(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [navigate]);


  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const validatePassword = (password: string) => {
    if (password.length < 6) return false;
    // Optionally enforce stronger password requirements
    return true;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateEmail(email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    if (!validatePassword(password)) {
      toast.error("Password must be at least 6 characters long");
      return;
    }

    setLoading(true);

    try {
      // Clear any existing invalid session before attempting login
      localStorage.removeItem(AUTH_STORAGE_KEY);
      
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          toast.error("Invalid email or password. Please try again.");
        } else if (error.message.includes("Email not confirmed")) {
          toast.error("Please verify your email before signing in. Check your inbox for a verification link.");
        } else if (error.message.includes("Refresh Token")) {
          toast.error("Session error. Please clear your browser cache and try again.");
          localStorage.removeItem(AUTH_STORAGE_KEY);
        } else {
          toast.error(error.message || "Failed to sign in. Please try again.");
        }
        setLoading(false);
        return;
      }

      toast.success("Signed in successfully!");
    } catch (error: any) {
      console.error('Sign in error:', error);
      toast.error(`Sign in failed: ${error.message}`);
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUpStep1 = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateEmail(email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    if (!validatePassword(password)) {
      toast.error("Password must be at least 6 characters long");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (!fullName.trim()) {
      toast.error("Please enter your full name");
      return;
    }

    setSignupStep(2);
  };

  const handleSignUpComplete = async (e: React.FormEvent) => {
    e.preventDefault();

    // Role-specific validation
    if (role === "patient") {
      if (!dateOfBirth) {
        toast.error("Please enter your date of birth");
        return;
      }
      if (!gender) {
        toast.error("Please select your gender");
        return;
      }
      if (!bloodType) {
        toast.error("Please select your blood type");
        return;
      }
      if (!emergencyContact.trim()) {
        toast.error("Please enter an emergency contact");
        return;
      }
    } else if (role === "doctor") {
      if (!specialization.trim()) {
        toast.error("Please enter your specialization");
        return;
      }
      if (!licenseNumber.trim()) {
        toast.error("Please enter your medical license number");
        return;
      }
    }

    setLoading(true);

    try {
      // Step 1: Create user with password (this will trigger OTP email)
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });

      if (signUpError) {
        if (signUpError.message.includes("User already registered")) {
          toast.error("This email is already registered. Please sign in instead.");
        } else {
          toast.error(signUpError.message || "Failed to create account. Please try again.");
        }
        setLoading(false);
        return;
      }

      if (!signUpData.user) {
        toast.error("Could not create user. Please try again.");
        setLoading(false);
        return;
      }

      const userId = signUpData.user.id;
      console.log("[Auth] User created, waiting for OTP verification...", userId);

      setLoading(false);
      toast.success("Account created! Verify your email with the OTP code.");

      // Show OTP verification dialog
      setOtpEmail(email);
      setPendingUserId(userId);
      setPendingRole(role);
      setShowOTPDialog(true);
      
      // Store signup data temporarily for profile creation after OTP
      sessionStorage.setItem('pendingSignupData', JSON.stringify({
        userId,
        email,
        password,
        fullName,
        phone,
        role,
        dateOfBirth,
        gender,
        bloodType,
        emergencyContact,
        allergies,
        chronicConditions,
        specialization,
        licenseNumber,
        hospitalAffiliation,
      }));
    } catch (error: any) {
      setLoading(false);
      console.error("Signup error:", error);
      toast.error(`An error occurred: ${error.message || "Please try again"}`);
    }
  };

  const handleOTPVerificationSuccess = async () => {
    if (!pendingUserId || !pendingRole) {
      toast.error("Session error. Please try signing up again.");
      return;
    }

    try {
      setLoading(true);

      // Retrieve pending signup data
      const pendingDataStr = sessionStorage.getItem('pendingSignupData');
      if (!pendingDataStr) {
        console.error("No pending signup data found");
        toast.error("Session expired. Please sign up again.");
        setShowOTPDialog(false);
        resetForm();
        setLoading(false);
        return;
      }

      const pendingData = JSON.parse(pendingDataStr);
      const {
        userId,
        fullName,
        phone,
        role,
        dateOfBirth,
        gender,
        bloodType,
        emergencyContact,
        allergies,
        chronicConditions,
        specialization,
        licenseNumber,
        hospitalAffiliation,
      } = pendingData;

      console.log("[OTP Success] Creating profile for verified user:", userId);

      // FIRST: Sign in to create a session
      console.log("[Auth] Signing in user...");
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: otpEmail,
        password: pendingData.password
      });

      if (signInError) {
        console.error("Signin error after OTP:", signInError);
        toast.error("Email verified! Please sign in with your credentials.");
        setShowOTPDialog(false);
        resetForm();
        setLoading(false);
        return;
      }

      console.log("[Auth] User signed in, waiting for session to stabilize...");

      // Verify session is established with exponential backoff
      let sessionVerified = false;
      let verifiedUser = null;
      const maxSessionRetries = 5;

      for (let attempt = 0; attempt < maxSessionRetries; attempt++) {
        const { data: { user: currentUser }, error: sessionError } = await supabase.auth.getUser();
        if (sessionError) {
          console.warn(`[Auth] Session verification attempt ${attempt + 1}/${maxSessionRetries} failed:`, sessionError);
        } else if (currentUser) {
          sessionVerified = true;
          verifiedUser = currentUser;
          console.log("[Auth] Session verified successfully for user:", currentUser.id);
          break;
        }
        if (attempt < maxSessionRetries - 1) {
          // Exponential backoff: 300ms, 600ms, 1200ms, 2400ms
          await new Promise(resolve => setTimeout(resolve, 300 * Math.pow(2, attempt)));
        }
      }

      if (!sessionVerified) {
        console.error("[Auth] Session could not be verified after OTP");
        toast.error("Session establishment failed. Please sign in again.");
        setShowOTPDialog(false);
        resetForm();
        setLoading(false);
        return;
      }

      console.log("[Auth] Now updating metadata");

      // Now we have a verified session, update metadata
      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          full_name: fullName.trim(),
        }
      });

      if (metadataError) {
        console.error("[Auth] Error updating user metadata:", metadataError);
        // Don't fail, just log it
      } else {
        console.log("[Auth] User metadata updated successfully");
      }

      // Profile data
      const profileData = {
        id: userId,
        full_name: fullName.trim(),
        email: otpEmail,
        phone: phone.trim() || null,
        date_of_birth: role === "patient" ? dateOfBirth : null,
        gender: role === "patient" ? gender : null,
        blood_type: role === "patient" ? bloodType : null,
        emergency_contact: role === "patient" ? emergencyContact.trim() : null,
        allergies: role === "patient" ? allergies.split(',').map((s: string) => s.trim()).filter(Boolean) : null,
        chronic_conditions: role === "patient" ? chronicConditions.split(',').map((s: string) => s.trim()).filter(Boolean) : null,
      };

      // Create profile
      console.log("[Auth] Creating profile for user:", userId);
      const { error: insertError } = await supabase
        .from('profiles')
        .insert([profileData]);

      let profileError = insertError;

      // If insert fails with duplicate key, update it instead
      if (insertError && insertError.code === '23505') {
        console.log("[Auth] Profile already exists, updating:", userId);
        const { error: updateError } = await supabase
          .from('profiles')
          .update(profileData)
          .eq('id', userId);
        profileError = updateError;
      }

      if (profileError && profileError.code !== '23505') {
        console.error("Profile creation/update error:", profileError);
        toast.error(`Failed to create profile: ${profileError.message}`);
        setLoading(false);
        return;
      }

      console.log("[Auth] Profile created/updated successfully");

      // Small delay to ensure session is fully propagated
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assign role
      console.log("[Auth] Assigning role:", role, "to user:", userId);
      const { data: roleInsertData, error: roleError } = await supabase
        .from('user_roles')
        .insert([{ user_id: userId, role: role }])
        .select();

      console.log("[Auth] Role insert response:", { data: roleInsertData, error: roleError });

      // If role insert fails with permission denied, it might be an RLS issue
      if (roleError) {
        console.error("Role assignment error:", roleError);
        
        // Check if it's an RLS/permission issue
        if (roleError.message && (roleError.message.includes("policy") || roleError.message.includes("permission"))) {
          console.warn("RLS policy blocking role insert, attempting with explicit session verification");
          // Get fresh session to ensure permissions
          const { data: { session: freshSession } } = await supabase.auth.getSession();
          if (!freshSession) {
            toast.error("Session lost. Please sign in again.");
            setLoading(false);
            return;
          }
        } else if (roleError.code !== '23505') {
          // Only fail if it's not a duplicate key error
          toast.error(`Failed to assign role: ${roleError.message}`);
          setLoading(false);
          return;
        }
      }

      console.log("[Auth] Role assigned successfully:", role);

      // Doctor-specific profile
      if (role === 'doctor') {
        console.log("[Auth] Creating doctor profile for user:", userId);

        const doctorProfileData = {
          user_id: userId,
          specialization: specialization.trim(),
          license_number: licenseNumber.trim(),
          hospital_affiliation: hospitalAffiliation.trim() || null,
        };

        const { error: doctorInsertError } = await supabase
          .from('doctor_profiles')
          .insert([doctorProfileData]);

        if (doctorInsertError && doctorInsertError.code === '23505') {
          const { error: doctorUpdateError } = await supabase
            .from('doctor_profiles')
            .update(doctorProfileData)
            .eq('user_id', userId);

          if (doctorUpdateError) {
            console.error("Doctor profile update error:", doctorUpdateError);
            toast.error(`Failed to update doctor profile: ${doctorUpdateError.message}`);
            setLoading(false);
            return;
          }
        } else if (doctorInsertError) {
          console.error("Doctor profile creation error:", doctorInsertError);
          toast.error(`Failed to create doctor profile: ${doctorInsertError.message}`);
          setLoading(false);
          return;
        }

        console.log("[Auth] Doctor profile created/updated successfully");
      }

      // Clear pending signup data
      sessionStorage.removeItem('pendingSignupData');

      // Verify role was assigned (with retries in case of timing issues)
      console.log("[Auth] Verifying role was assigned for user:", userId);
      let roleVerify = null;
      let roleVerifyError = null;
      const maxVerifyRetries = 3;

      for (let attempt = 0; attempt < maxVerifyRetries; attempt++) {
        const response = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId);

        if (response.error) {
          roleVerifyError = response.error;
        } else if (response.data && response.data.length > 0) {
          roleVerify = response.data;
          break;
        }
        if (attempt < maxVerifyRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 300 * Math.pow(2, attempt)));
        }
      }

      console.log("[Auth] Role verify response:", { data: roleVerify, error: roleVerifyError });

      if (roleVerifyError) {
        console.error("Role verification error:", roleVerifyError);
      }

      if (!roleVerify || roleVerify.length === 0) {
        console.error("Role not found after OTP verification - roleVerify:", roleVerify);
        toast.error("Account setup incomplete. Please refresh and try again.");
        setShowOTPDialog(false);
        resetForm();
        setLoading(false);
        return;
      }

      const assignedRole = roleVerify[0].role;
      console.log("User role confirmed:", assignedRole);

      setShowOTPDialog(false);
      setLoading(false);
      resetForm();

      toast.success("Email verified!");

      // User is already signed in from earlier, just navigate
      if (assignedRole === 'doctor') {
        navigate('/doctor-dashboard');
      } else {
        navigate('/dashboard');
      }
    } catch (error: any) {
      setLoading(false);
      console.error("OTP verification success handler error:", error);
      toast.error(`An error occurred: ${error.message || "Please try again"}`);
    }
  };

  const resetForm = () => {
    setIsSignUp(false);
    setSignupStep(1);
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setFullName("");
    setPhone("");
    setDateOfBirth("");
    setGender("");
    setBloodType("");
    setEmergencyContact("");
    setAllergies("");
    setChronicConditions("");
    setSpecialization("");
    setLicenseNumber("");
    setHospitalAffiliation("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary/30 to-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl p-8 shadow-xl relative">
        <div className="flex items-center justify-center gap-3 mb-8 pt-16">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-primary-light flex items-center justify-center">
            <Activity className="h-7 w-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">MCare</h1>
            <p className="text-sm text-muted-foreground">Your Health Dashboard</p>
          </div>
        </div>

        {/* Sign In Form */}
        {!isSignUp && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="absolute left-3 top-3 z-30"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Button>

            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold mb-2">Welcome Back</h2>
              <p className="text-muted-foreground">Sign in to access your health dashboard</p>
            </div>

            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter Your Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(true);
                  setEmail("");
                  setPassword("");
                }}
                className="text-sm text-primary hover:underline"
                disabled={loading}
              >
                Don't have an account? Sign up
              </button>
            </div>
          </>
        )}

        {/* Sign Up Step 1: Basic Info & Role */}
        {isSignUp && signupStep === 1 && (
          <>


            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold mb-2">Create Account</h2>
              <p className="text-muted-foreground">Step 1: Basic Information</p>
            </div>

            <form onSubmit={handleSignUpStep1} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name *</Label>
                <Input
                  id="fullName"
                  placeholder="Enter Your Name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter Your Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+1234567890"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password *</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password *</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">Role *</Label>
                <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="patient">Patient</SelectItem>
                    <SelectItem value="doctor">Doctor</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" className="w-full">
                Continue to Step 2
              </Button>
            </form>

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(false);
                  setEmail("");
                  setPassword("");
                }}
                className="text-sm text-primary hover:underline"
              >
                Already have an account? Sign in
              </button>
            </div>
          </>
        )}

        {/* Sign Up Step 2: Role-Specific Info */}
        {isSignUp && signupStep === 2 && (
          <>
            <div className="mb-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSignupStep(1)}
                className="absolute left-4 top-4"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">
                  {role === "patient" ? "Patient Information" : role === "doctor" ? "Doctor Information" : "Admin Information"}
                </h2>
                <p className="text-muted-foreground">Step 2: Additional Details</p>
              </div>
            </div>

            <form onSubmit={handleSignUpComplete} className="space-y-4">
              {role === "patient" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="dateOfBirth">Date of Birth *</Label>
                    <Input
                      id="dateOfBirth"
                      type="date"
                      value={dateOfBirth}
                      onChange={(e) => setDateOfBirth(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="gender">Gender *</Label>
                    <Select value={gender} onValueChange={setGender}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select gender" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bloodType">Blood Group *</Label>
                    <Select value={bloodType} onValueChange={setBloodType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select blood type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="A+">A+</SelectItem>
                        <SelectItem value="A-">A-</SelectItem>
                        <SelectItem value="B+">B+</SelectItem>
                        <SelectItem value="B-">B-</SelectItem>
                        <SelectItem value="AB+">AB+</SelectItem>
                        <SelectItem value="AB-">AB-</SelectItem>
                        <SelectItem value="O+">O+</SelectItem>
                        <SelectItem value="O-">O-</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="emergencyContact">Emergency Contact (Name + Phone) *</Label>
                    <Input
                      id="emergencyContact"
                      placeholder="Jane Doe, +1234567890"
                      value={emergencyContact}
                      onChange={(e) => setEmergencyContact(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="allergies">Allergies (comma-separated, optional)</Label>
                    <Textarea
                      id="allergies"
                      placeholder="List any allergies..."
                      value={allergies}
                      onChange={(e) => setAllergies(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="chronicConditions">Chronic Conditions (comma-separated, optional)</Label>
                    <Textarea
                      id="chronicConditions"
                      placeholder="e.g., Diabetes, Hypertension..."
                      value={chronicConditions}
                      onChange={(e) => setChronicConditions(e.target.value)}
                    />
                  </div>
                </>
              )}

              {role === "doctor" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="specialization">Specialization *</Label>
                    <Input
                      id="specialization"
                      placeholder="e.g., Cardiologist, General Physician"
                      value={specialization}
                      onChange={(e) => setSpecialization(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="licenseNumber">Medical License Number *</Label>
                    <Input
                      id="licenseNumber"
                      placeholder="Your medical license/registration ID"
                      value={licenseNumber}
                      onChange={(e) => setLicenseNumber(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="hospitalAffiliation">Hospital/Clinic Affiliation (Optional)</Label>
                    <Input
                      id="hospitalAffiliation"
                      placeholder="Name of hospital or clinic"
                      value={hospitalAffiliation}
                      onChange={(e) => setHospitalAffiliation(e.target.value)}
                    />
                  </div>
                </>
              )}

              {role === "admin" && (
                <div className="text-center py-8 text-muted-foreground">
                  Admin accounts require approval. Click Complete Signup to submit your request.
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  "Complete Signup"
                )}
              </Button>
            </form>
          </>
        )}
      </Card>

      {/* OTP Verification Dialog */}
      <OTPVerificationDialog
        open={showOTPDialog}
        email={otpEmail}
        onVerificationSuccess={handleOTPVerificationSuccess}
        onClose={() => {
          setShowOTPDialog(false);
          resetForm();
        }}
      />

      {/* Debug Panel - Accessible via Ctrl+Shift+D */}
      {showDebugPanel && (
        <SignupDebugPanel onClose={() => setShowDebugPanel(false)} />
      )}
    </div>
  );
};

export default Auth;
