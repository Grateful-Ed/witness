/* =====================================================================
   asr-route.js — a POST /asr route for the existing tms-spark-proxy
   Cloudflare Worker, so the Witness app can transcribe spoken scans.

   WHAT IT DOES
   The Witness page records a push-to-talk scan (16 kHz mono WAV) and
   POSTs it to https://tms-spark-proxy.../asr as multipart form data,
   field "audio". This route forwards the audio to Meta's one-shot
   transcription endpoint (Muse Voice Transcribe) using the SAME Meta
   API key the Worker's /chat route already uses, and returns Meta's
   JSON response untouched. The key never leaves the Worker.

   WHAT IT DOES NOT TOUCH
   /chat is unchanged. The daily-cap behavior is unchanged — this route
   does not read or increment the usage counter (see CAP NOTE below).

   HOW TO INSTALL (see worker/README.md for the full walkthrough)
   1. Paste the FUNCTIONS at the bottom of your Worker code.
   2. Add the ROUTING BLOCK inside your existing fetch handler, before
      whatever it returns for unknown paths.
   3. Check the ONE marked line: the env binding name for the API key.

   Upstream: POST https://api.meta.ai/v1/asr/transcribe
   (Meta Model API; model muse-voice-transcribe-1.0. The credential
   goes in an Authorization header; the default mode is PUSH_TO_TALK,
   which is exactly the app's hold-to-talk button. The response is one
   JSON object carrying the transcript plus a turns array.)
   ===================================================================== */

/* Origins allowed to use /asr. KEEP THIS LIST IN STEP with the list
   /chat uses — the Witness page is served from grateful-ed.github.io,
   and localhost:8902 is the local test port /chat already allows. */
const ASR_ALLOWED_ORIGINS = [
  'https://grateful-ed.github.io',
  'http://localhost:8902',
  'https://localhost:8902'
];

function asrOriginAllowed(origin) {
  return !!origin && ASR_ALLOWED_ORIGINS.indexOf(origin) !== -1;
}

function asrCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function asrJson(status, obj, origin) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, asrCorsHeaders(origin))
  });
}

/* CORS preflight for /asr, mirroring how /chat answers it. */
function asrPreflight(request) {
  const origin = request.headers.get('Origin') || '';
  if (!asrOriginAllowed(origin)) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204, headers: asrCorsHeaders(origin) });
}

async function handleAsr(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!asrOriginAllowed(origin)) {
    return asrJson(403, { error: 'origin not allowed' }, origin);
  }

  /* CAP NOTE: /chat enforces a daily call cap through the USAGE KV
     binding. This route deliberately does not touch that counter, so
     installing it changes nothing about the cap. If you later want
     transcription counted too, paste /chat's counter increment here —
     this is the spot. */

  let audio = null;
  let filename = 'scan.wav';
  try {
    const form = await request.formData();
    audio = form.get('audio') || form.get('file');
    if (audio && audio.name) filename = audio.name;
  } catch (e) {
    return asrJson(400, { error: 'expected multipart form data with an "audio" file' }, origin);
  }
  if (!audio || typeof audio === 'string') {
    return asrJson(400, { error: 'missing audio file (form field "audio")' }, origin);
  }

  const out = new FormData();
  out.append('file', audio, filename);
  out.append('model', 'muse-voice-transcribe-1.0');
  out.append('mode', 'PUSH_TO_TALK');

  let metaRes;
  try {
    metaRes = await fetch('https://api.meta.ai/v1/asr/transcribe', {
      method: 'POST',
      headers: {
        /* CHECK THIS LINE: META_API_KEY must be the name of the secret
           binding your /chat route already reads the Meta key from.
           If /chat reads it under a different name, use that name here.
           The key itself is never typed into this file. */
        'Authorization': 'Bearer ' + env.META_API_KEY
      },
      body: out
    });
  } catch (e) {
    return asrJson(502, { error: 'transcription service unreachable from the Worker' }, origin);
  }

  /* Return Meta's response as-is: its JSON on success, its error body
     and status on failure, so the page (and you, debugging) see exactly
     what Meta said. */
  const body = await metaRes.text();
  return new Response(body, {
    status: metaRes.status,
    headers: Object.assign(
      { 'Content-Type': metaRes.headers.get('Content-Type') || 'application/json' },
      asrCorsHeaders(origin))
  });
}

/* =====================================================================
   ROUTING BLOCK — paste this inside your existing fetch handler,
   before its fallback/404 return. `url` is the parsed request URL;
   if your handler named it differently, use its name.

     if (url.pathname === '/asr') {
       if (request.method === 'OPTIONS') return asrPreflight(request);
       if (request.method === 'POST') return handleAsr(request, env);
       return asrJson(405, { error: 'method not allowed' }, request.headers.get('Origin') || '');
     }

   FIELD-NAME NOTE: the audio goes to Meta under the multipart field
   name "file" (the convention Meta's cookbook scripts use). If Meta
   ever answers 400 naming a missing field, its message says which —
   change the one out.append('file', ...) line above to match.
   ===================================================================== */
