import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ── Feature flag ─────────────────────────────────────────────────────────────
// Set SEND_INVITE_EMAILS=true in Supabase → Project Settings → Edge Functions
// secrets to enable actual sending. Off by default: the client falls back to
// copy-link without any change when this is false or absent.
const ENABLED = Deno.env.get("SEND_INVITE_EMAILS") === "true";

// ── Secrets (set these in Supabase → Project Settings → Edge Functions) ──────
// RESEND_API_KEY : your Resend API key (starts with re_...)
// INVITE_FROM    : verified sender address, e.g. "AIESEClcpm <invites@yourdomain.com>"
//                   During setup you can use Resend's test address:
//                   "AIESEClcpm <onboarding@resend.dev>" (only delivers to your own account)
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_ADDRESS   = Deno.env.get("INVITE_FROM")    ?? "AIESEClcpm <onboarding@resend.dev>";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvitePayload {
  to:           string; // invited email
  token:        string; // PROJ-XXXXXXXX token
  inviterName:  string; // display name of the person sending the invite
  projectName:  string; // sub-project name
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Feature-flag off → tell the client gracefully, don't error
  if (!ENABLED) {
    return new Response(
      JSON.stringify({ sent: false, reason: "email_sending_disabled" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!RESEND_API_KEY) {
    console.error("[send-invite-email] RESEND_API_KEY secret is not set");
    return new Response(
      JSON.stringify({ sent: false, reason: "missing_api_key" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let payload: InvitePayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ sent: false, reason: "invalid_body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { to, token, inviterName, projectName } = payload;
  if (!to || !token || !inviterName || !projectName) {
    return new Response(
      JSON.stringify({ sent: false, reason: "missing_fields" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Accept link: same URL pattern the copy-link uses on the client
  const acceptUrl = `${Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000"}/login?project_invite=${token}`;

  const emailBody = {
    from:    FROM_ADDRESS,
    to:      [to],
    subject: `${inviterName} invited you to "${projectName}" on AIESEClcpm`,
    html: `
      <p>Hi,</p>
      <p><strong>${inviterName}</strong> has invited you to collaborate on
         <strong>${projectName}</strong> in AIESEClcpm.</p>
      <p>
        <a href="${acceptUrl}"
           style="display:inline-block;padding:10px 20px;background:#1B2E4B;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">
          Accept invitation
        </a>
      </p>
      <p style="color:#666;font-size:13px;">
        Or paste this link into your browser:<br/>
        <a href="${acceptUrl}">${acceptUrl}</a>
      </p>
      <p style="color:#999;font-size:12px;">
        If you weren't expecting this, you can ignore this email.
      </p>
    `,
    text: `${inviterName} invited you to "${projectName}" on AIESEClcpm.\n\nAccept here: ${acceptUrl}\n\nIf you weren't expecting this, ignore this email.`,
  };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(emailBody),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("[send-invite-email] Resend error:", res.status, detail);
      return new Response(
        JSON.stringify({ sent: false, reason: "resend_error", status: res.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ sent: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[send-invite-email] fetch failed:", err);
    return new Response(
      JSON.stringify({ sent: false, reason: "network_error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
