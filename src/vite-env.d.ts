/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Supabase — required
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;

  // n8n / AI webhook URLs — optional (fall back to dev ngrok URLs)
  readonly VITE_N8N_WEBHOOK_URL?: string;
  readonly VITE_AI_ASSISTANT_WEBHOOK_URL?: string;
  readonly VITE_BLOOD_ANALYSIS_WEBHOOK_URL?: string;

  // Metered.ca TURN server credentials — optional (fall back to bundled dev credentials)
  readonly VITE_METERED_TURN_USERNAME?: string;
  readonly VITE_METERED_TURN_CREDENTIAL?: string;

  // Vite built-ins
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
