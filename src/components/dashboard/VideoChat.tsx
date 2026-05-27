import { useState, useRef, useEffect, useCallback } from 'react';
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const checkMultipleCameras = async (): Promise<boolean> => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput').length > 1;
  } catch {
    return false;
  }
};

/**
 * Attach a MediaStream to a <video> element with a bounded retry loop.
 * Retries up to `maxRetries` times on non-AbortError failures.
 */
const attachStream = (
  video: HTMLVideoElement,
  stream: MediaStream,
  maxRetries = 3,
  attempt = 0
) => {
  video.play().catch((err: unknown) => {
    const e = err as { name?: string };
    if (e.name === 'AbortError') return; // in-flight play() was interrupted — safe to ignore
    if (attempt < maxRetries) {
      setTimeout(() => attachStream(video, stream, maxRetries, attempt + 1), 300);
    }
  });
};

// ─── Component ───────────────────────────────────────────────────────────────

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
  // ── Separate refs for normal and fullscreen layouts (issue 1) ──────────────
  // Using the same ref in two conditional render branches means React points the
  // ref at whichever <video> is currently mounted. When fullscreen toggles, the
  // ref briefly points to a detached node → stream playback interrupts on Safari.
  // Solution: four refs, streams attached to all live nodes simultaneously.
  const normalLocalRef   = useRef<HTMLVideoElement>(null);
  const normalRemoteRef  = useRef<HTMLVideoElement>(null);
  const fsLocalRef       = useRef<HTMLVideoElement>(null);
  const fsRemoteRef      = useRef<HTMLVideoElement>(null);

  // Fullscreen container ref for the native Fullscreen API (issue 4)
  const fsContainerRef   = useRef<HTMLDivElement>(null);

  const [audioEnabled, setAudioEnabled]         = useState(true);
  const [videoEnabled, setVideoEnabled]         = useState(true);
  const [cameraOffMode, setCameraOffMode]       = useState(false);
  const [copied, setCopied]                     = useState(false);
  const [expandPip, setExpandPip]               = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [isFullscreen, setIsFullscreen]         = useState(false);

  // ── Check multiple cameras AFTER local stream exists (issue 3) ────────────
  // enumerateDevices() before permission is granted returns incomplete results
  // on Safari/iOS — device labels are empty and counts may be wrong.
  useEffect(() => {
    if (localStream) {
      checkMultipleCameras().then(setHasMultipleCameras);
    }
  }, [localStream]);

  // ── Reset UI state only when call fully ends (issue 7) ────────────────────
  // Previously used isCallActive which flips false during reconnect, causing
  // fullscreen to exit unexpectedly. Use connectionStatus === 'idle' instead.
  useEffect(() => {
    if (connectionStatus === 'idle' && !isCalling && !isAnswering) {
      setAudioEnabled(true);
      setVideoEnabled(true);
      setCameraOffMode(false);
      setIsFullscreen(false);
      setExpandPip(false);
    }
  }, [connectionStatus, isCalling, isAnswering]);

  // ── Attach local stream to all live local video nodes (issue 1) ───────────
  useEffect(() => {
    const refs = [normalLocalRef, fsLocalRef];
    refs.forEach(ref => {
      if (!ref.current) return;
      ref.current.srcObject = localStream ?? null;
      if (localStream) attachStream(ref.current, localStream);
    });
  }, [localStream, isFullscreen]); // re-run when fullscreen mounts new node

  // ── Attach remote stream to all live remote video nodes (issue 1) ─────────
  useEffect(() => {
    const refs = [normalRemoteRef, fsRemoteRef];
    refs.forEach(ref => {
      const video = ref.current;
      if (!video) return;

      if (!remoteStream) {
        if (connectionStatus === 'idle') video.srcObject = null;
        return;
      }

      if (video.srcObject !== remoteStream) {
        video.srcObject = remoteStream;
      }
      attachStream(video, remoteStream);
    });
  }, [remoteStream, connectionStatus, isFullscreen]); // re-run when fullscreen mounts new node

  // ── Force play on connected (iOS Safari user-gesture unlock) ──────────────
  useEffect(() => {
    if (connectionStatus === 'connected') {
      [normalLocalRef, fsLocalRef].forEach(ref => {
        if (ref.current) { ref.current.muted = true; ref.current.play().catch(() => {}); }
      });
      [normalRemoteRef, fsRemoteRef].forEach(ref => {
        if (ref.current) { ref.current.play().catch(() => {}); }
      });
    }
  }, [connectionStatus]);

  // ── Native Fullscreen API (issue 4) ───────────────────────────────────────
  // Uses requestFullscreen with webkit fallback for Safari.
  // Falls back to CSS fixed-overlay if the API is unavailable (older iOS).
  const enterFullscreen = useCallback(async () => {
    setIsFullscreen(true);
    // Wait one frame for the fullscreen container to mount
    await new Promise(r => requestAnimationFrame(r));
    const el = fsContainerRef.current as any;
    if (!el) return;
    try {
      if (el.requestFullscreen)            await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    } catch {
      // API unavailable (older iOS) — CSS overlay is already shown, that's fine
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      const doc = document as any;
      if (doc.exitFullscreen)            await doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
    } catch {}
    setIsFullscreen(false);
  }, []);

  // Sync isFullscreen state with native fullscreen changes (e.g. ESC key)
  useEffect(() => {
    const onFsChange = () => {
      const doc = document as any;
      const isNativeFs = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
      if (!isNativeFs && isFullscreen) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, [isFullscreen]);

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

  // ── Shared video area content (used in both layouts) ──────────────────────
  const renderVideoArea = (
    remoteRef: React.RefObject<HTMLVideoElement>,
    localRef: React.RefObject<HTMLVideoElement>,
    compact = false
  ) => (
    <>
      {/* Remote video */}
      <video
        ref={remoteRef}
        autoPlay playsInline
        disablePictureInPicture
        className={cn('absolute inset-0 w-full h-full object-cover', !remoteStream && 'hidden')}
        onLoadedMetadata={(e) => attachStream(e.currentTarget, remoteStream!)}
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

      {/* PiP local video */}
      <div
        className={cn(
          'absolute rounded-lg overflow-hidden border-2 border-primary cursor-pointer transition-all hover:scale-105 shadow-lg',
          compact
            ? cn('bottom-3 right-3', expandPip ? 'w-28 h-20' : 'w-20 h-14')
            : cn('bottom-2 right-2 sm:bottom-3 sm:right-3', expandPip ? 'w-28 h-20 sm:w-40 sm:h-28' : 'w-20 h-14 sm:w-32 sm:h-24')
        )}
        onClick={() => setExpandPip(p => !p)}
      >
        <video
          ref={localRef}
          autoPlay playsInline muted
          disablePictureInPicture
          className={cn('w-full h-full object-cover', !localStream && 'hidden')}
        />
        {!localStream && (
          <div className="w-full h-full bg-slate-700 flex items-center justify-center">
            <span className="text-xs text-gray-400">{compact ? 'Off' : 'Camera off'}</span>
          </div>
        )}
      </div>

      {/* Reconnect overlay */}
      {isCallActive && connectionStatus === 'reconnecting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10 gap-3">
          <div className="w-10 h-10 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-white text-sm font-semibold">Reconnecting…</p>
          <p className="text-gray-300 text-xs">Please wait, restoring connection</p>
        </div>
      )}

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

      {/* Network quality badge — top-right */}
      {isCallActive && networkQuality === 'poor' && (
        <div className="absolute top-2 right-2 sm:top-3 sm:right-3 bg-orange-500/80 text-white px-2 py-1 rounded-full text-xs flex items-center gap-1">
          <WifiOff className="h-3 w-3" />
          Poor Network
        </div>
      )}
    </>
  );

  // ── Shared controls ────────────────────────────────────────────────────────
  const renderCallControls = (compact = false) => (
    <div className={cn('flex items-center justify-center gap-3', !compact && 'flex-wrap')}>
      <Button
        onClick={handleToggleAudio}
        variant={audioEnabled ? 'default' : 'destructive'}
        size="sm"
        className="gap-1"
        aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
      >
        {audioEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        {!compact && <span className="hidden sm:inline">{audioEnabled ? 'Mute' : 'Unmute'}</span>}
      </Button>

      <Button
        onClick={handleToggleVideo}
        variant={videoEnabled ? 'default' : 'destructive'}
        size="sm"
        className="gap-1"
        aria-label={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
      >
        {videoEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
        {!compact && <span className="hidden sm:inline">{videoEnabled ? 'Stop' : 'Start'}</span>}
      </Button>

      {hasMultipleCameras && onSwitchCamera && (
        <Button
          onClick={onSwitchCamera}
          variant="outline"
          size="sm"
          className="gap-1"
          aria-label="Switch camera"
        >
          <SwitchCamera className="h-4 w-4" />
          {!compact && <span className="hidden sm:inline">Switch</span>}
        </Button>
      )}

      <Button
        onClick={onEndCall}
        variant="destructive"
        size="sm"
        className={cn('gap-1', compact && 'px-4')}
        aria-label="End call"
      >
        <PhoneOff className="h-4 w-4" />
        <span className={compact ? undefined : 'hidden sm:inline'}>End</span>
      </Button>
    </div>
  );

  // ─── Fullscreen layout ────────────────────────────────────────────────────
  if (isFullscreen) {
    return (
      <div ref={fsContainerRef} className="fixed inset-0 z-50 bg-black flex flex-col">
        <div className="relative flex-1 min-h-0">
          {renderVideoArea(fsRemoteRef, fsLocalRef, true)}

          {/* Exit fullscreen */}
          <Button
            variant="ghost" size="icon"
            className="absolute top-3 right-3 bg-black/50 hover:bg-black/70 text-white z-20"
            onClick={exitFullscreen}
            aria-label="Exit fullscreen"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-shrink-0 bg-black/80 px-4 py-3">
          {renderCallControls(true)}
        </div>
      </div>
    );
  }

  // ─── Normal (in-dialog) layout ────────────────────────────────────────────
  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">

      {/* ── Video area ── */}
      <div className="relative flex-1 min-h-0 bg-black rounded-xl overflow-hidden">
        {renderVideoArea(normalRemoteRef, normalLocalRef)}

        {/* Fullscreen button — only when call active */}
        {isCallActive && (
          <Button
            variant="ghost" size="icon"
            className={cn(
              'absolute top-2 sm:top-3 bg-black/50 hover:bg-black/70 text-white z-20',
              networkQuality === 'poor' ? 'right-20 sm:right-24' : 'right-2 sm:right-3'
            )}
            onClick={enterFullscreen}
            aria-label="Enter fullscreen"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* ── Controls panel ── */}
      <div className="flex-shrink-0 mt-3 rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm overflow-y-auto max-h-[220px] sm:max-h-[200px]">
        <div className="p-3 sm:p-4">

          {/* Pre-call */}
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
                  onChange={(e) => setCameraOffMode(e.target.checked)}
                  className="w-4 h-4 accent-primary"
                  aria-label="Join with camera off"
                />
                <span className="text-xs sm:text-sm font-medium">
                  {cameraOffMode ? '📹 Join with Camera OFF' : '📹 Join with Camera ON'}
                </span>
              </label>

              <Button
                onClick={() => { if (cameraOffMode) setVideoEnabled(false); onStartCall(!cameraOffMode); }}
                className="w-full bg-green-600 hover:bg-green-700 text-white gap-2"
                disabled={isCalling}
                aria-label={userRole === 'doctor' ? 'Start call' : 'Call doctor'}
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

          {/* Incoming call */}
          {isAnswering && !isCallActive && (
            <div className="space-y-3">
              <p className="text-center font-semibold text-blue-500 text-sm animate-pulse">
                📞 Incoming call from {doctorName}
              </p>

              <label className="flex items-center gap-2 bg-muted/50 p-2 rounded-lg cursor-pointer hover:bg-muted transition select-none">
                <input
                  type="checkbox"
                  checked={cameraOffMode}
                  onChange={(e) => setCameraOffMode(e.target.checked)}
                  className="w-4 h-4 accent-primary"
                  aria-label="Answer with camera off"
                />
                <span className="text-xs sm:text-sm font-medium">
                  {cameraOffMode ? '📹 Camera OFF' : '📹 Camera ON'}
                </span>
              </label>

              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    if (cameraOffMode) setVideoEnabled(false);
                    // iOS Safari: user-gesture required to unlock media playback.
                    // Local video stays muted (prevents echo). Remote unmuted here.
                    normalLocalRef.current?.play().catch(() => {});
                    if (normalRemoteRef.current) normalRemoteRef.current.play().catch(() => {});
                    onAnswerCall(!cameraOffMode);
                  }}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white gap-2 font-semibold"
                  aria-label="Answer call"
                >
                  <Phone className="h-4 w-4" /> Answer
                </Button>
                <Button
                  onClick={onEndCall}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white gap-2 font-semibold"
                  aria-label="Decline call"
                >
                  <PhoneOff className="h-4 w-4" /> Decline
                </Button>
              </div>
            </div>
          )}

          {/* Outgoing call — waiting */}
          {isCalling && !isCallActive && (
            <div className="space-y-3">
              <p className="text-center font-semibold text-yellow-600 animate-pulse text-sm">
                Calling {doctorName}…
              </p>
              <p className="text-center text-xs text-muted-foreground">
                Waiting for {userRole === 'doctor' ? 'patient' : 'doctor'} to answer…
              </p>
              <Button
                onClick={onEndCall}
                className="w-full bg-red-600 hover:bg-red-700 text-white gap-2"
                aria-label="Cancel call"
              >
                <PhoneOff className="h-4 w-4" /> Cancel Call
              </Button>
            </div>
          )}

          {/* Active call controls */}
          {isCallActive && (
            <div className="space-y-3">
              <p className="text-center text-xs text-muted-foreground">
                Connected with {doctorName}
              </p>

              <div className="flex gap-2 justify-center flex-wrap">
                {renderCallControls()}
              </div>

              {/* Appointment ID row */}
              <div className="flex items-center justify-between gap-2 bg-muted/50 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Appointment ID</p>
                  {/* issue 6: safe slice with nullish fallback */}
                  <p className="font-mono text-xs font-semibold truncate">
                    {appointmentId?.slice(0, 12) ?? 'Unknown'}…
                  </p>
                </div>
                <Button
                  onClick={handleCopy}
                  size="sm" variant="ghost"
                  className="flex-shrink-0 h-7 w-7 p-0"
                  aria-label="Copy appointment ID"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Tips — pre-call only */}
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
