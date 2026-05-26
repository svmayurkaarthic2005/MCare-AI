import { useEffect, useState } from 'react';
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

  // Auto-open the dialog when an incoming call arrives (isAnswering set by handleOffer)
  // This handles the case where the doctor hasn't clicked "Call" yet but the patient called.
  useEffect(() => {
    if (!isOpen && callState.isAnswering && onOpen) {
      console.log('[VideoChatDialog] Incoming call detected — auto-opening dialog');
      onOpen();
    }
  }, [callState.isAnswering, isOpen, onOpen]);

  // Only show video chat if consultation is online
  useEffect(() => {
    if (isOpen && consultationType !== 'online') {
      toast.error('This is an offline appointment. Video chat is not available.');
      onClose();
    }
  }, [isOpen, consultationType, onClose]);

  // Re-attach remote stream to video element when dialog opens.
  // Race condition: stream may arrive before the dialog (and its <video> ref) is mounted.
  // When isOpen becomes true, VideoChat mounts and its refs become valid — re-trigger attachment.
  useEffect(() => {
    if (isOpen && callState.remoteStream) {
      // Small delay to let the DOM settle after dialog open animation
      const t = setTimeout(() => {
        callActions.setRemoteStream(callState.remoteStream);
      }, 100);
      return () => clearTimeout(t);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => {
    if (callState.isCallActive || callState.isCalling || callState.isAnswering) {
      setConfirmEndCall(true);
    } else {
      onClose();
    }
  };

  if (consultationType !== 'online') {
    return null;
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
        {/* Dialog fills most of the viewport; inner content is a flex column */}
        <DialogContent className="max-w-2xl w-[95vw] h-[92vh] max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
          {/* Header — fixed, never scrolls */}
          <DialogHeader className="flex-shrink-0 px-4 pt-4 pb-2 sm:px-5 sm:pt-5 border-b border-border/40">
            <DialogTitle className="flex items-center justify-between pr-6 text-base sm:text-lg">
              <span className="truncate">Video Appointment — {doctorName}</span>
              {callState.isCallActive && (
                <span className="flex-shrink-0 text-xs px-2 py-0.5 bg-green-500/20 text-green-500 rounded-full animate-pulse ml-2">
                  Live
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
              onAnswerCall={callActions.answerCall}
              onEndCall={callActions.endCall}
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
