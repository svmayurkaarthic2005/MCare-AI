/**
 * useCallListener
 *
 * Listens for incoming WebRTC offers across ALL of a doctor's approved online
 * appointment channels simultaneously — using a single Supabase realtime
 * subscription per appointment ID (lightweight broadcast-only, no RTCPeerConnection).
 *
 * When an offer arrives the hook surfaces:
 *   { incomingAppointmentId, incomingPatientName }
 *
 * The actual WebRTC peer connection is only created when the doctor opens the
 * VideoChatDialog for that specific appointment — keeping resource usage minimal
 * regardless of how many approved appointments exist.
 *
 * Usage:
 *   const { incomingAppointmentId, incomingPatientName, dismissIncoming } =
 *     useCallListener(appointmentIds, doctorId, activeCallAppointmentId);
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface IncomingCall {
  appointmentId: string;
  patientName: string;
}

interface UseCallListenerResult {
  /** The appointment ID that has an incoming call, or null */
  incomingCall: IncomingCall | null;
  /** Dismiss the incoming call notification without answering */
  dismissIncoming: () => void;
}

/**
 * @param appointmentIds  All approved online appointment IDs to watch
 * @param doctorId        The doctor's user ID (used to ignore own messages)
 * @param activeCallId    The appointment ID currently in an active call (null if idle).
 *                        Incoming calls for other appointments are auto-rejected while busy.
 */
export const useCallListener = (
  appointmentIds: string[],
  doctorId: string,
  activeCallId: string | null
): UseCallListenerResult => {
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);

  // Stable refs so subscription callbacks never capture stale values
  const activeCallIdRef = useRef(activeCallId);
  const doctorIdRef     = useRef(doctorId);
  useEffect(() => { activeCallIdRef.current = activeCallId; }, [activeCallId]);
  useEffect(() => { doctorIdRef.current = doctorId; }, [doctorId]);

  // Track which channels we've already subscribed to so we don't duplicate on re-render
  const subscribedIdsRef = useRef<Set<string>>(new Set());
  const channelsRef      = useRef<Map<string, ReturnType<typeof supabase.channel>>>(new Map());

  useEffect(() => {
    if (!doctorId || appointmentIds.length === 0) return;

    const newIds  = appointmentIds.filter(id => !subscribedIdsRef.current.has(id));
    const deadIds = [...subscribedIdsRef.current].filter(id => !appointmentIds.includes(id));

    // Remove channels for appointments that are no longer in the list
    deadIds.forEach(id => {
      const ch = channelsRef.current.get(id);
      if (ch) {
        supabase.removeChannel(ch);
        channelsRef.current.delete(id);
      }
      subscribedIdsRef.current.delete(id);
    });

    // Subscribe to new appointment IDs
    newIds.forEach(appointmentId => {
      subscribedIdsRef.current.add(appointmentId);

      const channel = supabase.channel(`video-call-listener-${appointmentId}`);

      channel
        .on('broadcast', { event: 'offer' }, (payload: any) => {
          const offer = payload.payload;

          // Ignore our own messages
          if (offer?.senderId === doctorIdRef.current) return;
          // Ignore ICE restart offers — those are for an already-active call
          if (offer?.iceRestart) return;

          console.log('[CallListener] Incoming offer on appointment:', appointmentId);

          // If already in a different call, auto-reject with busy signal
          if (activeCallIdRef.current && activeCallIdRef.current !== appointmentId) {
            console.log('[CallListener] Doctor busy — sending busy rejection');
            channel.send({
              type: 'broadcast',
              event: 'call-end',
              payload: { senderId: doctorIdRef.current, reason: 'busy' },
            });
            return;
          }

          // Surface the incoming call
          setIncomingCall({
            appointmentId,
            patientName: offer?.callerName || 'Patient',
          });
        })
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            console.warn('[CallListener] Channel error for appointment:', appointmentId);
          }
        });

      channelsRef.current.set(appointmentId, channel);
    });

    return () => {
      // Only clean up on unmount — not on every appointmentIds change
      // (the diff logic above handles additions/removals incrementally)
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentIds.join(','), doctorId]);

  // Full cleanup on unmount
  useEffect(() => {
    return () => {
      channelsRef.current.forEach(ch => supabase.removeChannel(ch));
      channelsRef.current.clear();
      subscribedIdsRef.current.clear();
    };
  }, []);

  const dismissIncoming = useCallback(() => setIncomingCall(null), []);

  return { incomingCall, dismissIncoming };
};
