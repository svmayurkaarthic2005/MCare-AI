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

  // Only show video chat if consultation is online
  useEffect(() => {
    if (isOpen && consultationType !== 'online') {
      toast.error('This is an offline appointment. Video chat is not available.');
      onClose();
    }
  }, [isOpen, consultationType, onClose]);

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
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-4xl w-[95vw] sm:h-[90vh] h-[95vh] flex flex-col p-4 sm:p-6">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center justify-between pr-8">
              <span className="text-lg sm:text-xl">Video Appointment with {doctorName}</span>
              {callState.isCallActive && (
                <span className="text-xs px-2 py-1 bg-green-500/20 text-green-500 rounded-full animate-pulse">
                  Call Active
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-hidden min-h-0">
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
