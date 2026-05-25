import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

// Restrict CORS to the app's own origin in production.
// SUPABASE_URL contains the project URL; derive the app origin from env or fall back to '*' for local dev.
const appOrigin = Deno.env.get('APP_ORIGIN') || '*';

const corsHeaders = {
  'Access-Control-Allow-Origin': appOrigin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Server misconfigured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const client = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(
        JSON.stringify({ error: 'Invalid body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { user_id, title, message, type = 'system', link = null } = body;

    if (!user_id || !title || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: user_id, title, message' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check user notification preferences stored on the profiles table.
    // send_email maps to appointment-type notifications; skip if disabled.
    try {
      const { data: profile, error: prefErr } = await client
        .from('profiles')
        .select('send_email, send_whatsapp')
        .eq('id', user_id)
        .maybeSingle();

      if (!prefErr && profile) {
        if (type === 'appointment' && profile.send_email === false) {
          return new Response(
            JSON.stringify({ skipped: true, reason: 'User disabled appointment notifications' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    } catch (e) {
      // Non-fatal — proceed with insert even if preference check fails
      console.warn('Could not read notification preferences, proceeding:', e);
    }

    const { data, error } = await client
      .from('notifications')
      .insert([{ user_id, title, message, type, link }]);

    if (error) {
      console.error('Error inserting notification:', error);
      return new Response(
        JSON.stringify({ error: error.message || 'Insert failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in create-notification function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
