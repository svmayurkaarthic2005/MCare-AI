import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const CHAT_CSS = `
  :root {
    --chat--color--primary: #06b6d4;
    --chat--color--primary-shade-50: #0891b2;
    --chat--color--primary--shade-100: #0a7ca4;
    --chat--color--secondary: #06b6d4;
    --chat--color-secondary-shade-50: #0891b2;
    --chat--color-white: #ffffff;
    --chat--color-light: #f2f4f8;
    --chat--color-light-shade-50: #e6e9f1;
    --chat--color-light-shade-100: #c2c5cc;
    --chat--color-medium: #d2d4d9;
    --chat--color-dark: #101330;
    --chat--color-disabled: #777980;
    --chat--color-typing: #404040;

    --chat--spacing: 1rem;
    --chat--border-radius: 0.25rem;
    --chat--transition-duration: 0.15s;

    --chat--window--width: 400px;
    --chat--window--height: 600px;

    --chat--header-height: auto;
    --chat--header--padding: var(--chat--spacing);
    --chat--header--background: #1a1a2e;
    --chat--header--color: #ffffff;
    --chat--header--border-top: none;
    --chat--header--border-bottom: 1px solid #06b6d4;
    --chat--heading--font-size: 2em;
    --chat--subtitle--font-size: inherit;
    --chat--subtitle--line-height: 1.8;

    --chat--textarea--height: 50px;

    --chat--message--font-size: 1rem;
    --chat--message--padding: var(--chat--spacing);
    --chat--message--border-radius: var(--chat--border-radius);
    --chat--message-line-height: 1.8;
    --chat--message--bot--background: #2a2a3e;
    --chat--message--bot--color: #e4e4e7;
    --chat--message--bot--border: none;
    --chat--message--user--background: #06b6d4;
    --chat--message--user--color: #ffffff;
    --chat--message--user--border: none;
    --chat--message--pre--background: rgba(6, 182, 212, 0.1);

    --chat--toggle--background: #06b6d4;
    --chat--toggle--hover--background: #0891b2;
    --chat--toggle--active--background: #0a7ca4;
    --chat--toggle--color: #ffffff;
    --chat--toggle--size: 64px;
  }

  body {
    background: #1a1a2e !important;
    color: #e4e4e7 !important;
  }

  /* Chat container background */
  .n8n-chat {
    background: #1a1a2e !important;
  }

  /* Icon colors */
  svg {
    color: #06b6d4 !important;
  }

  svg path,
  svg circle,
  svg rect,
  svg line {
    stroke: #06b6d4 !important;
    fill: none !important;
  }

  svg use {
    stroke: #06b6d4 !important;
    fill: #06b6d4 !important;
  }

  /* Specific icon styling for chat button */
  [class*="toggle"] svg,
  button[aria-label*="chat"] svg,
  .n8n-chat-toggle-button svg {
    color: #ffffff !important;
    fill: #ffffff !important;
  }

  [class*="toggle"] svg path,
  button[aria-label*="chat"] svg path,
  .n8n-chat-toggle-button svg path {
    stroke: #ffffff !important;
    fill: #ffffff !important;
  }
`;

export const useN8nChat = () => {
  useEffect(() => {
    let observer: MutationObserver | null = null;

    const initializeChat = async () => {
      try {
        // Check if user is authenticated before initializing chat
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error || !session) {
          console.log('No authenticated session found, skipping n8n chat initialization');
          // Hide chat if it exists
          hideChat();
          return;
        }

        // Import the createChat function dynamically
        // @ts-ignore - External CDN module
        const { createChat } = await import('https://cdn.jsdelivr.net/npm/@n8n/chat/dist/chat.bundle.es.js');
        
        // Use n8n webhook for chat - read from env variable, fall back to hardcoded for dev
        const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_URL ||
          'https://shaven-luz-superideally.ngrok-free.dev/webhook/91e16669-c4a9-4c40-b5da-2e0bf5d76a97/chat';
        
        // Initialize n8n chat with Mayur as agent name and theme colors
        window.n8nChatInstance = createChat({
          webhookUrl: webhookUrl,
          initialMessages: [
            'Hi there! 👋',
            'My name is Mayur. How can I assist you today?'
          ],
          i18n: {
            en: {
              title: 'Chat with Mayur',
              subtitle: "I'm here to help you 24/7.",
              footer: '',
              getStarted: 'New Conversation',
              inputPlaceholder: 'Type your question..',
            }
          }
        });
        
        console.log(`✅ n8n chat widget initialized with Mayur as agent`);
        
        // Inject CSS into iframe after chat loads
        const injectCSS = () => {
          const iframes = document.querySelectorAll('iframe');
          iframes.forEach(iframe => {
            try {
              if (iframe.contentDocument) {
                // Check if style already exists
                const existingStyle = iframe.contentDocument.getElementById('n8n-custom-styles');
                if (!existingStyle) {
                  const style = iframe.contentDocument.createElement('style');
                  style.id = 'n8n-custom-styles';
                  style.innerHTML = CHAT_CSS;
                  iframe.contentDocument.head.appendChild(style);
                  console.log('✅ CSS injected into chat iframe');
                }
              }
            } catch (e) {
              console.warn('Cannot access iframe (CORS):', e);
            }
          });
        };
        
        // Try CSS injection after delays
        setTimeout(injectCSS, 1000);
        setTimeout(injectCSS, 2000);
        setTimeout(injectCSS, 3000);
        
        // Watch for iframe changes — store ref so cleanup can disconnect it
        observer = new MutationObserver(() => {
          injectCSS();
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
      } catch (error) {
        console.error('❌ Error initializing n8n chat:', error);
      }
    };

    // Listen for auth state changes to control chat visibility
    const { data: authListener } = supabase.auth.onAuthStateChange((event: string, session: any) => {
      if (event === 'SIGNED_OUT' || !session) {
        hideChat();
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        // Re-initialize chat on sign in
        initializeChat();
      }
    });

    initializeChat();

    return () => {
      // Disconnect observer to prevent memory leak
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (authListener?.subscription) {
        authListener.subscription.unsubscribe();
      }
    };
  }, []);
};

// Helper function to hide n8n chat
const hideChat = () => {
  const chatButton = document.querySelector('[class*="toggle"]');
  const chatContainer = document.querySelector('.n8n-chat');
  
  if (chatButton) {
    (chatButton as HTMLElement).style.display = 'none';
  }
  if (chatContainer) {
    (chatContainer as HTMLElement).style.display = 'none';
  }
  
  // Also destroy instance if it exists
  if (window.n8nChatInstance) {
    try {
      window.n8nChatInstance.close?.();
    } catch (e) {
      console.warn('Could not close chat instance:', e);
    }
  }
};

declare global {
  interface Window {
    n8nChatInstance?: any;
  }
}
