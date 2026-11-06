# Brief — Photo scan: send the sheet as a data URL (production fix)

From Faye, 2026-11-06. Small, surgical, production-first. This
brief is also the frozen-file exception for `js/photo.js`:
William approved this fix by name; the exception covers this
change only.

## The bug (verified live, 2026-11-05)

The desk photo scan — the second witness of module one — is
broken in production. `askPhoto()` in `js/photo.js` sends the
contact sheet to the Worker `/chat` **by public URL**:

```js
{ type: 'image_url', image_url: { url: SHEETS[loadKey] } }
```

Meta's service refuses to fetch this project's public image
URLs. Faye reproduced it live against the production Worker —
the call returns, verbatim:

```
{"error":{"code":"media_url_not_fetchable","message":"failed
to download media at messages[1].content[1]: URL is not
fetchable by this service"}}
```

This is the same refusal PR #36 proved for `/segment`, which
was fixed by switching to data-URL transport. The `/chat`
scan path never got the same fix. The fix below is already
proven live: Faye sent the identical `/chat` call with the
sheet as a data URL and got correct flags JSON back.

## The change (one function)

In `js/photo.js`, `askPhoto(loadKey)` only:

1. Resolve `sheetDataUrl(loadKey)` first — the function
   already exists in this file (line ~394), built for the
   SAM path in PR #36; it returns a Promise of a JPEG q0.8
   data URL at natural size, or `null` when the image cannot
   be encoded.
2. Send that data URL as the `image_url` in the same chat
   message. System prompt, user text, temperature, parsing,
   `normalisePhotoFlags`, and the unparseable-error path all
   stay exactly as they are.
3. If `sheetDataUrl` resolves `null`, throw an honest error
   with a `userMessage` in the existing style ("The photo
   could not be prepared for the scan…") — never fall back
   to the URL, which is the broken path.

Nothing else changes. `SHEETS` stays (it still names the
loads and the loadKey validity check at line ~732 uses it);
the SAM path is untouched; no Worker change; no test-data
change.

## NOT in scope

- The phone's photo capture (it already sends its own
  downscaled JPEG — not a hosted URL; not broken).
- The 'shipping label' SAM concept question (separate,
  William's call someday).
- Any prompt, flag-shape, or verdict change.

## Acceptance

- Full node suite AND `test/wms-ui-smoke.js` run and
  reported separately (current merged-main counts: 1,776
  node, 61 smoke — they only grow, never shrink silently;
  a new test pinning that askPhoto sends a data URL, not an
  http URL, is welcome if it fits the harness patterns).
- The PR states the exact head SHA and the one-file diff.
- Post-merge, Faye verifies live: the production photo scan
  of Load B returns flags again (the data-URL call shape is
  already proven; the page flow is what gets verified).
- Open the PR as a draft. Do not merge — William's word,
  like always.
