import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

declare global {
  interface Window {
    n8nCreateChat?: (config: any) => any;
  }
}

export const AIHealthAssistant = ({ userId }: { userId: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chatInstanceRef = useRef<any>(null);
  const isInitializingRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || !userId) {
      return;
    }

    // If already initialized, don't reinitialize
    if (chatInstanceRef.current && isInitializingRef.current === false) {
      console.log("✅ n8n chat already initialized, skipping");
      return;
    }

    // Prevent duplicate initialization
    if (isInitializingRef.current) {
      console.warn("⚠️ n8n chat initialization already in progress");
      return;
    }
    isInitializingRef.current = true;

    // Wait for n8n chat to be available
    const initializeChat = (retryCount = 0) => {
      if (!window.n8nCreateChat) {
        if (retryCount < 10) {
          console.warn(`⚠️ n8n chat script loading... (${retryCount + 1}/10)`);
          setTimeout(() => initializeChat(retryCount + 1), 500);
        } else {
          console.error("❌ n8n chat failed to load");
          isInitializingRef.current = false;
        }
        return;
      }

      try {
        // Only clear and reinitialize if no existing instance
        if (!chatInstanceRef.current && containerRef.current) {
          containerRef.current.innerHTML = '';
          
          // Create ONLY ONE chat instance
          chatInstanceRef.current = window.n8nCreateChat({
            webhookUrl: import.meta.env.VITE_AI_ASSISTANT_WEBHOOK_URL ||
              'https://shaven-luz-superideally.ngrok-free.dev/webhook/025ec6b9-2d6d-44c9-bdec-cfbc082ef53c/chat',
            target: containerRef.current,
            metadata: {
              userId: userId,
            },
            initialMessages: [
              {
                message: 'Hello! 👋 I\'m your AI Health Assistant. How can I help you today?',
                type: 'ai',
              },
            ],
          });
          console.log("✅ n8n chat initialized successfully");
        }
        isInitializingRef.current = false;
      } catch (error) {
        console.error("❌ Error initializing n8n chat:", error);
        chatInstanceRef.current = null;
        isInitializingRef.current = false;
        if (retryCount < 5) {
          console.log(`🔄 Retrying n8n chat initialization (${retryCount + 1}/5)...`);
          setTimeout(() => initializeChat(retryCount + 1), 1000);
        }
      }
    };

    initializeChat();

    return () => {
      // Cleanup - preserve the instance but clear container if unmounting
      if (containerRef.current && !userId) {
        containerRef.current.innerHTML = '';
        chatInstanceRef.current = null;
      }
    };
  }, [userId]);

  if (!userId) {
    return (
      <div className="flex flex-col h-full p-6 items-center justify-center">
        <p className="text-muted-foreground">User ID is required to use the AI assistant.</p>
        <div className="mt-4 text-center">
          <h3 className="text-lg font-semibold">AI Health Assistant</h3>
          <p className="text-sm text-muted-foreground">Ask me anything about your health</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-4">
      <div 
        ref={containerRef} 
        className="flex-1 w-full rounded-lg border overflow-hidden"
        style={{ minHeight: '400px' }}
      />
    </div>
  );
};
