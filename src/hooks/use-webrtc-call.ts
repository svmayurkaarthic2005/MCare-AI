import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface WebRTCCallState {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isCallActive: boolean;
  isCalling: boolean;
  isAnswering: boolean;
  error: string | null;
  incomingCall: boolean;
  callerName: string | null;
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
  networkQuality: 'good' | 'poor' | 'unknown';
}

interface WebRTCCallActions {
  startCall: (videoEnabled?: boolean) => Promise<void>;
  answerCall: (videoEnabled?: boolean) => Promise<void>;
  endCall: () => void;
  toggleAudio: (enabled: boolean) => void;
  toggleVideo: (enabled: boolean) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  setRemoteStream: (stream: MediaStream | null) => void;
  dismissIncomingCall: () => void;
  switchCamera: () => Promise<void>;
}

// Get optimal media constraints for the browser
// FIX: Moved browser detection inside function to avoid SSR hydration mismatch (#418)
const getMediaConstraints = (videoEnabled: boolean = true) => {
  const isSafari =
    typeof navigator !== 'undefined' &&
    /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  const isIOS =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);

  const baseConstraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: videoEnabled ? {
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
      frameRate: { ideal: 30, max: 60 },
      facingMode: 'user',
    } : false,
  };

  // Safari/iOS specific constraints
  if (isSafari || isIOS) {
    return {
      audio: true,
      video: videoEnabled ? {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
      } : false,
    };
  }

  return baseConstraints;
};

export const useWebRTCCall = (
  appointmentId: string,
  userId: string,
  userRole: 'doctor' | 'patient',
  remoteUserId: string
): [WebRTCCallState, WebRTCCallActions] => {
  const [state, setState] = useState<WebRTCCallState>({
    localStream: null,
    remoteStream: null,
    isCallActive: false,
    isCalling: false,
    isAnswering: false,
    error: null,
    incomingCall: false,
    callerName: null,
    connectionStatus: 'idle',
    networkQuality: 'unknown',
  });

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const signalChannelRef = useRef<any>(null);
  const callTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const channelReadyRef = useRef<Promise<void>>(Promise.resolve());
  const resolveChannelReadyRef = useRef<(() => void) | null>(null);
  const isEndingCallRef = useRef<boolean>(false);
  const pendingIceCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const reconnectAttemptRef = useRef<number>(0);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentFacingModeRef = useRef<'user' | 'environment'>('user');
  const localStreamRef = useRef<MediaStream | null>(null);
  // Guard to prevent multiple concurrent ICE restart timers
  const iceRestartInProgressRef = useRef<boolean>(false);
  // Stored timeout ID for ICE restart guard — cleared on unmount to prevent post-unmount state updates
  const iceRestartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Ref for the channel reconnect delay timer — cleared on unmount
  const channelReconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Ref to the currently active Supabase channel — used for reconnect cleanup
  const activeChannelRef = useRef<any>(null);
  // FIX (PERSISTENT MUTE): Track audio/video mute state across reconnects/replaceTrack
  const isAudioEnabledRef = useRef<boolean>(true);
  const isVideoEnabledRef = useRef<boolean>(true);
  // FIX: Prevent React StrictMode double-subscription
  const channelInitializedRef = useRef<boolean>(false);
  // FIX: Stable ref to endCall so initializePeerConnection can call it without stale closure
  const endCallRef = useRef<(fromRemote?: boolean) => void>(() => {});
  // FIX: Persistent remote MediaStream — never recreated, tracks are added/removed in place.
  // Creating new MediaStream() on every ontrack event breaks video rendering on some browsers.
  const remoteStreamRef = useRef<MediaStream>(new MediaStream());

  // Build ICE servers configuration with reliable TURN fallback
  const getIceServers = useCallback(async (): Promise<RTCConfiguration> => {
    // Metered.ca TURN servers as fallback — credentials from env vars
    const meteredUsername = import.meta.env.VITE_METERED_TURN_USERNAME || '4bdffd141bb6237f2674daa3';
    const meteredCredential = import.meta.env.VITE_METERED_TURN_CREDENTIAL || 'h1EeHiZKRDlKxaGr';
    const fallbackTurnServers = [
      {
        urls: 'turns:global.relay.metered.ca:443?transport=tcp',
        username: meteredUsername,
        credential: meteredCredential,
      },
      {
        urls: 'turn:global.relay.metered.ca:443?transport=tcp',
        username: meteredUsername,
        credential: meteredCredential,
      },
      {
        urls: 'turn:global.relay.metered.ca:80?transport=udp',
        username: meteredUsername,
        credential: meteredCredential,
      },
      // Enterprise firewall fallback (port 5349 = TURNS over TLS)
      {
        urls: 'turns:global.relay.metered.ca:5349?transport=tcp',
        username: meteredUsername,
        credential: meteredCredential,
      },
    ];

    try {
      console.log('[WebRTC] Fetching TURN credentials from edge function...');
      const { data, error } = await supabase.functions.invoke('turn');
      
      if (error || !data) {
        console.warn('[WebRTC] TURN fetch failed, using fallback:', error);
        return {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
            ...fallbackTurnServers,
          ],
          iceCandidatePoolSize: 10,
          bundlePolicy: 'max-bundle',
          rtcpMuxPolicy: 'require',
        };
      }

      console.log('[WebRTC] Got Cloudflare TURN credentials');
      
      return {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          // Cloudflare TURN (primary)
          {
            urls: data.urls,
            username: data.username,
            credential: data.credential,
          },
          // Metered.ca TURN (fallback)
          ...fallbackTurnServers,
        ],
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      };
    } catch (err) {
      console.error('[WebRTC] Error fetching TURN credentials:', err);
      return {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          ...fallbackTurnServers,
        ],
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      };
    }
  }, []);

  // Monitor network quality using WebRTC stats
  const startStatsMonitoring = useCallback((pc: RTCPeerConnection) => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
    }

    statsIntervalRef.current = setInterval(async () => {
      // Guard: skip if PC was closed without clearing the interval
      if (pc.connectionState === 'closed') return;
      try {
        const stats = await pc.getStats();
        let packetsLost = 0;
        let packetsReceived = 0;

        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            packetsLost += report.packetsLost || 0;
            packetsReceived += report.packetsReceived || 0;
          }
        });

        const lossRate = packetsReceived > 0 ? packetsLost / (packetsLost + packetsReceived) : 0;
        const quality = lossRate > 0.1 ? 'poor' : 'good';

        setState((prev) => {
          if (prev.networkQuality !== quality) {
            if (quality === 'poor') {
              toast.warning('Network quality is poor. Video may be affected.');
            }
            return { ...prev, networkQuality: quality };
          }
          return prev;
        });
      } catch (e) {
        // Stats not available
      }
    }, 5000);
  }, []);

  // Attempt ICE restart for connection recovery
  // FIX #1: Move BEFORE initializePeerConnection so callbacks capture the right reference
  // Check signalingState instead of isInitiator to allow callee to recover too
  // FIX #3: Use guard ref to prevent multiple concurrent ICE restart attempts
  const attemptIceRestart = useCallback(async (peerConnection: RTCPeerConnection) => {
    if (iceRestartInProgressRef.current) {
      console.log('[WebRTC] ICE restart already in progress, skipping');
      return;
    }
    
    if (peerConnection.signalingState !== 'stable') {
      console.log('[WebRTC] Cannot restart ICE, signalingState is', peerConnection.signalingState);
      return;
    }
    
    iceRestartInProgressRef.current = true;

    try {
      console.log('[WebRTC] Attempting ICE restart...');
      setState((prev) => ({ ...prev, connectionStatus: 'reconnecting' }));
      
      const offer = await peerConnection.createOffer({ iceRestart: true });
      await peerConnection.setLocalDescription(offer);
      
      if (!signalChannelRef.current) {
        console.warn('[WebRTC] Signaling channel not ready for ICE restart offer');
        return;
      }
      signalChannelRef.current.send({
        type: 'broadcast',
        event: 'offer',
        payload: {
          sdp: offer.sdp,
          type: 'offer',
          callerName: userRole === 'doctor' ? 'Doctor' : 'Patient',
          callerRole: userRole,
          iceRestart: true,
          senderId: userId,
        },
      });
    } catch (error) {
      console.error('[WebRTC] ICE restart failed:', error);
    } finally {
      // Clear guard after 5s to allow next attempt — stored in ref so it can be cancelled on unmount
      iceRestartTimeoutRef.current = setTimeout(() => {
        iceRestartInProgressRef.current = false;
        iceRestartTimeoutRef.current = null;
      }, 5000);
    }
  }, [userRole, userId]);

  // Initialize peer connection
  // Pass isInitiator to control transceiver creation
  const initializePeerConnection = useCallback(async (forInitiator: boolean = true) => {
    try {
      // Close any existing peer connection before creating a new one
      if (peerConnectionRef.current) {
        console.log('[WebRTC] Closing stale peerConnection before creating new one');
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }

      // If the existing local stream has ended tracks, clear it so a fresh one is acquired
      if (localStreamRef.current) {
        const allEnded = localStreamRef.current.getTracks().every(t => t.readyState === 'ended');
        if (allEnded) {
          console.log('[WebRTC] Clearing stale localStream (all tracks ended)');
          localStreamRef.current = null;
          setState((prev) => ({ ...prev, localStream: null }));
        }
      }
      const configuration = await getIceServers();
      console.log('[WebRTC] Creating peer connection with config:', configuration);
      const peerConnection = new RTCPeerConnection(configuration);

      // FIX: Only add transceivers for INITIATOR (caller)
      // For ANSWERER, transceivers come from the remote offer SDP
      // Adding transceivers for answerer causes duplicate/mismatched transceivers
      if (forInitiator) {
        peerConnection.addTransceiver('video', { direction: 'sendrecv' });
        peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
        console.log('[WebRTC] Added transceivers for initiator');
      } else {
        console.log('[WebRTC] Skipping transceiver creation for answerer (will use offer transceivers)');
      }

      // FIX (PERSISTENT MUTE): Restore mute state when tracks are added
      peerConnection.getSenders().forEach(sender => {
        if (sender.track?.kind === 'audio')
          sender.track.enabled = isAudioEnabledRef.current;
        if (sender.track?.kind === 'video')
          sender.track.enabled = isVideoEnabledRef.current;
      });

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('[WebRTC] ICE candidate generated:', event.candidate.type);
          if (!signalChannelRef.current) {
            console.warn('[WebRTC] Signaling channel not ready for ICE candidate');
            return;
          }
          signalChannelRef.current.send({
            type: 'broadcast',
            event: 'ice-candidate',
            payload: {
              candidate: event.candidate.candidate,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
              sdpMid: event.candidate.sdpMid,
              usernameFragment: event.candidate.usernameFragment,
              senderId: userId,
            },
          });
        } else {
          console.log('[WebRTC] ICE gathering complete');
        }
      };

      // Use persistent remoteStreamRef — add tracks in place, never recreate the stream.
      peerConnection.ontrack = (event) => {
        const track = event.track;

        console.log('[WebRTC] Remote track received:', {
          kind: track.kind, readyState: track.readyState, muted: track.muted, id: track.id,
        });

        // Add tracks to the persistent stream ref
        const sourceStream = event.streams?.[0];
        if (sourceStream) {
          sourceStream.getTracks().forEach(t => {
            if (!remoteStreamRef.current.getTracks().some(existing => existing.id === t.id)) {
              remoteStreamRef.current.addTrack(t);
              console.log('[WebRTC] Added remote track from event.streams[0]:', t.kind);
            }
          });
        } else {
          if (!remoteStreamRef.current.getTracks().some(t => t.id === track.id)) {
            remoteStreamRef.current.addTrack(track);
            console.log('[WebRTC] Added remote track (fallback):', track.kind);
          }
        }

        console.log('[WebRTC] Remote stream tracks now:', remoteStreamRef.current.getTracks().map(t => ({
          kind: t.kind, enabled: t.enabled, readyState: t.readyState,
        })));

        // CRITICAL: React bails out when the same object reference is passed to setState.
        // remoteStreamRef.current is always the same object, so we must force a new
        // reference each time to guarantee the useEffect([remoteStream]) in VideoChat fires.
        // We create a thin wrapper MediaStream from the same live tracks — no track copying.
        const snapshot = new MediaStream(remoteStreamRef.current.getTracks());
        setState((prev) => ({ ...prev, remoteStream: snapshot }));

        track.onmute   = () => console.log('[WebRTC] Remote track muted:',   track.kind);
        track.onunmute = () => console.log('[WebRTC] Remote track unmuted:', track.kind);
        track.onended  = () => {
          console.log('[WebRTC] Remote track ended:', track.kind);
          remoteStreamRef.current.removeTrack(track);
          const updated = new MediaStream(remoteStreamRef.current.getTracks());
          setState((prev) => ({ ...prev, remoteStream: updated }));
        };
      };

      peerConnection.onconnectionstatechange = () => {
        const connectionState = peerConnection.connectionState;
        console.log('[WebRTC] connectionState:', connectionState, '| signalingState:', peerConnection.signalingState);

        switch (connectionState) {
          case 'connecting':
            setState((prev) => ({ ...prev, connectionStatus: 'connecting' }));
            break;
          case 'connected':
            console.log('[WebRTC] ✅ Connection established successfully');
            setState((prev) => ({
              ...prev,
              isCallActive: true,
              connectionStatus: 'connected',
              error: null,
              isCalling: false,
              isAnswering: false,
            }));
            reconnectAttemptRef.current = 0;
            startStatsMonitoring(peerConnection);
            break;
          case 'disconnected':
            console.log('[WebRTC] Connection disconnected, attempting recovery...');
            setState((prev) => ({
              ...prev,
              connectionStatus: 'reconnecting',
              error: 'Connection interrupted. Reconnecting...',
            }));
            // Wait 8s before ICE restart — mobile networks flap frequently.
            // Guard: verify this PC is still the active one before restarting.
            setTimeout(() => {
              if (
                peerConnection !== peerConnectionRef.current ||
                peerConnection.connectionState !== 'disconnected' ||
                reconnectAttemptRef.current >= 3
              ) return;
              reconnectAttemptRef.current++;
              attemptIceRestart(peerConnection);
            }, 8000);
            break;
          case 'failed':
            console.log('[WebRTC] ❌ Connection failed');
            if (reconnectAttemptRef.current < 3) {
              reconnectAttemptRef.current++;
              console.log('[WebRTC] Attempting reconnection', reconnectAttemptRef.current);
              attemptIceRestart(peerConnection);
            } else {
              const errorMsg = 'Connection failed. Please check your network and try again.';
              setState((prev) => ({
                ...prev,
                connectionStatus: 'failed',
                error: errorMsg,
              }));
              toast.error(errorMsg);
              // FIX: Use ref to avoid stale closure
              endCallRef.current();
            }
            break;
          case 'closed':
            console.log('[WebRTC] Connection closed');
            break;
        }
      };

      peerConnection.oniceconnectionstatechange = () => {
        console.log('[WebRTC] iceConnectionState:', peerConnection.iceConnectionState, '| signalingState:', peerConnection.signalingState);
        
        if (peerConnection.iceConnectionState === 'failed') {
          console.log('[WebRTC] ICE failed, attempting restart');
          attemptIceRestart(peerConnection);
        }
      };

      peerConnection.onicecandidateerror = (event: Event) => {
        const error = event as RTCPeerConnectionIceErrorEvent;
        
        // FIX #2: Ignore error code 701 (normal timeout, not a real failure)
        if (error.errorCode === 701) {
          console.log('[WebRTC] ICE server timeout (normal on blocked networks)');
          return;
        }

        console.warn('[WebRTC] ICE candidate error:', {
          url: error.url,
          errorCode: error.errorCode,
          errorText: error.errorText,
        });
      };

      peerConnection.onicegatheringstatechange = () => {
        console.log('[WebRTC] ICE gathering state:', peerConnection.iceGatheringState);
      };

      // FIX: REMOVED onnegotiationneeded handler
      // We manually control offer creation in startCall() and answerCall()
      // Having onnegotiationneeded causes duplicate offers which breaks the connection
      peerConnection.onnegotiationneeded = () => {
        console.log('[WebRTC] Negotiation needed (ignored - manual control)');
      };

      peerConnectionRef.current = peerConnection;
      return peerConnection;
    } catch (error) {
      console.error('[WebRTC] Error initializing peer connection:', error);
      setState((prev) => ({ ...prev, error: 'Failed to initialize connection' }));
      throw error;
    }
  }, [attemptIceRestart, startStatsMonitoring, userRole, getIceServers]);


  // Get media stream with fallback
  const getMediaStream = useCallback(async (videoEnabled: boolean = true): Promise<MediaStream> => {
    try {
      const constraints = getMediaConstraints(videoEnabled);
      console.log('[WebRTC] Requesting media with constraints:', constraints);
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[WebRTC] Got media stream:', stream.getTracks().map(t => `${t.kind}:${t.enabled}`));
      return stream;
    } catch (error: any) {
      console.error('[WebRTC] getUserMedia error:', error.name, error.message);
      
      // Try audio-only fallback
      if (videoEnabled && (error.name === 'NotFoundError' || error.name === 'NotReadableError')) {
        console.log('[WebRTC] Falling back to audio-only');
        toast.warning('Camera not available. Starting audio-only call.');
        try {
          return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (audioError) {
          throw new Error('No camera or microphone available. Please check your device permissions.');
        }
      }

      // Handle specific errors
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        throw new Error('Camera/Microphone permission denied. Please allow access in your browser settings.');
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        throw new Error('No camera or microphone found. Please connect a device.');
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        throw new Error('Camera/Microphone is in use by another app. Please close other apps and try again.');
      } else if (error.name === 'OverconstrainedError') {
        // Try with less strict constraints
        console.log('[WebRTC] Retrying with basic constraints');
        return await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } else if (error.name === 'SecurityError') {
        throw new Error('Secure connection (HTTPS) required for camera access.');
      }
      
      throw new Error(`Media access failed: ${error.message}`);
    }
  }, []);

  // Start call (initiator)
  const startCall = useCallback(async (videoEnabled: boolean = true) => {
    try {
      setState((prev) => ({ ...prev, isCalling: true, error: null, connectionStatus: 'connecting' }));

      // Wait for signaling channel to be ready
      console.log('[WebRTC] Waiting for signaling channel...');
      let retries = 0;
      const maxRetries = 10;

      while (retries < maxRetries && !signalChannelRef.current) {
        try {
          await Promise.race([
            channelReadyRef.current,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000)),
          ]);
          if (signalChannelRef.current) break;
        } catch {
          retries++;
          if (retries < maxRetries) await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (!signalChannelRef.current) {
        throw new Error('Could not connect to signaling server. Check your internet connection.');
      }

      // Initialize peer connection (as initiator)
      const peerConnection = await initializePeerConnection(true);

      if (!localStreamRef.current) {
        const stream = await getMediaStream(videoEnabled);
        localStreamRef.current = stream;
        setState((prev) => ({ ...prev, localStream: stream }));
        if (!videoEnabled) {
          isVideoEnabledRef.current = false;
          stream.getVideoTracks().forEach(t => { t.enabled = false; });
        }
      }

      const streamToAdd = localStreamRef.current!;
      streamToAdd.getTracks().forEach((track) => {
        console.log('[WebRTC] Adding local track:', track.kind, track.enabled);
        peerConnection.addTrack(track, streamToAdd);
      });

      const sendOffer = async () => {
        if (!signalChannelRef.current) return;
        const offer = await peerConnection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await peerConnection.setLocalDescription(offer);
        console.log('[WebRTC] Sending offer, signalingState:', peerConnection.signalingState);
        signalChannelRef.current.send({
          type: 'broadcast',
          event: 'offer',
          payload: {
            sdp: peerConnection.localDescription!.sdp,
            type: 'offer',
            callerName: userRole === 'doctor' ? 'Doctor' : 'Patient',
            callerRole: userRole,
            senderId: userId,
          },
        });
      };

      await sendOffer();

      // Notify the remote user's global listener channel so their UI wakes up.
      // Also listen for a 'channel-ready' signal from the remote side — if they
      // open their dialog after we sent the offer, we re-send so they don't miss it.
      if (remoteUserId) {
        const notifyChannel = supabase.channel(`video-call-doctor-${remoteUserId}`);
        notifyChannel
          .on('broadcast', { event: 'channel-ready' }, async (payload: any) => {
            // Remote side just subscribed — re-send offer so they don't miss it
            if (payload.payload?.senderId === userId) return;
            if (peerConnection.signalingState === 'have-local-offer') {
              console.log('[WebRTC] Remote channel ready — re-sending offer');
              if (signalChannelRef.current) {
                signalChannelRef.current.send({
                  type: 'broadcast',
                  event: 'offer',
                  payload: {
                    sdp: peerConnection.localDescription!.sdp,
                    type: 'offer',
                    callerName: userRole === 'doctor' ? 'Doctor' : 'Patient',
                    callerRole: userRole,
                    senderId: userId,
                  },
                });
              }
            }
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              notifyChannel.send({
                type: 'broadcast',
                event: 'incoming-call',
                payload: {
                  appointmentId,
                  callerName: userRole === 'doctor' ? 'Doctor' : 'Patient',
                  callerRole: userRole,
                  senderId: userId,
                },
              });
              // Keep this channel alive for the duration of the call to catch channel-ready
              // Clean up after 90s (well past the 60s call timeout)
              setTimeout(() => supabase.removeChannel(notifyChannel), 90000);
            }
          });
      }

      if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = setTimeout(() => {
        const pcState = peerConnectionRef.current?.connectionState;
        if (pcState === 'connected') return;
        setState((prev) => {
          if (prev.isCalling && !prev.isCallActive) {
            console.warn('[WebRTC] Call timeout - no answer within 60s');
            toast.error('Call not answered. The other person may not have the call dialog open.');
            return { ...prev, isCalling: false, error: 'Call not answered', connectionStatus: 'idle' };
          }
          return prev;
        });
      }, 60000);

      toast.success('Calling...');
    } catch (error) {
      console.error('[WebRTC] Error starting call:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setState((prev) => ({ ...prev, isCalling: false, error: errorMsg, connectionStatus: 'failed' }));
      toast.error(errorMsg);
    }
  }, [initializePeerConnection, getMediaStream, userRole, userId, appointmentId, remoteUserId]);

  // Answer call (receiver).
  // This owns the COMPLETE answerer flow:
  //   getUserMedia → addTrack → createAnswer → setLocalDescription → send answer
  // handleOffer only does setRemoteDescription + shows the incoming-call UI.
  // Nothing else should touch SDP on the answerer side.
  const answerCall = useCallback(async (videoEnabled: boolean = true) => {
    try {
      setState((prev) => ({ ...prev, isAnswering: true, error: null, connectionStatus: 'connecting' }));

      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) {
        throw new Error('No incoming call to answer. Please wait for the call.');
      }

      // Guard against double-click: only answer when the remote offer is set and
      // we haven't already started creating an answer (have-remote-offer is the only valid state).
      if (peerConnection.signalingState !== 'have-remote-offer') {
        console.warn('[WebRTC] answerCall called in wrong signalingState:', peerConnection.signalingState);
        return;
      }

      // Acquire media and add tracks now — this is the ONLY place addTrack is called
      // for the answerer. handleOffer must NOT call addTrack.
      if (!videoEnabled) isVideoEnabledRef.current = false;

      try {
        if (!localStreamRef.current) {
          const stream = await getMediaStream(videoEnabled);
          localStreamRef.current = stream;
          setState((prev) => ({ ...prev, localStream: stream }));
        }

        // Apply video-enabled preference to the stream
        if (!videoEnabled) {
          localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = false; });
        }

        // Add each track only if it isn't already in a sender (guard against double-answer).
        // Check by track.id rather than sender count — more precise, handles partial state.
        const stream = localStreamRef.current;
        stream.getTracks().forEach(track => {
          const alreadyAdded = peerConnection
            .getSenders()
            .some(sender => sender.track?.id === track.id);
          if (!alreadyAdded) {
            console.log('[WebRTC] answerCall addTrack:', track.kind);
            peerConnection.addTrack(track, stream);
          } else {
            console.log('[WebRTC] answerCall: track already added, skipping:', track.kind);
          }
        });
        console.log('[WebRTC] Answerer tracks ready');
      } catch (mediaError) {
        console.error('[WebRTC] Failed to get media in answerCall:', mediaError);
        const mediaErrorMsg = mediaError instanceof Error ? mediaError.message : 'Device error';
        setState((prev) => ({ ...prev, isAnswering: false, error: mediaErrorMsg, connectionStatus: 'failed' }));
        toast.error(`Cannot answer call: ${mediaErrorMsg}`);
        if (signalChannelRef.current) {
          signalChannelRef.current.send({
            type: 'broadcast',
            event: 'call-end',
            payload: { senderId: userId, reason: 'media-unavailable' },
          });
        }
        return;
      }

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      console.log('[WebRTC] Answer created and setLocalDescription');
      if (!signalChannelRef.current) {
        throw new Error('Signaling channel disconnected. Cannot send answer.');
      }
      signalChannelRef.current.send({
        type: 'broadcast',
        event: 'answer',
        payload: {
          sdp: peerConnection.localDescription!.sdp,
          type: 'answer',
          senderId: userId,
        },
      });
      console.log('[WebRTC] Answer sent');

      setState((prev) => ({ ...prev, isAnswering: false, incomingCall: false }));
    } catch (error) {
      console.error('[WebRTC] Error answering call:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setState((prev) => ({
        ...prev,
        isAnswering: false,
        error: errorMsg,
        connectionStatus: 'failed',
      }));
      toast.error(errorMsg);
    }
  }, [userId, getMediaStream]);

  // End call
  // FIX: Use localStreamRef instead of state.localStream to avoid stale closure
  const endCall = useCallback((fromRemote: boolean = false) => {
    if (isEndingCallRef.current) return;
    isEndingCallRef.current = true;

    console.log('[WebRTC] Ending call', fromRemote ? '(remote)' : '(local)');

    // Stop stats monitoring
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    // Detach all senders before stopping tracks.
    // replaceTrack(null) signals to the remote peer that tracks are gone cleanly,
    // prevents ghost camera indicators on Safari, and avoids frozen senders.
    if (peerConnectionRef.current) {
      peerConnectionRef.current.getSenders().forEach(sender => {
        try { sender.replaceTrack(null); } catch {}
      });
    }

    // Stop local tracks (camera/mic hardware release)
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
        console.log('[WebRTC] Stopped local track:', track.kind);
      });
      localStreamRef.current = null;
    }

    // NOTE: Do NOT stop remote tracks — they are owned by the remote peer.
    // Stopping them causes black screen and broken audio on the remote side.

    // Reset the persistent remote stream for the next call
    remoteStreamRef.current.getTracks().forEach(t => remoteStreamRef.current.removeTrack(t));

    setState({
      localStream: null,
      remoteStream: null,
      isCallActive: false,
      isCalling: false,
      isAnswering: false,
      incomingCall: false,
      callerName: null,
      error: null,
      connectionStatus: 'idle',
      networkQuality: 'unknown',
    });

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Send end signal if local
    if (!fromRemote && signalChannelRef.current) {
      signalChannelRef.current.send({
        type: 'broadcast',
        event: 'call-end',
        payload: { senderId: userId },
      });
    }

    // Clear timeout
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }

    reconnectAttemptRef.current = 0;
    // FIX: Reset camera state to front-facing for next call
    currentFacingModeRef.current = 'user';
    // Reset mute state refs so next call starts unmuted
    isAudioEnabledRef.current = true;
    isVideoEnabledRef.current = true;
    // Clear any buffered ICE candidates from the previous session
    pendingIceCandidatesRef.current = [];
    // Clear ICE restart guard so next call can restart ICE immediately if needed
    iceRestartInProgressRef.current = false;
    if (iceRestartTimeoutRef.current) {
      clearTimeout(iceRestartTimeoutRef.current);
      iceRestartTimeoutRef.current = null;
    }
    if (channelReconnectTimerRef.current) {
      clearTimeout(channelReconnectTimerRef.current);
      channelReconnectTimerRef.current = null;
    }
    toast.success('Call ended');

    setTimeout(() => {
      isEndingCallRef.current = false;
    }, 500);
  }, [userId]);

  // FIX: Keep endCallRef in sync so initializePeerConnection and signaling handlers
  // always call the latest version without stale closures
  endCallRef.current = endCall;

  // Clean up intervals/timeouts on component unmount (endCall may not be called)
  useEffect(() => {
    return () => {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
      if (iceRestartTimeoutRef.current) {
        clearTimeout(iceRestartTimeoutRef.current);
        iceRestartTimeoutRef.current = null;
      }
      if (channelReconnectTimerRef.current) {
        clearTimeout(channelReconnectTimerRef.current);
        channelReconnectTimerRef.current = null;
      }
    };
  }, []);

  // Toggle audio — updates both the RTP sender (remote side) and local stream track (preview)
  const toggleAudio = useCallback((enabled: boolean) => {
    isAudioEnabledRef.current = enabled;

    // Update sender so remote peer hears the change
    const pc = peerConnectionRef.current;
    if (pc) {
      pc.getSenders()
        .filter(sender => sender.track?.kind === 'audio')
        .forEach(sender => {
          if (sender.track) sender.track.enabled = enabled;
        });
    }

    // Also update local stream tracks so the local preview reflects mute state
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = enabled; });
    console.log('[WebRTC] Audio', enabled ? 'unmuted' : 'muted');
  }, []);

  // Toggle video — updates both the RTP sender (remote side) and local stream track (preview)
  const toggleVideo = useCallback((enabled: boolean) => {
    isVideoEnabledRef.current = enabled;

    // Update sender so remote peer sees the change
    const pc = peerConnectionRef.current;
    if (pc) {
      pc.getSenders()
        .filter(sender => sender.track?.kind === 'video')
        .forEach(sender => {
          if (sender.track) sender.track.enabled = enabled;
        });
    }

    // Also update local stream tracks so the local preview reflects camera state
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = enabled; });
    console.log('[WebRTC] Video', enabled ? 'enabled' : 'disabled');
  }, []);

  const switchCamera = useCallback(async () => {
    if (!localStreamRef.current) return;

    const newFacingMode = currentFacingModeRef.current === 'user' ? 'environment' : 'user';

    try {
      const pc = peerConnectionRef.current;

      // Acquire new camera FIRST — if this fails the old camera is still alive
      let newStream: MediaStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: newFacingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        // Fallback: exact facingMode (some Android devices need this)
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: newFacingMode } },
          audio: false,
        });
      }

      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) throw new Error('No video track in new stream');

      // Stop any extra tracks from the temp stream
      newStream.getTracks().forEach(t => { if (t !== newVideoTrack) t.stop(); });

      // Replace outgoing track in peer connection
      if (pc) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(newVideoTrack);
          newVideoTrack.enabled = isVideoEnabledRef.current;
          console.log('[WebRTC] Camera switched, track replaced');
        }
      }

      // NOW stop the old video track (after replaceTrack succeeds)
      localStreamRef.current.getVideoTracks().forEach(t => { try { t.stop(); } catch {} });

      currentFacingModeRef.current = newFacingMode;

      // Build updated stream with existing audio + new video
      const audioTracks = localStreamRef.current.getAudioTracks();
      const updatedStream = new MediaStream();
      audioTracks.forEach(t => updatedStream.addTrack(t));
      updatedStream.addTrack(newVideoTrack);

      localStreamRef.current = updatedStream;
      setState(prev => ({ ...prev, localStream: updatedStream }));

      // Force local preview to refresh on Android (srcObject change alone may not trigger play)
      setTimeout(() => {
        document.querySelectorAll<HTMLVideoElement>('video').forEach(v => {
          if (v.srcObject === updatedStream) v.play().catch(() => {});
        });
      }, 200);

      toast.success(`Switched to ${newFacingMode === 'user' ? 'front' : 'back'} camera`);
    } catch (error) {
      console.error('[WebRTC] Error switching camera:', error);
      toast.error('Could not switch camera. Some mobile browsers allow only one camera session.');
    }
  }, []);

  // iOS Safari audio interruption recovery (issue 7)
  // Phone calls, AirPods reconnect, and app switches can suspend the audio context.
  // Re-trigger remote stream state on visibility restore so VideoChat replays the video element.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && peerConnectionRef.current?.connectionState === 'connected') {
        console.log('[WebRTC] Page visible — re-triggering remote stream for iOS audio recovery');
        // Force new reference so VideoChat useEffect fires
        const snapshot = new MediaStream(remoteStreamRef.current.getTracks());
        setState((prev) => ({ ...prev, remoteStream: snapshot }));
      }
    };
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted && peerConnectionRef.current?.connectionState === 'connected') {
        console.log('[WebRTC] pageshow (BFCache restore) — re-triggering remote stream');
        setState((prev) => ({ ...prev, remoteStream: remoteStreamRef.current }));
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  // Dismiss incoming call
  const dismissIncomingCall = useCallback(() => {
    setState((prev) => ({
      ...prev,
      incomingCall: false,
      isAnswering: false,
      callerName: null,
    }));
  }, []);

  // Setup signaling channel
  useEffect(() => {
    // Don't set up a channel if appointmentId is empty (e.g. offline consultation)
    if (!appointmentId) return;

    // FIX: Prevent React StrictMode double-subscription
    // In dev mode, useEffect runs twice; this guard prevents channel cleanup mid-call
    if (channelInitializedRef.current) {
      console.log('[WebRTC] Channel already initialized, skipping');
      return;
    }
    channelInitializedRef.current = true;

    // FIX #1 (RECONNECTION): Wrap channel setup so it can be re-called on CLOSED
    const setupChannel = () => {
      const channel = supabase.channel(`video-call-${appointmentId}`);

      channelReadyRef.current = new Promise<void>((resolve) => {
        resolveChannelReadyRef.current = resolve;
      });

      const handleOffer = async (payload: any) => {
      const offerPayload = payload.payload;
      
      // Ignore our own messages
      if (offerPayload.senderId === userId) {
        console.log('[WebRTC] Ignoring own offer');
        return;
      }

      console.log('[WebRTC] Received offer');

      try {
        // Handle glare: if we already have a local offer, use tie-breaking
        let peerConnection = peerConnectionRef.current;
        
        if (peerConnection && peerConnection.signalingState === 'have-local-offer') {
          // Glare condition: both sides sent offers
          // FIX #4 (GLARE): Use role-based tie-breaking instead of UUID comparison
          // Doctor is "impolite" (takes priority), Patient is "polite" (yields)
          const isDoctor = userRole === 'doctor';
          const remoteIsDoctor = offerPayload.callerRole === 'doctor';
          const shouldYield = !isDoctor && remoteIsDoctor;
          
          if (shouldYield) {
            console.log('[WebRTC] Glare detected, patient yielding (rolling back)');
            await peerConnection.setLocalDescription({ type: 'rollback' });
          } else {
            console.log('[WebRTC] Glare detected, doctor takes priority (ignoring remote offer)');
            return;
          }
        }

        // Create new peer connection if needed (as answerer - no transceivers)
        if (!peerConnection) {
          peerConnection = await initializePeerConnection(false);
        }

        const offer = new RTCSessionDescription({
          type: 'offer',
          sdp: offerPayload.sdp,
        });

        await peerConnection.setRemoteDescription(offer);
        console.log('[WebRTC] Set remote offer — waiting for user to answer');

        // Process any ICE candidates that arrived before the remote description was set.
        for (const candidate of pendingIceCandidatesRef.current) {
          try {
            await peerConnection.addIceCandidate(candidate);
          } catch (err) {
            console.error('[WebRTC] Error adding buffered ICE:', err);
          }
        }
        pendingIceCandidatesRef.current = [];

        // ICE restart offers come from the remote peer during reconnect.
        // They must NOT trigger the incoming-call UI — the call is already active.
        if (offerPayload.iceRestart) {
          console.log('[WebRTC] ICE restart offer — skipping incoming-call UI, creating answer immediately');
          // For ICE restart we answer immediately (no user interaction needed)
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          if (signalChannelRef.current) {
            signalChannelRef.current.send({
              type: 'broadcast',
              event: 'answer',
              payload: { sdp: peerConnection.localDescription!.sdp, type: 'answer', senderId: userId },
            });
          }
          return;
        }

        // STOP HERE for normal offers. Do NOT getUserMedia, addTrack, createAnswer, or setLocalDescription.
        // All of that happens in answerCall() when the user clicks Answer.
        // Doing any of it here causes duplicate SDP negotiation → black screen.
        setState((prev) => ({
          ...prev,
          incomingCall: true,
          isAnswering: true,
          callerName: offerPayload.callerName || 'Caller',
          connectionStatus: 'connecting',
        }));
      } catch (error) {
        console.error('[WebRTC] Error handling offer:', error);
        toast.error('Failed to receive call');
      }
    };

    const handleAnswer = async (payload: any) => {
      const answerPayload = payload.payload;
      
      // Ignore our own messages
      if (answerPayload.senderId === userId) {
        console.log('[WebRTC] Ignoring own answer');
        return;
      }

      try {
        const peerConnection = peerConnectionRef.current;
        if (!peerConnection) {
          console.error('[WebRTC] No peer connection for answer');
          return;
        }

        if (peerConnection.signalingState !== 'have-local-offer') {
          console.warn('[WebRTC] Ignoring answer in state:', peerConnection.signalingState);
          return;
        }

        const answer = new RTCSessionDescription({
          type: 'answer',
          sdp: answerPayload.sdp,
        });

        await peerConnection.setRemoteDescription(answer);
        console.log('[WebRTC] Set remote answer');
        console.log('[WebRTC] Answer SDP length:', (answer.sdp || '').length);

        // Process buffered ICE candidates
        for (const candidate of pendingIceCandidatesRef.current) {
          try {
            await peerConnection.addIceCandidate(candidate);
          } catch (err) {
            console.error('[WebRTC] Error adding buffered ICE:', err);
          }
        }
        pendingIceCandidatesRef.current = [];
      } catch (error) {
        console.error('[WebRTC] Error handling answer:', error);
        toast.error('Failed to establish connection');
      }
    };

    const handleIceCandidate = async (payload: any) => {
      try {
        const candidatePayload = payload.payload;
        if (!candidatePayload.candidate) return;

        // FIX: Ignore our own ICE candidates (critical for stability)
        if (candidatePayload.senderId === userId) {
          console.log('[WebRTC] Ignoring own ICE candidate');
          return;
        }

        console.log('[WebRTC] ICE candidate received from remote:', {
          candidate: candidatePayload.candidate?.slice?.(0, 120),
          sdpMLineIndex: candidatePayload.sdpMLineIndex,
          sdpMid: candidatePayload.sdpMid,
        });

        const candidate = new RTCIceCandidate({
          candidate: candidatePayload.candidate,
          sdpMLineIndex: candidatePayload.sdpMLineIndex,
          sdpMid: candidatePayload.sdpMid,
        });

        const peerConnection = peerConnectionRef.current;
        if (peerConnection?.remoteDescription) {
          console.log('[WebRTC] Adding ICE candidate to peerConnection');
          await peerConnection.addIceCandidate(candidate);
        } else {
          console.log('[WebRTC] Buffering ICE candidate');
          pendingIceCandidatesRef.current.push(candidate);
        }
      } catch (error) {
        console.error('[WebRTC] Error adding ICE candidate:', error);
      }
    };

    const handleCallEnd = (payload: any) => {
      if (payload.payload?.senderId === userId) return;
      console.log('[WebRTC] Remote ended call');
      // FIX: Use ref to always call the latest endCall (avoids stale closure)
      endCallRef.current(true);
    };

    channel
      .on('broadcast', { event: 'offer' }, handleOffer)
      .on('broadcast', { event: 'answer' }, handleAnswer)
      .on('broadcast', { event: 'ice-candidate' }, handleIceCandidate)
      .on('broadcast', { event: 'call-end' }, handleCallEnd)
      .subscribe((status) => {
        console.log('[WebRTC] Channel status:', status);
        if (status === 'SUBSCRIBED') {
          signalChannelRef.current = channel;
          // Broadcast channel-ready so the caller can re-send the offer if they
          // sent it before we subscribed (race condition: doctor opens dialog late)
          channel.send({
            type: 'broadcast',
            event: 'channel-ready',
            payload: { senderId: userId },
          });
          setTimeout(() => {
            resolveChannelReadyRef.current?.();
            resolveChannelReadyRef.current = null;
          }, 0);
        } else if (status === 'CHANNEL_ERROR') {
          setState((prev) => ({ ...prev, error: 'Signaling connection failed' }));
          resolveChannelReadyRef.current?.();
        } else if (status === 'CLOSED') {
          console.warn('[WebRTC] Signaling channel closed');
          // WebRTC can survive signaling loss once connected — do NOT end the call.
          signalChannelRef.current = null;
          setState((prev) => ({
            ...prev,
            connectionStatus: prev.isCallActive ? prev.connectionStatus : 'idle',
          }));

          // Attempt to re-establish the signaling channel after a short delay.
          // This handles transient network drops without killing an active call.
          if (channelReconnectTimerRef.current) clearTimeout(channelReconnectTimerRef.current);
          channelReconnectTimerRef.current = setTimeout(() => {
            channelReconnectTimerRef.current = null;
            if (!signalChannelRef.current) {
              console.log('[WebRTC] Reconnecting signaling channel...');
              // Remove the stale channel and set up a fresh one
              supabase.removeChannel(channel);
              activeChannelRef.current = setupChannel();
            }
          }, 2000);
        }
      });

      return channel;
    };

    // Call setupChannel to initialize with all handlers
    activeChannelRef.current = setupChannel();

    return () => {
      console.log('[WebRTC] Cleaning up channel (unmount only)');
      
      if (channelReconnectTimerRef.current) {
        clearTimeout(channelReconnectTimerRef.current);
        channelReconnectTimerRef.current = null;
      }

      // Only remove channel on actual component unmount
      if (signalChannelRef.current) {
        supabase.removeChannel(signalChannelRef.current);
        signalChannelRef.current = null;
      } else if (activeChannelRef.current) {
        supabase.removeChannel(activeChannelRef.current);
      }
      activeChannelRef.current = null;
      
      // Reset flag for next mount
      channelInitializedRef.current = false;
      
      // FIX: DO NOT close PC or stop tracks here
      // Let endCall() handle that when user explicitly ends or remote ends
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId, userId]);

  return [
    state,
    {
      startCall,
      answerCall,
      endCall,
      toggleAudio,
      toggleVideo,
      setLocalStream: (stream) => setState((prev) => ({ ...prev, localStream: stream })),
      setRemoteStream: (stream) => setState((prev) => ({ ...prev, remoteStream: stream })),
      dismissIncomingCall,
      switchCamera,
    },
  ];
};
