# Worker: the Witness Worker (from scratch)

Witness runs on its **own** Cloudflare Worker, named **witness** —
completely separate from `tms-spark-proxy` and from Ship Safe
(William's ruling, 2026-10-30). Nothing is shared: not the code, not
the routes, not the secret. The whole Worker is one file:
`worker.js` in this folder. Setting it up is a Cloudflare-dashboard
job, about ten minutes, all of it yours (the key never passes through
anyone else's hands).

The page is already pointed at it:
`https://witness.e-william-harris96.workers.dev` (`/asr` for
transcription, `/chat` for structuring).

## Steps

1. Cloudflare dashboard → **Workers & Pages** → **Create** →
   **Create Worker**. Name it **witness** exactly. Deploy the starter
   it gives you (it just says hello — that's fine).
2. Open the **witness** Worker → **Edit code**. Select everything in
   the editor, delete it, and paste in all of `worker.js`.
3. **Deploy** (if your editor shows the two-step instead: **Save**
   stages, **Promote** makes it live — same dance as before).
4. Add the key: Worker → **Settings** → **Variables and Secrets** →
   add a **Secret** named **META_API_KEY**. The value is your Meta
   Model API key — paste it from your Meta dashboard yourself. It is
   never typed into code, chat, or this repo.
5. Deploy once more if step 4 asks for it.

## What "done" looks like

Open the Witness page (GitHub Pages), hold the button, speak a scan,
release. The page shows your words verbatim, then the structured
record. Until the Worker is live, the page says exactly that instead
of failing quietly — that's how you'll know a step didn't take.

Notes:

- If the Worker lands at a different address than
  `witness.e-william-harris96.workers.dev`, the two URL constants at
  the top of `js/voice.js` and `js/record.js` need the real address —
  tell Faye what it shows and she'll repoint the page.
- The old plan — an `/asr` route bolted onto `tms-spark-proxy` — is
  dead by the same ruling. `asr-route.js` was removed; the proxy is
  untouched and stays Ship Safe / TMS plumbing only.
- This Worker has no daily cap of its own (the proxy's 300/day KV cap
  is the proxy's, not Witness's). Meta-side credit limits still apply
  — the hackathon's $150 credit is what Witness spends.
