/**
 * Timezone utility for Indian Standard Time (IST - UTC+5:30)
 * All appointments should use IST for consistency
 */

const IST_OFFSET_HOURS = 5.5; // IST is UTC+5:30

/**
 * Convert UTC date to IST and format for display
 * Assumes the input is stored as UTC/ISO string
 */
export const toIST = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  // Format in IST timezone
  const istFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return istFormatter.format(d);
};

/**
 * Get current time in IST
 */
export const getCurrentISTTime = (): Date => {
  const now = new Date();
  const istFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  
  const parts = istFormatter.formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '0');
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '0') - 1;
  const day = parseInt(parts.find(p => p.type === 'day')?.value || '0');
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  const second = parseInt(parts.find(p => p.type === 'second')?.value || '0');
  
  return new Date(year, month, day, hour, minute, second);
};

/**
 * Format date as IST string (e.g., "2025-11-30 2:30 PM IST")
 */
export const formatDateAsIST = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  const formatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  
  return formatter.format(d) + ' IST';
};

/**
 * Format date for display (locale-aware with IST label)
 */
export const formatAppointmentDateIST = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  const formatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  
  return formatter.format(d) + ' IST';
};

/**
 * Check if appointment time has passed (using UTC epoch comparison)
 * appointmentDate is stored as UTC ISO string; Date.now() is also UTC epoch.
 * This avoids the mismatch between a UTC Date and a locally-constructed IST Date.
 */
export const hasAppointmentPassed = (appointmentDate: string): boolean => {
  if (!appointmentDate) return false;
  const appointmentTime = new Date(appointmentDate);
  // Compare UTC epoch values directly — no timezone offset confusion
  return appointmentTime.getTime() < Date.now();
};

/**
 * Check if appointment is within 5 minutes or has already started (using IST)
 * Returns true if current time is between 5 minutes before and appointment time
 */
export const isWithin5MinutesOfAppointment = (appointmentDate: string): boolean => {
  const appointmentTime = new Date(appointmentDate);
  const timeDifferenceMs = appointmentTime.getTime() - Date.now();
  const timeDifferenceMinutes = timeDifferenceMs / (1000 * 60);
  
  // Show button if within 5 minutes before appointment or appointment has started (up to 1 hour after)
  return timeDifferenceMinutes <= 5 && timeDifferenceMinutes >= -60;
};

/**
 * Check if appointment can have video call enabled (approved and online, within call window)
 * Extended window: shows button 30 mins before for scheduling flexibility
 */
export const canStartVideoCall = (appointmentDate: string): boolean => {
  const appointmentTime = new Date(appointmentDate);
  const timeDifferenceMs = appointmentTime.getTime() - Date.now();
  const timeDifferenceMinutes = timeDifferenceMs / (1000 * 60);
  
  // Show button if within 30 minutes before appointment or up to 1 hour after start
  return timeDifferenceMinutes <= 30 && timeDifferenceMinutes >= -60;
};

/**
 * Get today's date in IST (YYYY-MM-DD format)
 */
export const getTodayIST = (): string => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
};

/**
 * Check if a date string is today (in IST)
 */
export const isDateTodayIST = (dateStr: string): boolean => {
  return dateStr === getTodayIST();
};

/**
 * Filter time slots for today (remove past times in IST)
 */
export const filterPastTimeSlots = (dateStr: string, timeSlots: Array<{ value: string; label: string }>): Array<{ value: string; label: string }> => {
  if (!isDateTodayIST(dateStr)) {
    return timeSlots;
  }

  const currentTime = getCurrentISTTime();
  const currentHour = currentTime.getHours();
  const currentMinute = currentTime.getMinutes();

  return timeSlots.filter((slot) => {
    const [slotHour, slotMinute] = slot.value.split(':').map(Number);
    
    // Compare times
    if (slotHour > currentHour) return true;
    if (slotHour === currentHour && slotMinute > currentMinute) return true;
    
    return false;
  });
};
