/**
 * useCallListener
 *
 * Listens on a SINGLE global channel `video-call-doctor-${doctorId}` for
 * incoming call notifications. The patient sends a lightweight "incoming-call"
 * broadcast to this channel when they initiate a call, which wakes up the
 * doctor's UI regardless of which appointment dialog (if any) is open.
 *
 * This is the correct production pattern — one always-on listener, zero
 * RTCPeerConnection overhead at idle.
 *
 * The actual WebRTC signaling still happens on the per-appointment channel
 * `video-call-${appointmentId}` inside useWebRTCCall — this hook only handles
 * the "ring the doorbell" notification.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface IncomingCall {
  appointmentId: string;
  patientName: string;
}

interface UseCallListenerResult {
  incomingCall: IncomingCall | null;
  dismissIncoming: () => void;
}

export const useCallListener = (
  doctorId: string,
  activeCallId: string | null
): UseCallListenerResult => {
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);

  const activeCallIdRef = useRef(activeCallId);
  const doctorIdRef     = useRef(doctorId);
  useEffect(() => { activeCallIdRef.current = activeCallId; }, [activeCallId]);
  useEffect(() => { doctorIdRef.current = doctorId; }, [doctorId]);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!doctorId) return;

    // One global channel per doctor — always subscribed, zero WebRTC overhead
    const channel = supabase.channel(`video-call-doctor-${doctorId}`);
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'incoming-call' }, (payload: any) => {
        const data = payload.payload;

        // Ignore our own messages (shouldn't happen but be safe)
        if (data?.senderId === doctorIdRef.current) return;

        const appointmentId: string = data?.appointmentId;
        const patientName: string   = data?.callerName || 'Patient';

        if (!appointmentId) {
          console.warn('[CallListener] incoming-call missing appointmentId', data);
          return;
        }

        console.log('[CallListener] Incoming call on appointment:', appointmentId, 'from:', patientName);

        // If already in a different active call, send busy rejection on the
        // per-appointment signaling channel so the patient sees "Doctor busy"
        if (activeCallIdRef.current && activeCallIdRef.current !== appointmentId) {
          console.log('[CallListener] Doctor busy — rejecting call for', appointmentId);
          const busyChannel = supabase.channel(`video-call-${appointmentId}`);
          busyChannel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              busyChannel.send({
                type: 'broadcast',
                event: 'call-end',
                payload: { senderId: doctorIdRef.current, reason: 'busy' },
              });
              // Unsubscribe after sending — we don't need this channel
              setTimeout(() => supabase.removeChannel(busyChannel), 1000);
            }
          });
          return;
        }

        setIncomingCall({ appointmentId, patientName });
      })
      .subscribe((status) => {
        console.log('[CallListener] Global doctor channel status:', status);
        if (status === 'CHANNEL_ERROR') {
          console.warn('[CallListener] Global channel error — incoming calls may be missed');
        }
      });

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [doctorId]);

  const dismissIncoming = useCallback(() => setIncomingCall(null), []);

  return { incomingCall, dismissIncoming };
};
