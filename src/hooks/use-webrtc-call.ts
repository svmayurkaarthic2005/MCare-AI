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
  const isInitiatorRef = useRef<boolean>(false);
  const reconnectAttemptRef = useRef<number>(0);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentFacingModeRef = useRef<'user' | 'environment'>('user');
  const localStreamRef = useRef<MediaStream | null>(null);
  const lastOfferRef = useRef<RTCSessionDescription | null>(null);
  // FIX #3: Guard to prevent multiple concurrent ICE restart timers
  const iceRestartInProgressRef = useRef<boolean>(false);
  // FIX (PERSISTENT MUTE): Track audio/video mute state across reconnects/replaceTrack
  const isAudioEnabledRef = useRef<boolean>(true);
  const isVideoEnabledRef = useRef<boolean>(true);
  // FIX: Prevent React StrictMode double-subscription
  const channelInitializedRef = useRef<boolean>(false);
  // FIX: Stable ref to endCall so initializePeerConnection can call it without stale closure
  const endCallRef = useRef<(fromRemote?: boolean) => void>(() => {});

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
    ];

    try {
      console.log('[WebRTC] Fetching TURN credentials from edge function...');
      const { data, error } = await supabase.functions.invoke('turn');
      
      if (error || !data) {
        console.warn('[WebRTC] TURN fetch failed, using Metered.ca fallback:', error);
        return {
          iceServers: [
            ...fallbackTurnServers,
            { urls: 'stun:stun.l.google.com:19302' },
          ],
          iceCandidatePoolSize: 10,
          bundlePolicy: 'max-bundle',
          rtcpMuxPolicy: 'require',
        };
      }

      console.log('[WebRTC] Got Cloudflare TURN credentials');
      
      return {
        iceServers: [
          // Cloudflare TURN (primary)
          {
            urls: data.urls,
            username: data.username,
            credential: data.credential,
          },
          // Metered.ca TURN (fallback)
          ...fallbackTurnServers,
          // STUN (last resort)
          { urls: 'stun:stun.l.google.com:19302' },
        ],
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      };
    } catch (err) {
      console.error('[WebRTC] Error fetching TURN credentials:', err);
      return {
        iceServers: [
          ...fallbackTurnServers,
          { urls: 'stun:stun.l.google.com:19302' },
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
      lastOfferRef.current = peerConnection.localDescription;
      
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
      // FIX #3: Clear guard after 5s to allow next attempt
      setTimeout(() => {
        iceRestartInProgressRef.current = false;
      }, 5000);
    }
  }, [userRole, userId]);

  // Initialize peer connection
  // Pass isInitiator to control transceiver creation
  const initializePeerConnection = useCallback(async (forInitiator: boolean = true) => {
    try {
      // Prevent creating multiple peer connections
      if (peerConnectionRef.current) {
        console.log('[WebRTC] Reusing existing peerConnection');
        return peerConnectionRef.current;
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

      // FIX: Safari/some Chrome versions don't populate event.streams
      // Always use MediaStream fallback to ensure tracks are received
      // FIX (DESKTOP CHROME): Create NEW MediaStream object (immutable) to force React re-render
      peerConnection.ontrack = (event) => {
        const track = event.track;

        console.log('[WebRTC] Remote track received:', {
          kind: track.kind,
          readyState: track.readyState,
          muted: track.muted,
          id: track.id,
        });

        setState((prev) => {
          const stream = prev.remoteStream ?? new MediaStream();

          if (!stream.getTracks().some(t => t.id === track.id)) {
            stream.addTrack(track);
            console.log('[WebRTC] Added remote track:', track.kind, 'Total tracks:', stream.getTracks().length);
          }

          // FIX (DESKTOP CHROME): Return NEW MediaStream object (forces React re-render)
          return {
            ...prev,
            remoteStream: new MediaStream(stream.getTracks())
          };
        });

        // Handle track events
        track.onmute = () => {
          console.log('[WebRTC] Remote track muted:', track.kind);
        };

        track.onunmute = () => {
          console.log('[WebRTC] Remote track unmuted:', track.kind);
        };
      };

      peerConnection.onconnectionstatechange = () => {
        const connectionState = peerConnection.connectionState;
        console.log('[WebRTC] Connection state:', connectionState);

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
            // Wait 5-10s before ICE restart (mobile networks flap frequently)
            setTimeout(() => {
              if (peerConnection.connectionState === 'disconnected' && reconnectAttemptRef.current < 3) {
                reconnectAttemptRef.current++;
                attemptIceRestart(peerConnection);
              }
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
        console.log('[WebRTC] ICE connection state:', peerConnection.iceConnectionState);
        
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
      isInitiatorRef.current = true;

      // Wait for signaling channel
      console.log('[WebRTC] Waiting for signaling channel...');
      let retries = 0;
      const maxRetries = 5;

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

      // Initialize peer connection first (as initiator)
      const peerConnection = await initializePeerConnection(true);

      // Get media stream using ref to prevent duplicate tracks
      if (!localStreamRef.current) {
        const stream = await getMediaStream(videoEnabled);
        localStreamRef.current = stream;
        setState((prev) => ({ ...prev, localStream: stream }));

        // Apply initial video enabled state
        if (!videoEnabled) {
          isVideoEnabledRef.current = false;
          stream.getVideoTracks().forEach(t => { t.enabled = false; });
        }

        // Add or replace tracks to peer connection (prefer replaceTrack to avoid duplicate senders)
        for (const track of stream.getTracks()) {
          try {
            const kind = track.kind;
            const existingSender = peerConnection.getSenders().find(s => s.track?.kind === kind);
            if (existingSender && existingSender.replaceTrack) {
              await existingSender.replaceTrack(track);
              console.log('[WebRTC] Replaced existing sender track for', kind);
            } else {
              peerConnection.addTrack(track, stream);
              console.log('[WebRTC] Added local track via addTrack:', kind);
            }
          } catch (err) {
            console.warn('[WebRTC] Error adding/replacing local track:', err);
            // Fallback to addTrack if replaceTrack fails
            try { peerConnection.addTrack(track, stream); } catch (e) { console.error(e); }
          }
        }
      }

      // Create and send offer
      const offer = await peerConnection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await peerConnection.setLocalDescription(offer);
      console.log('[WebRTC] Offer created and setLocalDescription');
      console.log('[WebRTC] Sending offer');
      if (!signalChannelRef.current) {
        throw new Error('Signaling channel disconnected. Please try again.');
      }
      lastOfferRef.current = peerConnection.localDescription;
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

      // Set timeout for answer (60s to account for poor networks)
      // FIX #4 (STUCK CALL): Increased from 45s to 60s, added logging
      if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = setTimeout(() => {
        setState((prev) => {
          if (prev.isCalling && !prev.isCallActive) {
            console.warn('[WebRTC] Call timeout - no connection established within 60s');
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
      setState((prev) => ({
        ...prev,
        isCalling: false,
        error: errorMsg,
        connectionStatus: 'failed',
      }));
      toast.error(errorMsg);
    }
  }, [initializePeerConnection, getMediaStream, userRole, userId]);

  // Answer call (receiver)
  // FIX 2: Ensure tracks are added BEFORE creating answer (mandatory for proper transceiver config)
  const answerCall = useCallback(async (videoEnabled: boolean = true) => {
    try {
      setState((prev) => ({ ...prev, isAnswering: true, error: null, connectionStatus: 'connecting' }));
      isInitiatorRef.current = false;

      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) {
        throw new Error('No incoming call to answer. Please wait for the call.');
      }

      // FIX 2: CRITICAL - Ensure tracks exist before creating answer
      // This ensures transceivers are properly configured
      if (!localStreamRef.current) {
        console.log('[WebRTC] Getting media for answer...');
        const stream = await getMediaStream(videoEnabled);
        localStreamRef.current = stream;
        setState((prev) => ({ ...prev, localStream: stream }));

        // Apply initial video enabled state
        if (!videoEnabled) {
          isVideoEnabledRef.current = false;
          stream.getVideoTracks().forEach(t => { t.enabled = false; });
        }
        
        stream.getTracks().forEach((track) => {
          console.log('[WebRTC] Adding track before answer:', track.kind);
          peerConnection.addTrack(track, stream);
        });
        console.log('[WebRTC] All tracks added, now creating answer');
      }

      // FIX 2: CRITICAL - Wait one frame for transceiver config to stabilize
      await new Promise(r => requestAnimationFrame(r));

      // Create and send answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      console.log('[WebRTC] Answer created and setLocalDescription');
      console.log('[WebRTC] Sending answer');
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

      setState((prev) => ({ ...prev, isAnswering: false, incomingCall: false }));
      toast.success('Call connected');
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
  }, [getMediaStream, userId]);

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

    // FIX: Use ref instead of state to avoid stale closure capturing old stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
        console.log('[WebRTC] Stopped local track:', track.kind);
      });
      localStreamRef.current = null;
    }

    // Stop remote tracks if present to free media resources and avoid black screens
    try {
      setState((prev) => {
        if (prev.remoteStream) {
          try {
            prev.remoteStream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
            console.log('[WebRTC] Stopped remote tracks');
          } catch (e) {
            console.warn('[WebRTC] Error stopping remote tracks', e);
          }
        }

        return {
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
        };
      });
    } catch (e) {
      console.warn('[WebRTC] Error resetting state during endCall', e);
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
    }

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

    // state already reset above

    isInitiatorRef.current = false;
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
    toast.success('Call ended');

    setTimeout(() => {
      isEndingCallRef.current = false;
    }, 500);
  }, [userId]);

  // FIX: Keep endCallRef in sync so initializePeerConnection and signaling handlers
  // always call the latest version without stale closures
  endCallRef.current = endCall;

  // FIX: Clean up stats interval on component unmount (endCall may not be called)
  useEffect(() => {
    return () => {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
    };
  }, []);

  // Toggle audio
  // FIX 1: Use RTCRtpSender instead of MediaStream track
  // FIX (PERSISTENT MUTE): Also persist state in ref for reconnects
  const toggleAudio = useCallback((enabled: boolean) => {
    isAudioEnabledRef.current = enabled;

    const pc = peerConnectionRef.current;
    if (!pc) return;

    pc.getSenders()
      .filter(sender => sender.track?.kind === 'audio')
      .forEach(sender => {
        if (sender.track) {
          sender.track.enabled = enabled;
          console.log('[WebRTC] Audio sender muted:', !enabled);
        }
      });
  }, []);

  // Toggle video
  // FIX 2: Use RTCRtpSender instead of MediaStream track
  // FIX (PERSISTENT MUTE): Also persist state in ref for reconnects
  const toggleVideo = useCallback((enabled: boolean) => {
    isVideoEnabledRef.current = enabled;

    const pc = peerConnectionRef.current;
    if (!pc) return;

    pc.getSenders()
      .filter(sender => sender.track?.kind === 'video')
      .forEach(sender => {
        if (sender.track) {
          sender.track.enabled = enabled;
          console.log('[WebRTC] Video sender disabled:', !enabled);
        }
      });
  }, []);

  // Switch camera (mobile)
  // FIX 4: Preserve mute state after replaceTrack
  // FIX: Use localStreamRef instead of state.localStream to avoid stale closure
  const switchCamera = useCallback(async () => {
    if (!localStreamRef.current) return;

    try {
      const newFacingMode = currentFacingModeRef.current === 'user' ? 'environment' : 'user';
      currentFacingModeRef.current = newFacingMode;

      // Stop current video track
      localStreamRef.current.getVideoTracks().forEach((track) => track.stop());

      // Get new stream with different camera
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacingMode },
        audio: false,
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      
      // Replace track in peer connection
      const pc = peerConnectionRef.current;
      if (pc) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(newVideoTrack);
          
          // FIX 4: Restore mute state on new track
          // FIX (PERSISTENT MUTE): Use ref value instead of local variable
          newVideoTrack.enabled = isVideoEnabledRef.current;
          if (!isVideoEnabledRef.current) {
            console.log('[WebRTC] Video mute state preserved after camera switch');
          }
        }
      }

      // Update local stream using ref for current audio track
      const currentAudioTrack = localStreamRef.current.getAudioTracks()[0];
      const updatedStream = new MediaStream();
      if (currentAudioTrack) updatedStream.addTrack(currentAudioTrack);
      updatedStream.addTrack(newVideoTrack);

      localStreamRef.current = updatedStream;
      setState((prev) => ({ ...prev, localStream: updatedStream }));
      toast.success(`Switched to ${newFacingMode === 'user' ? 'front' : 'back'} camera`);
    } catch (error) {
      console.error('[WebRTC] Error switching camera:', error);
      toast.error('Could not switch camera');
    }
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
            isInitiatorRef.current = false;
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
        console.log('[WebRTC] Set remote offer');

        // FIX: For answerer, use replaceTrack on transceivers from offer SDP
        // This ensures audio/video tracks are properly sent to the caller
        try {
          if (!localStreamRef.current) {
            // Respect the user's camera preference (set via cameraOffMode before call)
            const stream = await getMediaStream(isVideoEnabledRef.current);
            localStreamRef.current = stream;
            setState((prev) => ({ ...prev, localStream: stream }));
            
            const audioTrack = stream.getAudioTracks()[0];
            const videoTrack = stream.getVideoTracks()[0];
            
            // Get transceivers created from offer and replace tracks
            const transceivers = peerConnection.getTransceivers();
            console.log('[WebRTC] Answerer transceivers:', transceivers.length);
            
            // Prefer replacing sender tracks where possible
            for (const transceiver of transceivers) {
              try {
                // Use sender.kind as indicator where available
                const senderKind = transceiver.sender?.track?.kind || transceiver.receiver?.track?.kind || transceiver.mid;
                if (transceiver.sender && transceiver.sender.replaceTrack) {
                  if (audioTrack && (transceiver.sender.track?.kind === 'audio' || !transceiver.sender.track)) {
                    await transceiver.sender.replaceTrack(audioTrack);
                    console.log('[WebRTC] Replaced audio track on transceiver');
                    continue;
                  }
                  if (videoTrack && (transceiver.sender.track?.kind === 'video' || !transceiver.sender.track)) {
                    await transceiver.sender.replaceTrack(videoTrack);
                    console.log('[WebRTC] Replaced video track on transceiver');
                    continue;
                  }
                }
              } catch (e) {
                console.warn('[WebRTC] replaceTrack failed on transceiver, will fallback to addTrack', e);
              }
            }
            
            // Fallback: If transceivers don't have tracks, use addTrack
            const hasAudioSender = transceivers.some(t => t.sender.track?.kind === 'audio');
            const hasVideoSender = transceivers.some(t => t.sender.track?.kind === 'video');
            
            if (!hasAudioSender && audioTrack) {
              peerConnection.addTrack(audioTrack, stream);
              console.log('[WebRTC] Added audio track via addTrack fallback');
            }
            if (!hasVideoSender && videoTrack) {
              peerConnection.addTrack(videoTrack, stream);
              console.log('[WebRTC] Added video track via addTrack fallback');
            }
            
            console.log('[WebRTC] Answerer tracks configured');
          } else {
            console.log('[WebRTC] Local tracks already added in handleOffer');
          }
        } catch (mediaError) {
          console.error('[WebRTC] Failed to get media in handleOffer:', mediaError);
          // FIX #2: Notify caller that we cannot answer due to media unavailable
          // This prevents caller from waiting indefinitely
          const mediaErrorMsg = mediaError instanceof Error ? mediaError.message : 'Device error';
          toast.error(`Cannot answer call: ${mediaErrorMsg}`);
          if (signalChannelRef.current) {
            signalChannelRef.current.send({
              type: 'broadcast',
              event: 'call-end',
              payload: { 
                senderId: userId,
                reason: 'media-unavailable',
              },
            });
          }
          return;
        }

        // Process buffered ICE candidates
        for (const candidate of pendingIceCandidatesRef.current) {
          try {
            await peerConnection.addIceCandidate(candidate);
          } catch (err) {
            console.error('[WebRTC] Error adding buffered ICE:', err);
          }
        }
        pendingIceCandidatesRef.current = [];

        // FIX: AUTO-ANSWER immediately for reliability (esp. mobile/Safari)
        // This ensures answer is created promptly after receiving offer
        try {
          await new Promise(r => requestAnimationFrame(r));

          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          console.log('[WebRTC] Auto-answering call');
          if (!signalChannelRef.current) {
            console.warn('[WebRTC] Signaling channel not ready for auto-answer');
            return;
          }
          signalChannelRef.current.send({
            type: 'broadcast',
            event: 'answer',
            payload: {
              sdp: answer.sdp,
              type: 'answer',
              senderId: userId,
            },
          });

          setState((prev) => ({
            ...prev,
            incomingCall: false,
            isAnswering: false,
          }));
        } catch (answerError) {
          console.error('[WebRTC] Failed to auto-answer:', answerError);
          // Show incoming call UI if auto-answer fails, let user try manual answer
          setState((prev) => ({
            ...prev,
            isAnswering: true,
            incomingCall: true,
            callerName: offerPayload.callerName || 'Caller',
            connectionStatus: 'connecting',
          }));
        }
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
          setTimeout(() => {
            resolveChannelReadyRef.current?.();
            resolveChannelReadyRef.current = null;
          }, 0);
        } else if (status === 'CHANNEL_ERROR') {
          setState((prev) => ({ ...prev, error: 'Signaling connection failed' }));
          resolveChannelReadyRef.current?.();
        } else if (status === 'CLOSED') {
          console.warn('[WebRTC] Signaling channel closed');
          // FIX: DO NOT end call on signaling close
          // WebRTC can survive signaling loss once connected
          signalChannelRef.current = null;
          setState((prev) => ({
            ...prev,
            // Only reset to idle if not already in an active call
            connectionStatus: prev.isCallActive ? prev.connectionStatus : 'idle',
          }));
        }
      });

      return channel;
    };

    // FIX #1 (RECONNECTION): Call setupChannel to initialize with all handlers
    let channel = setupChannel();

    return () => {
      console.log('[WebRTC] Cleaning up channel (unmount only)');
      
      // Only remove channel on actual component unmount
      if (signalChannelRef.current) {
        supabase.removeChannel(signalChannelRef.current);
        signalChannelRef.current = null;
      }
      
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
