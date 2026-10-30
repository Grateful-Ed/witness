/* =====================================================================
   worker.js — the Witness Worker. ALL of it. One file, pasted whole
   into a Cloudflare Worker named "witness".

   Witness runs on its OWN Worker, completely separate from
   tms-spark-proxy and from Ship Safe (William's ruling, 2026-10-30:
   start from scratch on the Cloudflare side, name it Witness). Nothing
   here is shared: not the code, not the routes, not the cap, not the
   secret. The only thing the two projects have in common is that both
   call the Meta Model API — with this Worker's own key.

   Routes:
   - POST /chat — OpenAI-shaped chat completions, forwarded to Muse
     Spark (model forced server-side). The Witness page sends its
     structuring request here; the transcript -> record step.
   - POST /asr  — multipart audio (field "audio", 16 kHz mono WAV),
     forwarded to Muse Voice Transcribe's one-shot endpoint
     (mode PUSH_TO_TALK — the app's hold-to-talk button). Returns
     Meta's JSON untouched.

   The Meta API key lives ONLY as this Worker's secret binding,
   META_API_KEY (set in the dashboard: Worker -> Settings -> Variables
   and Secrets). It is never in this file and never in the page.

   Upstreams:
   - https://api.meta.ai/v1/chat/completions
   - https://api.meta.ai/v1/asr/transcribe
   ===================================================================== */

const ALLOWED_ORIGINS = [
  'https://grateful-ed.github.io',
  'http://localhost:8902',
  'https://localhost:8902'
];

const CHAT_MODEL = 'muse-spark-1.3';
const MAX_TOKENS_CEILING = 3000;   /* Spark reasons in tokens before it speaks; Ship Safe measured an empty reply at 900. */
const MAX_CHAT_BODY_CHARS = 60000;

function originAllowed(origin) {
  return !!origin && ALLOWED_ORIGINS.indexOf(origin) !== -1;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(status, obj, origin) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders(origin))
  });
}

function preflight(request) {
  const origin = request.headers.get('Origin') || '';
  if (!originAllowed(origin)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function keyMissing(origin) {
  return json(500, { error: 'META_API_KEY secret is not set on the witness Worker yet' }, origin);
}

/* ---------------- /chat ---------------- */

async function handleChat(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!originAllowed(origin)) return json(403, { error: 'origin not allowed' }, origin);
  if (!env.META_API_KEY) return keyMissing(origin);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(400, { error: 'expected a JSON body' }, origin);
  }
  if (!body || !Array.isArray(body.messages) || !body.messages.length) {
    return json(400, { error: 'body needs a non-empty "messages" array' }, origin);
  }
  if (JSON.stringify(body).length > MAX_CHAT_BODY_CHARS) {
    return json(413, { error: 'request too large' }, origin);
  }

  const upstream = {
    model: CHAT_MODEL,
    messages: body.messages,
    max_tokens: Math.min(
      typeof body.max_tokens === 'number' ? body.max_tokens : MAX_TOKENS_CEILING,
      MAX_TOKENS_CEILING)
  };
  if (typeof body.temperature === 'number') upstream.temperature = body.temperature;

  let res;
  try {
    res = await fetch('https://api.meta.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.META_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(upstream)
    });
  } catch (e) {
    return json(502, { error: 'chat service unreachable from the Worker' }, origin);
  }

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: Object.assign(
      { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
      corsHeaders(origin))
  });
}

/* ---------------- /asr ---------------- */

async function handleAsr(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!originAllowed(origin)) return json(403, { error: 'origin not allowed' }, origin);
  if (!env.META_API_KEY) return keyMissing(origin);

  let audio = null;
  let filename = 'scan.wav';
  try {
    const form = await request.formData();
    audio = form.get('audio') || form.get('file');
    if (audio && audio.name) filename = audio.name;
  } catch (e) {
    return json(400, { error: 'expected multipart form data with an "audio" file' }, origin);
  }
  if (!audio || typeof audio === 'string') {
    return json(400, { error: 'missing audio file (form field "audio")' }, origin);
  }

  /* Meta's one-shot endpoint takes exactly two parts — verified live
     2026-10-30 against the endpoint's own error messages, after the
     first phone test 400'd: a "request" part holding JSON (model,
     mode, audioEncoding) and an "audio" part holding the bytes.
     The page sends 16 kHz mono WAV, hence audioEncoding "WAV". */
  const out = new FormData();
  out.append('request', new Blob([JSON.stringify({
    model: 'muse-voice-transcribe-1.0',
    mode: 'PUSH_TO_TALK',
    audioEncoding: 'WAV'
  })], { type: 'application/json' }));
  out.append('audio', audio, filename);

  let res;
  try {
    res = await fetch('https://api.meta.ai/v1/asr/transcribe', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.META_API_KEY },
      body: out
    });
  } catch (e) {
    return json(502, { error: 'transcription service unreachable from the Worker' }, origin);
  }

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: Object.assign(
      { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
      corsHeaders(origin))
  });
}

/* ---------------- router ---------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return preflight(request);

    if (url.pathname === '/chat' || url.pathname === '/asr') {
      if (request.method !== 'POST') {
        return json(405, { error: 'method not allowed' }, origin);
      }
      return url.pathname === '/chat' ? handleChat(request, env) : handleAsr(request, env);
    }

    return json(404, { error: 'the witness Worker serves /chat and /asr' }, origin);
  }
};
