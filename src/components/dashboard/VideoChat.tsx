import { useState, useRef, useEffect } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Copy, Check, SwitchCamera, Wifi, WifiOff, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface VideoChatProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isCallActive: boolean;
  isCalling: boolean;
  isAnswering: boolean;
  onStartCall: (videoEnabled?: boolean) => Promise<void>;
  onAnswerCall: (videoEnabled?: boolean) => Promise<void>;
  onEndCall: () => void;
  onToggleAudio: (enabled: boolean) => void;
  onToggleVideo: (enabled: boolean) => void;
  onSwitchCamera?: () => Promise<void>;
  doctorName: string;
  appointmentId: string;
  userRole: 'doctor' | 'patient';
  error?: string | null;
  connectionStatus?: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
  networkQuality?: 'good' | 'poor' | 'unknown';
}

const checkMultipleCameras = async (): Promise<boolean> => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput').length > 1;
  } catch {
    return false;
  }
};

export const VideoChat = ({
  localStream,
  remoteStream,
  isCallActive,
  isCalling,
  isAnswering,
  onStartCall,
  onAnswerCall,
  onEndCall,
  onToggleAudio,
  onToggleVideo,
  onSwitchCamera,
  doctorName,
  appointmentId,
  userRole,
  error,
  connectionStatus = 'idle',
  networkQuality = 'unknown',
}: VideoChatProps) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [cameraOffMode, setCameraOffMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandPip, setExpandPip] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    checkMultipleCameras().then(setHasMultipleCameras);
  }, []);

  // Reset UI state when call ends
  useEffect(() => {
    if (!isCallActive && !isCalling && !isAnswering) {
      setAudioEnabled(true);
      setVideoEnabled(true);
      setCameraOffMode(false);
      setIsFullscreen(false);
      setExpandPip(false);
    }
  }, [isCallActive, isCalling, isAnswering]);

  // Attach local stream
  useEffect(() => {
    if (!localVideoRef.current) return;
    localVideoRef.current.srcObject = localStream ?? null;
    if (localStream) localVideoRef.current.play().catch(() => {});
  }, [localStream]);

  // Attach remote stream — only update srcObject when the stream reference changes.
  // Deps include isAnswering/isCallActive so this re-runs when the dialog opens
  // mid-call (race condition: stream arrived before <video> ref was mounted).
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video) return;

    if (!remoteStream) {
      // Only clear if we're not in an active call (i.e. call truly ended)
      if (!isCallActive && !isAnswering) {
        video.srcObject = null;
      }
      return;
    }

    // Only reassign if the stream object itself changed — avoids interrupting playback
    if (video.srcObject !== remoteStream) {
      video.srcObject = remoteStream;
    }

    video.play().catch((err: unknown) => {
      const e = err as { name?: string };
      if (e.name !== 'AbortError') {
        setTimeout(() => video.play().catch(() => {}), 300);
      }
    });
  }, [remoteStream, isCallActive, isAnswering]);

  // Force play when connection becomes connected — keep local muted, unmute remote
  useEffect(() => {
    if (connectionStatus === 'connected') {
      if (localVideoRef.current) {
        localVideoRef.current.muted = true;
        localVideoRef.current.play().catch(() => {});
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.muted = false;
        remoteVideoRef.current.play().catch(() => {});
      }
    }
  }, [connectionStatus]);

  const handleToggleAudio = () => {
    const next = !audioEnabled;
    setAudioEnabled(next);
    onToggleAudio(next);
  };

  const handleToggleVideo = () => {
    const next = !videoEnabled;
    setVideoEnabled(next);
    onToggleVideo(next);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(appointmentId);
      setCopied(true);
      toast.success('Appointment ID copied!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const statusDisplay = (() => {
    switch (connectionStatus) {
      case 'connecting':   return { text: 'Connecting…',       color: 'bg-yellow-500', pulse: true };
      case 'connected':    return { text: 'Connected',          color: 'bg-green-500',  pulse: false };
      case 'reconnecting': return { text: 'Reconnecting…',     color: 'bg-orange-500', pulse: true };
      case 'failed':       return { text: 'Connection Failed', color: 'bg-red-500',    pulse: false };
      default:             return null;
    }
  })();

  // ─── Fullscreen overlay ───────────────────────────────────────────────────
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        {/* Video fills all remaining space */}
        <div className="relative flex-1 min-h-0">
          <video ref={remoteVideoRef} autoPlay playsInline muted={false}
            className={cn('w-full h-full object-cover', !remoteStream && 'hidden')} />
          {!remoteStream && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
              <p className="text-white text-sm">{doctorName}</p>
            </div>
          )}
          {/* PiP */}
          <div
            className={cn(
              'absolute bottom-3 right-3 rounded-lg overflow-hidden border-2 border-primary cursor-pointer',
              expandPip ? 'w-28 h-20' : 'w-20 h-14'
            )}
            onClick={() => setExpandPip(p => !p)}
          >
            <video ref={localVideoRef} autoPlay playsInline muted
              className={cn('w-full h-full object-cover', !localStream && 'hidden')} />
            {!localStream && (
              <div className="w-full h-full bg-slate-700 flex items-center justify-center">
                <span className="text-xs text-gray-400">Off</span>
              </div>
            )}
          </div>
          {/* Status badge */}
          {statusDisplay && (
            <div className={cn(
              'absolute top-3 left-3 text-white px-2 py-1 rounded-full text-xs font-semibold flex items-center gap-1',
              statusDisplay.color, statusDisplay.pulse && 'animate-pulse'
            )}>
              {connectionStatus === 'connected' && <Wifi className="h-3 w-3" />}
              {connectionStatus === 'failed'    && <WifiOff className="h-3 w-3" />}
              {statusDisplay.text}
            </div>
          )}
          {/* Exit fullscreen */}
          <Button variant="ghost" size="icon"
            className="absolute top-3 right-3 bg-black/50 hover:bg-black/70 text-white"
            onClick={() => setIsFullscreen(false)}>
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Compact controls bar at bottom */}
        <div className="flex-shrink-0 bg-black/80 px-4 py-3 flex items-center justify-center gap-3">
          <Button onClick={handleToggleAudio} variant={audioEnabled ? 'default' : 'destructive'} size="sm" className="gap-1">
            {audioEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </Button>
          <Button onClick={handleToggleVideo} variant={videoEnabled ? 'default' : 'destructive'} size="sm" className="gap-1">
            {videoEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          </Button>
          {hasMultipleCameras && onSwitchCamera && (
            <Button onClick={onSwitchCamera} variant="outline" size="sm">
              <SwitchCamera className="h-4 w-4" />
            </Button>
          )}
          <Button onClick={onEndCall} variant="destructive" size="sm" className="gap-1 px-4">
            <PhoneOff className="h-4 w-4" />
            <span>End</span>
          </Button>
        </div>
      </div>
    );
  }

  // ─── Normal (in-dialog) layout ────────────────────────────────────────────
  // The parent dialog gives us a fixed height container.
  // We split it into: video area (flex-1, shrinks) + controls panel (fixed height, scrollable).
  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">

      {/* ── Video area ── grows to fill available space, never overflows */}
      <div className="relative flex-1 min-h-0 bg-black rounded-xl overflow-hidden">
        {/* Remote video */}
        <video
          ref={remoteVideoRef}
          autoPlay playsInline muted={false}
          className={cn('absolute inset-0 w-full h-full object-cover', !remoteStream && 'hidden')}
          onLoadedMetadata={(e: { currentTarget: HTMLVideoElement }) => {
            e.currentTarget.play().catch(() => setTimeout(() => e.currentTarget.play(), 300));
          }}
        />

        {/* Placeholder when no remote stream */}
        {!remoteStream && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 gap-3 px-4">
            <div className="text-4xl">📞</div>
            <p className="text-white text-sm sm:text-base text-center">
              {connectionStatus === 'connecting'   && 'Connecting…'}
              {connectionStatus === 'reconnecting' && 'Reconnecting…'}
              {isCalling   && connectionStatus !== 'connecting'   && 'Calling…'}
              {isAnswering && connectionStatus !== 'connecting'   && 'Incoming call…'}
              {connectionStatus === 'idle' && !isCalling && !isAnswering && 'Waiting for connection'}
            </p>
            <p className="text-gray-400 text-xs sm:text-sm truncate max-w-[200px]">{doctorName}</p>
          </div>
        )}

        {/* PiP local video — bottom-right corner */}
        <div
          className={cn(
            'absolute bottom-2 right-2 sm:bottom-3 sm:right-3 rounded-lg overflow-hidden border-2 border-primary cursor-pointer transition-all hover:scale-105 shadow-lg',
            expandPip
              ? 'w-28 h-20 sm:w-40 sm:h-28'
              : 'w-20 h-14 sm:w-32 sm:h-24'
          )}
          onClick={() => setExpandPip(p => !p)}
        >
          <video ref={localVideoRef} autoPlay playsInline muted
            className={cn('w-full h-full object-cover', !localStream && 'hidden')} />
          {!localStream && (
            <div className="w-full h-full bg-slate-700 flex items-center justify-center">
              <span className="text-xs text-gray-400">Camera off</span>
            </div>
          )}
        </div>

        {/* Connection status badge — top-left */}
        {statusDisplay && (
          <div className={cn(
            'absolute top-2 left-2 sm:top-3 sm:left-3 text-white px-2 py-1 rounded-full text-xs font-semibold flex items-center gap-1 shadow',
            statusDisplay.color, statusDisplay.pulse && 'animate-pulse'
          )}>
            {connectionStatus === 'connected' && <Wifi className="h-3 w-3" />}
            {connectionStatus === 'failed'    && <WifiOff className="h-3 w-3" />}
            {statusDisplay.text}
          </div>
        )}

        {/* Network quality — top-right (only when active + poor) */}
        {isCallActive && networkQuality === 'poor' && (
          <div className="absolute top-2 right-2 sm:top-3 sm:right-3 bg-orange-500/80 text-white px-2 py-1 rounded-full text-xs flex items-center gap-1">
            <WifiOff className="h-3 w-3" />
            Poor Network
          </div>
        )}

        {/* Fullscreen button — top-right when active (shifts left of network badge) */}
        {isCallActive && (
          <Button
            variant="ghost" size="icon"
            className={cn(
              'absolute top-2 sm:top-3 bg-black/50 hover:bg-black/70 text-white',
              networkQuality === 'poor'
                ? 'right-20 sm:right-24'
                : 'right-2 sm:right-3'
            )}
            onClick={() => setIsFullscreen(true)}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* ── Controls panel ── fixed height, scrollable content */}
      <div className="flex-shrink-0 mt-3 rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm overflow-y-auto max-h-[220px] sm:max-h-[200px]">
        <div className="p-3 sm:p-4">

          {/* ── Pre-call ── */}
          {!isCallActive && !isCalling && !isAnswering && (
            <div className="space-y-3">
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 sm:p-3">
                  <p className="text-xs font-medium text-red-600 mb-1">❌ Error</p>
                  <p className="text-xs text-red-700">{error}</p>
                  <p className="text-xs text-red-600 mt-1 font-medium">
                    💡 Check camera/mic permissions and close other apps using them.
                  </p>
                </div>
              )}

              <label className="flex items-center gap-2 bg-muted/50 p-2 sm:p-3 rounded-lg cursor-pointer hover:bg-muted transition select-none">
                <input
                  type="checkbox"
                  checked={cameraOffMode}
                  onChange={(e: { target: HTMLInputElement }) => setCameraOffMode(e.target.checked)}
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-xs sm:text-sm font-medium">
                  {cameraOffMode ? '📹 Join with Camera OFF' : '📹 Join with Camera ON'}
                </span>
              </label>

              <Button
                onClick={() => { if (cameraOffMode) setVideoEnabled(false); onStartCall(!cameraOffMode); }}
                className="w-full bg-green-600 hover:bg-green-700 text-white gap-2"
                disabled={isCalling}
              >
                <Phone className="h-4 w-4" />
                {userRole === 'doctor' ? 'Start Call' : 'Call Doctor'}
              </Button>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2 text-xs text-blue-700 dark:text-blue-300">
                <p className="font-medium mb-1">📋 Before calling:</p>
                <ul className="space-y-0.5 list-disc list-inside">
                  <li>Allow camera &amp; microphone access</li>
                  <li>Use Chrome, Edge, Firefox, or Safari</li>
                  <li>Stable internet connection</li>
                </ul>
              </div>
            </div>
          )}

          {/* ── Incoming call ── */}
          {isAnswering && !isCallActive && (
            <div className="space-y-3">
              <p className="text-center font-semibold text-blue-500 text-sm animate-pulse">
                📞 Incoming call from {doctorName}
              </p>

              <label className="flex items-center gap-2 bg-muted/50 p-2 rounded-lg cursor-pointer hover:bg-muted transition select-none">
                <input
                  type="checkbox"
                  checked={cameraOffMode}
                  onChange={(e: { target: HTMLInputElement }) => setCameraOffMode(e.target.checked)}
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-xs sm:text-sm font-medium">
                  {cameraOffMode ? '📹 Camera OFF' : '📹 Camera ON'}
                </span>
              </label>

              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    if (cameraOffMode) setVideoEnabled(false);
                    // iOS Safari requires a user-gesture to unlock media playback.
                    // Local video MUST stay muted (prevents echo/feedback).
                    // Only unmute the remote video.
                    if (localVideoRef.current) {
                      localVideoRef.current.muted = true;
                      localVideoRef.current.play().catch(() => {});
                    }
                    if (remoteVideoRef.current) {
                      remoteVideoRef.current.muted = false;
                      remoteVideoRef.current.play().catch(() => {});
                    }
                    onAnswerCall(!cameraOffMode);
                  }}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white gap-2 font-semibold"
                >
                  <Phone className="h-4 w-4" /> Answer
                </Button>
                <Button
                  onClick={onEndCall}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white gap-2 font-semibold"
                >
                  <PhoneOff className="h-4 w-4" /> Decline
                </Button>
              </div>
            </div>
          )}

          {/* ── Calling (outgoing, waiting) ── */}
          {isCalling && !isCallActive && (
            <div className="space-y-3">
              <p className="text-center font-semibold text-yellow-600 animate-pulse text-sm">
                Calling {doctorName}…
              </p>
              <p className="text-center text-xs text-muted-foreground">
                Waiting for {userRole === 'doctor' ? 'patient' : 'doctor'} to answer…
              </p>
              <Button onClick={onEndCall} className="w-full bg-red-600 hover:bg-red-700 text-white gap-2">
                <PhoneOff className="h-4 w-4" /> Cancel Call
              </Button>
            </div>
          )}

          {/* ── Active call controls ── */}
          {isCallActive && (
            <div className="space-y-3">
              <p className="text-center text-xs text-muted-foreground">
                Connected with {doctorName}
              </p>

              {/* Media buttons */}
              <div className="flex gap-2 justify-center flex-wrap">
                <Button onClick={handleToggleAudio} variant={audioEnabled ? 'default' : 'destructive'}
                  size="sm" className="gap-1 flex-1 min-w-[64px]">
                  {audioEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                  <span className="hidden sm:inline">{audioEnabled ? 'Mute' : 'Unmute'}</span>
                </Button>

                <Button onClick={handleToggleVideo} variant={videoEnabled ? 'default' : 'destructive'}
                  size="sm" className="gap-1 flex-1 min-w-[64px]">
                  {videoEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                  <span className="hidden sm:inline">{videoEnabled ? 'Stop' : 'Start'}</span>
                </Button>

                {hasMultipleCameras && onSwitchCamera && (
                  <Button onClick={onSwitchCamera} variant="outline" size="sm" className="gap-1">
                    <SwitchCamera className="h-4 w-4" />
                    <span className="hidden sm:inline">Switch</span>
                  </Button>
                )}

                <Button onClick={onEndCall} variant="destructive" size="sm"
                  className="gap-1 flex-1 min-w-[64px]">
                  <PhoneOff className="h-4 w-4" />
                  <span className="hidden sm:inline">End</span>
                </Button>
              </div>

              {/* Appointment ID row */}
              <div className="flex items-center justify-between gap-2 bg-muted/50 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Appointment ID</p>
                  <p className="font-mono text-xs font-semibold truncate">{appointmentId.slice(0, 12)}…</p>
                </div>
                <Button onClick={handleCopy} size="sm" variant="ghost" className="flex-shrink-0 h-7 w-7 p-0">
                  {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Tips (only pre-call, outside scroll area) ── */}
      {!isCallActive && !isCalling && !isAnswering && (
        <div className="flex-shrink-0 mt-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
          <p className="font-semibold mb-0.5">💡 Tips:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Works on Chrome, Edge, Firefox, Safari (incl. iOS)</li>
            <li>Both parties must open the call dialog</li>
            <li>Use stable WiFi or mobile data</li>
          </ul>
        </div>
      )}
    </div>
  );
};
