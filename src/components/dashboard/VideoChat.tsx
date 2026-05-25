import { useState, useRef, useEffect } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Copy, Check, SwitchCamera, Wifi, WifiOff, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

// Check if device has multiple cameras (for mobile switch button)
const checkMultipleCameras = async (): Promise<boolean> => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter((d) => d.kind === 'videoinput');
    return videoInputs.length > 1;
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
  const [expandRemote, setExpandRemote] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Check for multiple cameras on mount
  useEffect(() => {
    checkMultipleCameras().then(setHasMultipleCameras);
  }, []);

  // Reset media control state when call ends so next call starts fresh
  useEffect(() => {
    if (!isCallActive && !isCalling && !isAnswering) {
      setAudioEnabled(true);
      setVideoEnabled(true);
      setCameraOffMode(false);
      setIsFullscreen(false);
      setExpandRemote(false);
    }
  }, [isCallActive, isCalling, isAnswering]);

  // Connect local stream to video element
  useEffect(() => {
    if (!localVideoRef.current) return;
    if (localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    } else {
      // Clear the video element when stream is gone
      localVideoRef.current.srcObject = null;
    }
  }, [localStream]);

  // Connect remote stream to video element
  // FIX 2: Attach srcObject in useEffect (NOT inline)
  // Mobile browsers ignore dynamic stream updates unless you force attach
  // FIX (DESKTOP CHROME): Must explicitly call .play() - autoplay doesn't work without user gesture
  useEffect(() => {
    if (!remoteVideoRef.current) return;

    if (!remoteStream) {
      // Clear the video element when stream is gone (prevents showing last frame)
      remoteVideoRef.current.srcObject = null;
      return;
    }

    console.log('[UI] Remote stream changed, tracks:', 
      remoteStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState }))
    );
    
    remoteVideoRef.current.srcObject = remoteStream;

    // FIX (DESKTOP CHROME): CRITICAL - Force playback on desktop
    // Desktop Chrome blocks autoplay even with autoplay attribute unless explicitly called
    const playVideo = async () => {
      if (!remoteVideoRef.current) return;
      
      try {
        await remoteVideoRef.current.play();
      } catch (err: unknown) {
        const e = err as { name?: string; message?: string };
        console.warn('[UI] Play failed:', e.name, e.message);
        // Retry after 300ms (accounts for transceiver setup delay)
        setTimeout(() => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.play().catch((retryErr: unknown) => {
              const re = retryErr as { name?: string };
              console.warn('[UI] Retry play failed:', re.name);
            });
          }
        }, 300);
      }
    };

    playVideo();
  }, [remoteStream]);

  // Defensive fix: Force play when connection becomes connected
  useEffect(() => {
    if (connectionStatus === 'connected') {
      // Only play our own video elements, not every video on the page
      [localVideoRef.current, remoteVideoRef.current].forEach(v => {
        if (v) v.play().catch(() => {});
      });
    }
  }, [connectionStatus]);

  const handleToggleAudio = () => {
    const newState = !audioEnabled;
    setAudioEnabled(newState);
    onToggleAudio(newState);
  };

  const handleToggleVideo = () => {
    const newState = !videoEnabled;
    setVideoEnabled(newState);
    onToggleVideo(newState);
  };

  const handleCopyAppointmentId = async () => {
    try {
      await navigator.clipboard.writeText(appointmentId);
      setCopied(true);
      toast.success('Appointment ID copied!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers that block clipboard access
      toast.error('Could not copy to clipboard');
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // Connection status display
  const getStatusDisplay = () => {
    switch (connectionStatus) {
      case 'connecting':
        return { text: 'Connecting...', color: 'bg-yellow-500', animate: true };
      case 'connected':
        return { text: 'Connected', color: 'bg-green-500', animate: false };
      case 'reconnecting':
        return { text: 'Reconnecting...', color: 'bg-orange-500', animate: true };
      case 'failed':
        return { text: 'Connection Failed', color: 'bg-red-500', animate: false };
      default:
        return null;
    }
  };

  const statusDisplay = getStatusDisplay();

  return (
    <div className={cn(
      "w-full h-full flex flex-col gap-4 p-4 min-h-0",
      isFullscreen && "fixed inset-0 z-50 bg-black p-0"
    )}>
      {/* Video Container */}
      <div className={cn(
        "flex-1 relative bg-black rounded-lg overflow-hidden min-h-[200px] sm:min-h-[300px]",
        isFullscreen && "rounded-none min-h-full"
      )}>
        {/* Remote Video — always rendered so ref is always valid; visibility controlled by CSS */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          muted={false}
          className={cn(
            "w-full h-full object-cover bg-black",
            !remoteStream && "hidden"
          )}
          onLoadedMetadata={(e: { currentTarget: HTMLVideoElement }) => {
            const v = e.currentTarget;
            v.play().catch(() => {
              setTimeout(() => v.play(), 300);
            });
          }}
        />
        {!remoteStream && (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 px-4">
            <div className="text-center">
              <div className="text-3xl sm:text-4xl mb-2 sm:mb-4">📞</div>
              <p className="text-white mb-1 sm:mb-2 text-sm sm:text-base">
                {connectionStatus === 'connecting' && 'Connecting...'}
                {connectionStatus === 'reconnecting' && 'Reconnecting...'}
                {isCalling && connectionStatus !== 'connecting' && 'Calling...'}
                {isAnswering && connectionStatus !== 'connecting' && 'Ready to answer'}
                {connectionStatus === 'idle' && !isCalling && !isAnswering && 'Waiting for connection'}
              </p>
              <p className="text-xs sm:text-sm text-gray-400 truncate max-w-xs">{doctorName}</p>
            </div>
          </div>
        )}

        {/* Local Video - Picture in Picture — always rendered so ref is always valid */}
        <div
          className={cn(
            'absolute rounded-lg overflow-hidden border-2 border-primary cursor-pointer transition-all hover:scale-105',
            expandRemote
              ? 'bottom-2 right-2 sm:bottom-4 sm:right-4 w-20 h-16 sm:w-32 sm:h-24'
              : 'bottom-2 right-2 sm:bottom-4 sm:right-4 w-24 h-20 sm:w-48 sm:h-36'
          )}
          onClick={() => setExpandRemote(!expandRemote)}
        >
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={cn("w-full h-full object-cover", !localStream && "hidden")}
          />
          {!localStream && (
            <div className="w-full h-full bg-slate-700 flex items-center justify-center">
              <span className="text-xs text-gray-400">Camera off</span>
            </div>
          )}
        </div>

        {/* Connection Status Badge */}
        {statusDisplay && (
          <div className={cn(
            "absolute top-2 left-2 sm:top-4 sm:left-4 text-white px-2 py-1 sm:px-3 sm:py-1 rounded-full text-xs sm:text-sm font-semibold flex items-center gap-1",
            statusDisplay.color,
            statusDisplay.animate && "animate-pulse"
          )}>
            {connectionStatus === 'connected' && <Wifi className="h-3 w-3" />}
            {connectionStatus === 'failed' && <WifiOff className="h-3 w-3" />}
            {statusDisplay.text}
          </div>
        )}

        {/* Network Quality Indicator */}
        {isCallActive && networkQuality === 'poor' && (
          <div className="absolute top-2 right-2 sm:top-4 sm:right-4 bg-orange-500/80 text-white px-2 py-1 rounded-full text-xs flex items-center gap-1">
            <WifiOff className="h-3 w-3" />
            Poor Network
          </div>
        )}

        {/* Fullscreen Toggle */}
        {isCallActive && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 sm:top-4 sm:right-4 bg-black/50 hover:bg-black/70 text-white"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        )}
      </div>

      {/* Controls */}
      <Card className={cn(
        "bg-gradient-to-r from-card to-card/50 border-primary/20 flex-shrink-0 flex flex-col max-h-[40vh] sm:max-h-[35vh] overflow-hidden",
        isFullscreen && "absolute bottom-4 left-4 right-4 max-h-[30vh]"
      )}>
        <CardContent className="pt-4 sm:pt-6 overflow-y-auto flex-1">
          {!isCallActive && !isCalling && !isAnswering ? (
            // Pre-Call State
            <div className="space-y-3 sm:space-y-4">
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 sm:p-3">
                  <p className="text-xs sm:text-sm font-medium text-red-600 mb-1 sm:mb-2">❌ Error:</p>
                  <p className="text-xs sm:text-sm text-red-700">{error}</p>
                  <p className="text-xs text-red-600 mt-1 sm:mt-2 font-medium">
                    💡 Check camera/mic permissions and close other apps using them.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="flex items-center gap-2 bg-slate-100 dark:bg-slate-900 p-2 sm:p-3 rounded-lg cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition">
                  <input
                    type="checkbox"
                    checked={cameraOffMode}
                    onChange={(e: { target: HTMLInputElement }) => setCameraOffMode(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-xs sm:text-sm font-medium truncate">
                    {cameraOffMode ? '📹 Join with Camera OFF' : '📹 Join with Camera ON'}
                  </span>
                </label>
              </div>

              <Button
                onClick={() => {
                  if (cameraOffMode) setVideoEnabled(false);
                  onStartCall(!cameraOffMode);
                }}
                className="w-full bg-green-600 hover:bg-green-700 text-white gap-2 text-sm sm:text-base"
                disabled={isCalling}
              >
                <Phone className="h-4 w-4" />
                {userRole === 'doctor' ? 'Start Call' : 'Call Doctor'}
              </Button>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2 sm:p-3 text-xs">
                <p className="font-medium text-blue-600 mb-1">📋 Before calling:</p>
                <ul className="space-y-0.5 text-blue-700">
                  <li>✓ Allow camera/microphone access</li>
                  <li>✓ Use Chrome, Edge, Firefox, or Safari</li>
                  <li>✓ Stable internet connection</li>
                </ul>
              </div>
            </div>
          ) : isAnswering && !isCallActive ? (
            // Incoming Call State
            <div className="space-y-3 sm:space-y-4">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2 sm:p-4">
                <p className="text-center font-semibold mb-2 text-blue-500 text-sm sm:text-base truncate animate-pulse">
                  📞 Incoming call from {doctorName}
                </p>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 bg-slate-100 dark:bg-slate-900 p-2 sm:p-3 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cameraOffMode}
                    onChange={(e: { target: HTMLInputElement }) => setCameraOffMode(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-xs sm:text-sm font-medium">
                    {cameraOffMode ? '📹 Camera OFF' : '📹 Camera ON'}
                  </span>
                </label>
              </div>

              <div className="flex gap-2 sm:gap-3">
                <Button
                  onClick={() => {
                    if (cameraOffMode) setVideoEnabled(false);
                    // iOS Safari requires user gesture to unlock media playback
                    // Only touch our own video elements, not every video on the page
                    [localVideoRef.current, remoteVideoRef.current].forEach(v => {
                      if (v) { v.muted = false; v.play().catch(() => {}); }
                    });
                    onAnswerCall(!cameraOffMode);
                  }}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white gap-2 font-semibold"
                >
                  <Phone className="h-4 w-4" />
                  Answer
                </Button>
                <Button
                  onClick={onEndCall}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white gap-2 font-semibold"
                >
                  <PhoneOff className="h-4 w-4" />
                  Decline
                </Button>
              </div>
            </div>
          ) : isCalling && !isCallActive ? (
            // Calling State
            <div className="space-y-3 sm:space-y-4">
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 sm:p-4">
                <p className="text-center font-semibold text-yellow-600 animate-pulse text-sm sm:text-base">
                  Calling {doctorName}...
                </p>
                <p className="text-center text-xs text-yellow-600 mt-2">
                  Waiting for {userRole === 'doctor' ? 'patient' : 'doctor'} to answer...
                </p>
              </div>

              <Button
                onClick={onEndCall}
                className="w-full bg-red-600 hover:bg-red-700 text-white gap-2"
              >
                <PhoneOff className="h-4 w-4" />
                Cancel Call
              </Button>
            </div>
          ) : (
            // Active Call State
            <div className="space-y-3 sm:space-y-4">
              <div className="text-center mb-2">
                <p className="text-xs sm:text-sm text-muted-foreground truncate">
                  Connected with {doctorName}
                </p>
              </div>

              {/* Media Controls */}
              <div className="flex gap-1 sm:gap-2 justify-center flex-wrap">
                <Button
                  onClick={handleToggleAudio}
                  variant={audioEnabled ? 'default' : 'destructive'}
                  size="sm"
                  className="gap-1 text-xs sm:text-sm flex-1 min-w-[70px]"
                >
                  {audioEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                  <span className="hidden sm:inline">{audioEnabled ? 'Mute' : 'Unmute'}</span>
                </Button>

                <Button
                  onClick={handleToggleVideo}
                  variant={videoEnabled ? 'default' : 'destructive'}
                  size="sm"
                  className="gap-1 text-xs sm:text-sm flex-1 min-w-[70px]"
                >
                  {videoEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                  <span className="hidden sm:inline">{videoEnabled ? 'Stop' : 'Start'}</span>
                </Button>

                {hasMultipleCameras && onSwitchCamera && (
                  <Button
                    onClick={onSwitchCamera}
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs sm:text-sm"
                  >
                    <SwitchCamera className="h-4 w-4" />
                    <span className="hidden sm:inline">Switch</span>
                  </Button>
                )}

                <Button
                  onClick={onEndCall}
                  variant="destructive"
                  size="sm"
                  className="gap-1 text-xs sm:text-sm flex-1 min-w-[70px]"
                >
                  <PhoneOff className="h-4 w-4" />
                  <span className="hidden sm:inline">End</span>
                </Button>
              </div>

              {/* Appointment ID */}
              <div className="bg-slate-100 dark:bg-slate-900 rounded-lg p-2 sm:p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Appointment ID</p>
                  <p className="font-mono text-xs sm:text-sm font-semibold truncate">
                    {appointmentId.slice(0, 10)}...
                  </p>
                </div>
                <Button onClick={handleCopyAppointmentId} size="sm" variant="ghost" className="flex-shrink-0">
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tips when not in call */}
      {!isCallActive && !isFullscreen && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2 sm:p-3 text-xs">
          <p className="font-semibold mb-1">💡 Tips:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Works on Chrome, Edge, Firefox, Safari (including iOS)</li>
            <li>Both parties need to open the call dialog</li>
            <li>Use stable WiFi or mobile data</li>
          </ul>
        </div>
      )}
    </div>
  );
};


