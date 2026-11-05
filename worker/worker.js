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
   - POST /save — one scan as JSON ({load, transcript, flags,
     savedAt}), stored in the SCANS KV binding when one is bound.
     Until then it answers 501 storage-not-connected and the page
     falls back to share/copy, so testers are never blocked.
   - GET /samples?key=... — lists stored scans (most recent first)
     when the key matches the SAMPLES_KEY secret and SCANS is bound.
     Keys beginning with "__" are reserved and never listed.
   - GET /state, POST /state — the whole warehouse state as ONE JSON
     document under the reserved SCANS key "__warehouse_state__", so
     the desk and the phone share one world (desk-phone brief, Step 1,
     approved by William 2026-10-31).
     No key or secret value ever appears in this file; both live as
     Worker bindings/secrets set outside the repo.
   - POST /segment — {imageUrl, concept}: one SAM 3.1 concept
     segmentation of one public image, over Meta's Responses API.
     Answers {concept, matches: [{box: {x1,y1,x2,y2}, score?}]} with
     boxes normalized 0–1000 in the image's own frame. Masks are parsed
     past and never forwarded (SAM toggle brief, William 2026-11-05).

   The Meta API key lives ONLY as this Worker's secret binding,
   META_API_KEY (set in the dashboard: Worker -> Settings -> Variables
   and Secrets). It is never in this file and never in the page.

   Upstreams:
   - https://api.meta.ai/v1/chat/completions
   - https://api.meta.ai/v1/asr/transcribe
   - https://api.meta.ai/v1/responses (model sam-3.1, /segment only)
   ===================================================================== */

const ALLOWED_ORIGINS = [
  'https://grateful-ed.github.io',
  'http://localhost:8902',
  'https://localhost:8902'
];

const CHAT_MODEL = 'muse-spark-1.3';
/* Spark reasons in tokens before it speaks, and the reasoning is
   billed against the same budget as the reply. Measured on real
   calls (2026-10-31): Step 1 flagging fits in 3000, but a Step 2
   comparison of a real phone scan burned 8,628 reasoning tokens —
   at a 3000 ceiling it returned finish_reason "length" with null
   content, which is the failure William hit on his phone (photo
   scan fine, comparison silent, no OS&D button). Ceiling is 16000
   so the page can ask for what each step actually needs. */
const MAX_TOKENS_CEILING = 16000;
const MAX_CHAT_BODY_CHARS = 60000;
/* A camera photo sent as a base64 data: URL does not fit in 60,000
   chars (~45 KB of image). A request carrying a data: image part gets
   this larger cap instead; text-only requests keep the 60,000 cap. */
const MAX_CHAT_IMAGE_BODY_CHARS = 1500000;
const STATE_KEY = '__warehouse_state__';
/* /segment: SAM 3.1, one concept per call (Meta's docs: one noun
   phrase per request; lists return nothing). The concept set is the
   SAM toggle brief's, fixed server-side so the route cannot be used
   as an open segmentation proxy. Images must be the project's own
   public files. */
const SAM_MODEL = 'sam-3.1';
const SAM_CONCEPTS = ['cardboard box', 'shipping label', 'damaged cardboard box', 'torn plastic wrap'];
const SAM_IMAGE_PREFIX = 'https://grateful-ed.github.io/witness/';
const MAX_SEGMENT_BODY_CHARS = 2000;
const MAX_STATE_BODY_CHARS = 500000;

function originAllowed(origin) {
  return !!origin && ALLOWED_ORIGINS.indexOf(origin) !== -1;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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

/* True when any message carries an image part whose URL is a data:
   URL (a camera capture sent inline). */
function hasDataImage(messages) {
  return messages.some(function (m) {
    if (!m || !Array.isArray(m.content)) return false;
    return m.content.some(function (part) {
      return !!part && part.type === 'image_url' && !!part.image_url &&
        typeof part.image_url.url === 'string' && part.image_url.url.indexOf('data:') === 0;
    });
  });
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
  const cap = hasDataImage(body.messages) ? MAX_CHAT_IMAGE_BODY_CHARS : MAX_CHAT_BODY_CHARS;
  if (JSON.stringify(body).length > cap) {
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

/* ---------------- /save + /samples ----------------
   Scan storage. The SCANS KV binding is declared in
   worker/wrangler.jsonc (production namespace WITNESS_kv, plus a
   dedicated preview namespace) and bound to this Worker. If the
   binding is ever missing, both routes answer 501
   storage-not-connected — an expected, honest state, not an error
   in the code. */

function storageMissing(origin) {
  return json(501, { ok: false, error: 'storage-not-connected' }, origin);
}

async function handleSave(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!originAllowed(origin)) return json(403, { error: 'origin not allowed' }, origin);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(400, { error: 'expected a JSON body' }, origin);
  }
  if (!body || typeof body.transcript !== 'string' || !body.transcript) {
    return json(400, { error: 'body needs a non-empty "transcript" string' }, origin);
  }

  if (typeof env.SCANS === 'undefined') return storageMissing(origin);

  const savedAt = (typeof body.savedAt === 'string' && body.savedAt) || new Date().toISOString();
  const loadLabel = (typeof body.load === 'string' && body.load) || 'no-load';
  const scan = {
    load: (typeof body.load === 'string' && body.load) || null,
    /* kind: "scan" (a Step 1 spoken scan — the default, and what
       every pre-Step-2 save is), "osd" (a Step 2 OS&D report, whose
       transcript is the report text and whose verdicts ride along),
       or "photo" (a phone camera capture's flags). */
    kind: body.kind === 'osd' ? 'osd' : body.kind === 'photo' ? 'photo' : 'scan',
    transcript: body.transcript,
    flags: Array.isArray(body.flags) ? body.flags : [],
    savedAt: savedAt
  };
  if (Array.isArray(body.verdicts)) scan.verdicts = body.verdicts;
  /* bol: a bill of lading read (the BOL camera slice), kept only when
     it is a plain object. */
  if (body.bol && typeof body.bol === 'object' && !Array.isArray(body.bol)) scan.bol = body.bol;
  /* samEvidence: SAM 3.1 boxes attached to an OS&D when the photo
     scan's SAM toggle is ON (boxes only; the page never has masks).
     Kept only when it is a plain object. */
  if (body.samEvidence && typeof body.samEvidence === 'object' && !Array.isArray(body.samEvidence)) scan.samEvidence = body.samEvidence;
  const key = savedAt + '__' + loadLabel;
  try {
    await env.SCANS.put(key, JSON.stringify(scan));
  } catch (e) {
    return json(502, { ok: false, error: 'storage write failed' }, origin);
  }
  return json(200, { ok: true, key: key }, origin);
}

async function handleSamples(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (typeof env.SCANS === 'undefined') return storageMissing(origin);

  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  if (!env.SAMPLES_KEY || key !== env.SAMPLES_KEY) {
    return json(403, { ok: false, error: 'forbidden' }, origin);
  }

  let listed;
  try {
    listed = await env.SCANS.list({ limit: 100 });
  } catch (e) {
    return json(502, { ok: false, error: 'storage read failed' }, origin);
  }
  const names = (listed.keys || []).map(function (k) { return k.name; })
    .filter(function (n) { return n.indexOf('__') !== 0; }) /* reserved keys are not scans */
    .sort().reverse().slice(0, 100);
  const scans = [];
  for (const name of names) {
    let value = null;
    try {
      const raw = await env.SCANS.get(name);
      if (raw != null) {
        try { value = JSON.parse(raw); } catch (e) { value = raw; }
      }
    } catch (e) { /* a single unreadable entry must not sink the list */ }
    scans.push({ key: name, scan: value });
  }
  return json(200, { ok: true, count: scans.length, scans: scans }, origin);
}

/* ---------------- /state ----------------
   One JSON document: the whole warehouse. Stored and returned
   verbatim. Validation is deliberately light — it must be a JSON
   object. Auth posture matches /save (origin allow-list, no key);
   the state is synthetic test data. Last save wins, by design. */

async function handleStateGet(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!originAllowed(origin)) return json(403, { error: 'origin not allowed' }, origin);
  if (typeof env.SCANS === 'undefined') return storageMissing(origin);
  let raw;
  try {
    raw = await env.SCANS.get(STATE_KEY);
  } catch (e) {
    return json(502, { ok: false, error: 'storage read failed' }, origin);
  }
  if (raw == null) return json(404, { ok: false, error: 'no state yet' }, origin);
  return new Response(raw, {
    status: 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders(origin))
  });
}

async function handleStatePost(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!originAllowed(origin)) return json(403, { error: 'origin not allowed' }, origin);
  const text = await request.text();
  if (text.length > MAX_STATE_BODY_CHARS) return json(413, { ok: false, error: 'state too large' }, origin);
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    return json(400, { ok: false, error: 'expected a JSON object' }, origin);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { ok: false, error: 'expected a JSON object' }, origin);
  }
  if (typeof env.SCANS === 'undefined') return storageMissing(origin);
  try {
    await env.SCANS.put(STATE_KEY, text);
  } catch (e) {
    return json(502, { ok: false, error: 'storage write failed' }, origin);
  }
  return json(200, { ok: true }, origin);
}

/* ---------------- /segment ----------------
   SAM 3.1 over the Responses API, built to Meta's docs
   (dev.meta.ai/docs/media-segmentation, /docs/sam/segmenting,
   /docs/sam/reading-segmentation):
   - request: one user message with an input_text part (the concept,
     a bare noun phrase) and an input_image part (image_url: a public
     URL or a data URL). metadata.include_confidence "true" asks for c;
     metadata.mask_encoding "one_bit" keeps the reply small (the masks
     are thrown away here anyway). store false: nothing kept upstream.
   - reply: special-token text in output_text. One line per frame
     ("<0f>" for an image), comma-separated records, each record =
     object id, one box token, one mask token:
     <|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..[;c=..]|><|mask;...|>
     Box corners are source pixels (x2/y2 inclusive); w/h is the
     source image size; c is optional. Zero matches is an empty
     output_text — a normal result, not an error. */

/* Box records out of SAM's output text. Pure. Mask tokens are skipped
   (their base85 payload can hold any printable character, so only a
   box token that opens a record — right after a frame marker or a
   record comma — is read). Fields are read by key, so c may be absent. */
function parseSamBoxes(text) {
  const out = [];
  if (typeof text !== 'string' || !text) return out;
  const re = /(?:<\d+f>|,)(\d+)<\|box;([^|]*)\|>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const f = {};
    m[2].split(';').forEach(function (kv) {
      const i = kv.indexOf('=');
      if (i > 0) f[kv.slice(0, i)] = Number(kv.slice(i + 1));
    });
    const ok = ['x1', 'y1', 'x2', 'y2', 'w', 'h'].every(function (k) { return isFinite(f[k]); }) && f.w > 0 && f.h > 0;
    if (!ok) continue;
    const box = { x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, w: f.w, h: f.h };
    if (isFinite(f.c)) box.c = f.c;
    out.push(box);
  }
  return out;
}

/* Pixel box -> {box: {x1,y1,x2,y2} normalized 0–1000, score?}. */
function normaliseSamBox(b) {
  function n(v, size) { return Math.max(0, Math.min(1000, Math.round(v * 1000 / size))); }
  const match = { box: { x1: n(b.x1, b.w), y1: n(b.y1, b.h), x2: n(b.x2, b.w), y2: n(b.y2, b.h) } };
  if (typeof b.c === 'number') match.score = Math.round(b.c * 1000) / 1000;
  return match;
}

/* Every output_text in a non-streamed Responses reply, joined. */
function responsesText(j) {
  if (!j || !Array.isArray(j.output)) return null;
  const parts = [];
  j.output.forEach(function (item) {
    if (!item || !Array.isArray(item.content)) return;
    item.content.forEach(function (c) {
      if (c && c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    });
  });
  return parts.join('\n');
}

async function handleSegment(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!originAllowed(origin)) return json(403, { error: 'origin not allowed' }, origin);
  if (!env.META_API_KEY) return keyMissing(origin);

  const raw = await request.text();
  if (raw.length > MAX_SEGMENT_BODY_CHARS) return json(413, { error: 'request too large' }, origin);
  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    return json(400, { error: 'expected a JSON body' }, origin);
  }
  if (!body || typeof body.imageUrl !== 'string' || body.imageUrl.indexOf(SAM_IMAGE_PREFIX) !== 0) {
    return json(400, { error: 'body needs an "imageUrl" that is one of the project\'s own public images' }, origin);
  }
  if (SAM_CONCEPTS.indexOf(body.concept) === -1) {
    return json(400, { error: 'body needs a "concept" from: ' + SAM_CONCEPTS.join(', ') }, origin);
  }

  const upstream = {
    model: SAM_MODEL,
    input: [{
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: body.concept },
        { type: 'input_image', image_url: body.imageUrl }
      ]
    }],
    metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
    store: false
  };

  let res;
  try {
    res = await fetch('https://api.meta.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.META_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(upstream)
    });
  } catch (e) {
    return json(502, { error: 'segmentation service unreachable from the Worker' }, origin);
  }
  if (!res.ok) {
    return json(502, { error: 'segmentation service answered with an error (HTTP ' + res.status + ')' }, origin);
  }
  let j;
  try {
    j = await res.json();
  } catch (e) {
    return json(502, { error: 'segmentation service answered in a shape the Worker cannot read' }, origin);
  }
  const text = responsesText(j);
  if (text === null) {
    return json(502, { error: 'segmentation service answered in a shape the Worker cannot read' }, origin);
  }
  return json(200, { concept: body.concept, matches: parseSamBoxes(text).map(normaliseSamBox) }, origin);
}

/* ---------------- router ---------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return preflight(request);

    if (url.pathname === '/chat' || url.pathname === '/asr' || url.pathname === '/save' || url.pathname === '/segment') {
      if (request.method !== 'POST') {
        return json(405, { error: 'method not allowed' }, origin);
      }
      if (url.pathname === '/chat') return handleChat(request, env);
      if (url.pathname === '/asr') return handleAsr(request, env);
      if (url.pathname === '/segment') return handleSegment(request, env);
      return handleSave(request, env);
    }

    if (url.pathname === '/state') {
      if (request.method === 'GET') return handleStateGet(request, env);
      if (request.method === 'POST') return handleStatePost(request, env);
      return json(405, { error: 'method not allowed' }, origin);
    }

    if (url.pathname === '/samples') {
      if (request.method !== 'GET') {
        return json(405, { error: 'method not allowed' }, origin);
      }
      return handleSamples(request, env);
    }

    return json(404, { error: 'the witness Worker serves /chat, /asr, /save, /segment, /state and /samples' }, origin);
  }
};
