import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { VideoChat } from './VideoChat';
import { useWebRTCCall } from '@/hooks/use-webrtc-call';
import { toast } from 'sonner';

interface VideoChatDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void; // called when dialog auto-opens due to incoming call
  appointmentId: string;
  patientId: string;
  doctorId: string;
  doctorName: string;
  userRole: 'doctor' | 'patient';
  consultationType: string;
}

export const VideoChatDialog = ({
  isOpen,
  onClose,
  onOpen,
  appointmentId,
  patientId,
  doctorId,
  doctorName,
  userRole,
  consultationType,
}: VideoChatDialogProps) => {
  const [confirmEndCall, setConfirmEndCall] = useState(false);
  // Track whether the user manually dismissed an incoming call so we don't re-open.
  const [incomingDismissed, setIncomingDismissed] = useState(false);
  // Ref for the auto-dismiss timeout so it can be cleared on answer/decline.
  const incomingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentUserId = userRole === 'doctor' ? doctorId : patientId;
  const remoteUserId = userRole === 'doctor' ? patientId : doctorId;

  // Only initialise WebRTC for online consultations.
  // Pass a stable empty string for offline so the hook creates no channel.
  const [callState, callActions] = useWebRTCCall(
    consultationType === 'online' ? appointmentId : '',
    currentUserId,
    userRole,
    remoteUserId
  );

  // Auto-open the dialog when an incoming call arrives.
  // Guard: don't reopen if the user already dismissed this incoming call.
  useEffect(() => {
    if (!isOpen && callState.isAnswering && onOpen && !incomingDismissed) {
      console.log('[VideoChatDialog] Incoming call detected — auto-opening dialog');
      onOpen();

      // Auto-dismiss after 60s if not answered — matches hook-level call timeout
      if (incomingTimeoutRef.current) clearTimeout(incomingTimeoutRef.current);
      incomingTimeoutRef.current = setTimeout(() => {
        if (!callState.isCallActive) {
          console.log('[VideoChatDialog] Incoming call auto-dismissed after timeout');
          callActions.dismissIncomingCall();
          setIncomingDismissed(true);
        }
      }, 60000);
    }
  }, [callState.isAnswering, isOpen, onOpen, incomingDismissed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset dismissed flag when a new call arrives (isAnswering goes false → true)
  useEffect(() => {
    if (!callState.isAnswering) {
      setIncomingDismissed(false);
      if (incomingTimeoutRef.current) {
        clearTimeout(incomingTimeoutRef.current);
        incomingTimeoutRef.current = null;
      }
    }
  }, [callState.isAnswering]);

  // Only show video chat if consultation is online
  useEffect(() => {
    if (isOpen && consultationType !== 'online') {
      toast.error('This is an offline appointment. Video chat is not available.');
      onClose();
    }
  }, [isOpen, consultationType, onClose]);

  // handleClose: only block close for active/outgoing calls.
  // Incoming-call state (isAnswering) is dismissible — user should never be trapped.
  const handleClose = () => {
    if (callState.isCallActive || callState.isCalling) {
      // Guard against duplicate triggers (ESC + backdrop click race)
      if (!confirmEndCall) setConfirmEndCall(true);
    } else {
      // Dismiss any pending incoming call and mark it so auto-open doesn't refire
      if (callState.isAnswering) {
        callActions.dismissIncomingCall();
        setIncomingDismissed(true);
      }
      onClose();
    }
  };

  if (consultationType !== 'online') {
    return null;
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
        {/*
          h-[92dvh]: dynamic viewport units fix iOS Safari toolbar resize issue.
          dvh accounts for the browser chrome shrinking/growing on scroll,
          preventing cropped controls and black bottom areas on mobile.
        */}
        <DialogContent className="max-w-2xl w-[95vw] h-[92dvh] max-h-[92dvh] flex flex-col p-0 gap-0 overflow-hidden">
          {/* Header — fixed, never scrolls */}
          <DialogHeader className="flex-shrink-0 px-4 pt-4 pb-2 sm:px-5 sm:pt-5 border-b border-border/40">
            <DialogTitle className="flex items-center justify-between pr-6 text-base sm:text-lg">
              <span className="truncate">Video Appointment — {doctorName}</span>
              {callState.isCallActive && (
                <span className="flex-shrink-0 text-xs px-2 py-0.5 bg-green-500/20 text-green-500 rounded-full animate-pulse ml-2">
                  Live
                </span>
              )}
              {callState.connectionStatus === 'reconnecting' && (
                <span className="flex-shrink-0 text-xs px-2 py-0.5 bg-orange-500/20 text-orange-500 rounded-full animate-pulse ml-2">
                  Reconnecting…
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* VideoChat fills the remaining height; it manages its own internal layout */}
          <div className="flex-1 min-h-0 overflow-hidden p-3 sm:p-4">
            <VideoChat
              localStream={callState.localStream}
              remoteStream={callState.remoteStream}
              isCallActive={callState.isCallActive}
              isCalling={callState.isCalling}
              isAnswering={callState.isAnswering}
              onStartCall={callActions.startCall}
              onAnswerCall={(videoEnabled) => {
                // Clear auto-dismiss timer — user answered manually
                if (incomingTimeoutRef.current) {
                  clearTimeout(incomingTimeoutRef.current);
                  incomingTimeoutRef.current = null;
                }
                return callActions.answerCall(videoEnabled);
              }}
              onEndCall={() => {
                // Clear auto-dismiss timer on decline too
                if (incomingTimeoutRef.current) {
                  clearTimeout(incomingTimeoutRef.current);
                  incomingTimeoutRef.current = null;
                }
                callActions.endCall();
              }}
              onToggleAudio={callActions.toggleAudio}
              onToggleVideo={callActions.toggleVideo}
              onSwitchCamera={callActions.switchCamera}
              doctorName={doctorName}
              appointmentId={appointmentId}
              userRole={userRole}
              error={callState.error}
              connectionStatus={callState.connectionStatus}
              networkQuality={callState.networkQuality}
            />
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmEndCall} onOpenChange={setConfirmEndCall}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End Call</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to end the call?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                callActions.endCall();
                setConfirmEndCall(false);
                onClose();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              End Call
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
