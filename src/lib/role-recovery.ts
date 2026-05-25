/**
 * Role Recovery Utility
 * Helps recover from "role not setup" errors by:
 * 1. Checking if role exists in database
 * 2. Inferring role from profile data
 * 3. Auto-assigning role if needed
 * 4. Verifying doctor profile for doctors
 */

import { supabase } from '@/integrations/supabase/client';

export interface RoleRecoveryResult {
  success: boolean;
  role?: string;
  message: string;
  requiresUserAction?: boolean;
}

/**
 * Attempt to recover/verify user role
 */
export async function recoverUserRole(userId: string): Promise<RoleRecoveryResult> {
  try {
    console.log('[RoleRecovery] Starting recovery for user:', userId);

    // Step 1: Check if role exists (handle multiple rows gracefully)
    const { data: existingRoles, error: roleError } = await (supabase as any)
      .from('user_roles')
      .select('id, role')
      .eq('user_id', userId);

    if (roleError) {
      console.error('[RoleRecovery] Error checking role:', roleError);
      return {
        success: false,
        message: `Error checking role: ${roleError.message}`,
      };
    }

    if (existingRoles && existingRoles.length > 0) {
      // If multiple roles exist, clean up duplicates
      if (existingRoles.length > 1) {
        console.warn('[RoleRecovery] Found multiple role entries for user, cleaning up...');
        // Keep the first one and delete the rest in a single query
        const idsToDelete = (existingRoles as any[]).slice(1).map((r: any) => r.id);
        const { error: deleteError } = await (supabase as any)
          .from('user_roles')
          .delete()
          .in('id', idsToDelete);
        if (deleteError) {
          console.error('[RoleRecovery] Error deleting duplicate roles:', deleteError);
        } else {
          console.log('[RoleRecovery] Cleaned up', idsToDelete.length, 'duplicate role entries');
        }
      }
      
      const role = (existingRoles as any[])[0].role;
      console.log('[RoleRecovery] Role found:', role);
      return {
        success: true,
        role: role,
        message: `Role found: ${role}`,
      };
    }

    // Step 2: Try to infer role from profile data
    console.log('[RoleRecovery] No role found, checking profile for role inference...');

    // Check if user has a doctor_profiles record - if so, they're a doctor
    const { data: doctorProfileExists, error: doctorCheckError } = await (supabase as any)
      .from('doctor_profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (doctorCheckError) {
      console.error('[RoleRecovery] Error checking doctor profile:', doctorCheckError);
    }

    let inferredRole: 'patient' | 'doctor' | 'admin' = 'patient'; // default to patient

    if (doctorProfileExists) {
      inferredRole = 'doctor';
      console.log('[RoleRecovery] Inferred role from doctor_profiles: doctor');
    } else {
      console.log('[RoleRecovery] No doctor profile found, defaulting to patient role');
    }

    // Step 3: Assign the role
    console.log('[RoleRecovery] Assigning role:', inferredRole);

    const { error: assignError } = await (supabase as any)
      .from('user_roles')
      .insert([{ user_id: userId, role: inferredRole }]);

    if (assignError && assignError.code !== '23505') { // Ignore duplicate key errors
      console.error('[RoleRecovery] Error assigning role:', assignError);
      return {
        success: false,
        message: `Failed to assign role: ${assignError.message}`,
      };
    }

    // Step 4: If doctor, verify doctor profile
    if (inferredRole === 'doctor') {
      console.log('[RoleRecovery] Verifying doctor profile...');

      const { data: doctorProfile, error: doctorCheckError2 } = await supabase
        .from('doctor_profiles')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (doctorCheckError2) {
        console.error('[RoleRecovery] Error checking doctor profile:', doctorCheckError2);
      }

      if (!doctorProfile) {
        console.log('[RoleRecovery] Creating doctor profile...');

        const { error: createError } = await supabase
          .from('doctor_profiles')
          .insert([{ 
            user_id: userId,
            specialization: 'General Practice',
            license_number: 'PENDING'
          }]);

        if (createError && createError.code !== '23505') {
          console.error('[RoleRecovery] Error creating doctor profile:', createError);
          // Don't fail the recovery if doctor profile creation fails
        } else {
          console.log('[RoleRecovery] Doctor profile created/verified');
        }
      }
    }

    console.log('[RoleRecovery] Recovery successful, role:', inferredRole);
    return {
      success: true,
      role: inferredRole,
      message: `Role recovered and assigned: ${inferredRole}`,
    };
  } catch (error: any) {
    console.error('[RoleRecovery] Unexpected error:', error);
    return {
      success: false,
      message: `Unexpected error: ${error.message}`,
    };
  }
}

/**
 * Get user role with automatic recovery
 */
export async function getUserRoleWithRecovery(userId: string): Promise<string | null> {
  try {
    // First attempt: direct query
    const { data: role, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();

    if (!error && role) {
      console.log('[RoleRecovery] Role found directly:', role.role);
      return role.role;
    }

    // Second attempt: recovery
    console.log('[RoleRecovery] Direct query failed, attempting recovery...');
    const recovery = await recoverUserRole(userId);

    if (recovery.success && recovery.role) {
      return recovery.role;
    }

    return null;
  } catch (error) {
    console.error('[RoleRecovery] Error getting role:', error);
    return null;
  }
}

/**
 * Verify user is properly set up
 */
export async function verifyUserSetup(userId: string): Promise<boolean> {
  try {
    // Check role
    const { data: role } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();

    if (!role) {
      console.warn('[RoleRecovery] User has no role assigned');
      return false;
    }

    // Check profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!profile) {
      console.warn('[RoleRecovery] User has no profile');
      return false;
    }

    // If doctor, check doctor profile
    if (role.role === 'doctor') {
      const { data: doctorProfile } = await supabase
        .from('doctor_profiles')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (!doctorProfile) {
        console.warn('[RoleRecovery] Doctor has no doctor profile');
        return false;
      }
    }

    console.log('[RoleRecovery] User is properly set up');
    return true;
  } catch (error) {
    console.error('[RoleRecovery] Error verifying setup:', error);
    return false;
  }
}
