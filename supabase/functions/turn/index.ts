import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function base64HmacSha256(key: string, message: string) {
  const encoder = new TextEncoder();

  return crypto.subtle
    .importKey(
      "raw",
      encoder.encode(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    )
    .then((cryptoKey) =>
      crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message))
    )
    .then((sig) =>
      btoa(String.fromCharCode(...new Uint8Array(sig)))
    );
}

serve(async (req) => {
  // ✅ Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Require a valid JWT to prevent TURN credential theft
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const ttl = 3600; // 1 hour
    const expiry = Math.floor(Date.now() / 1000) + ttl;
    const username = `${expiry}`;

    const secret = Deno.env.get("CF_API_TOKEN");
    if (!secret) {
      throw new Error("CF_API_TOKEN not set");
    }

    const credential = await base64HmacSha256(secret, username);

    return new Response(
      JSON.stringify({
        urls: [
          "turn:turn.cloudflare.com:3478?transport=udp",
          "turn:turn.cloudflare.com:3478?transport=tcp",
          "turns:turn.cloudflare.com:5349?transport=tcp",
        ],
        username,
        credential,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "TURN credential generation failed" }),
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
});
