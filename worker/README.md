# Worker: adding the /asr route to tms-spark-proxy

The Witness page can record a spoken scan and structure it today — the
structuring half already runs through the proxy's existing `/chat`
route. The one missing piece is transcription: the proxy needs a
`POST /asr` route that forwards audio to Muse Voice Transcribe. That
route lives in `asr-route.js` in this folder. Adding it is a
Cloudflare-dashboard job (about ten minutes), and it is deliberately
additive: `/chat` and the daily cap are untouched.

## Steps

1. Open the Cloudflare dashboard → Workers & Pages → **tms-spark-proxy**
   → Edit code.
2. Scroll to the bottom of the Worker and paste in the **functions**
   from `asr-route.js` (everything except the comment header).
3. Find the `fetch` handler. Near the top of it, after the request URL
   is parsed, paste the **routing block** (it's in the comment at the
   bottom of `asr-route.js`), before whatever the handler returns for
   unknown paths.
4. Check the one marked line in `handleAsr`: the key is read as
   `env.META_API_KEY`. If your `/chat` code reads the Meta API key from
   a secret with a different binding name, change this line to that
   name. Never paste the key itself into the code — it stays a secret.
5. Save and deploy (in Cloudflare, **Save** stages the change;
   **Promote**/deploy makes it live — the same two-step as before).

## Checks before you save

- The origin list at the top of `asr-route.js` should match the list
  `/chat` uses. It already includes `https://grateful-ed.github.io`
  (where the Witness page is served) and the localhost test port.
- The audio field name sent to Meta is `file`. If Meta answers a test
  with a 400 naming a missing field, its message says which field —
  change the one marked `out.append('file', ...)` line to match.
- Daily cap: `/asr` does **not** count against the `/chat` daily cap
  in this version, on purpose. A marked spot in `handleAsr` shows
  where `/chat`'s counter increment would go if you ever want them
  counted together.

## What "done" looks like

Open the Witness page (GitHub Pages), hold the button, speak a scan,
release. The page shows your words verbatim, then the structured
record. If the route isn't live, the page says exactly that instead of
failing quietly — that's how you'll know step 5 didn't take.
