# Brief — Worker preview builds: give the SCANS binding a preview KV namespace

**For Claude, from Faye (Repo room), on William's word 2026-11-05 ("fix it").**
Repo: `Grateful-Ed/witness`. One new file. Nothing else changes.

## The problem

Cloudflare preview builds of the `witness` Worker fail while production builds
stay green. The Worker's SCANS KV binding points at the production namespace
only; a preview version of a Worker cannot bind a production KV namespace —
it needs a dedicated preview namespace declared alongside it (a `preview_id`
on the binding). The Worker is currently dashboard-managed: there is **no
wrangler config in this repo** (worker.js says so in its own header comment),
so the build has nothing to read a preview binding from.

## Already done (Faye, via the Cloudflare API, 2026-11-05)

A dedicated preview namespace exists on the account:

- Production: `WITNESS_kv` — id `7b95f49bb5ab477ebc0492555140cdba`
- Preview: `WITNESS_kv_preview` — id `9af22a51c5784cc1b72b305683e2e47e`

Namespace ids are configuration, not credentials; they belong in the config
file. The production id above is the one the dashboard binding already uses —
the new file must match it exactly.

## Your job

Create **`worker/wrangler.jsonc`** declaring the Worker as it exists today,
with the one addition:

```jsonc
{
  "name": "witness",
  "main": "worker.js",
  "compatibility_date": "2024-12-01",
  "workers_dev": true,
  "kv_namespaces": [
    {
      "binding": "SCANS",
      "id": "7b95f49bb5ab477ebc0492555140cdba",
      "preview_id": "9af22a51c5784cc1b72b305683e2e47e"
    }
  ]
}
```

Rules:

- **Do not touch `worker/worker.js`** — this PR is config-only. (worker/* is a
  frozen surface; this config file is the approved exception William ordered.)
- **No secrets in the file.** `META_API_KEY` stays a dashboard secret,
  untouched and unreferenced. No vars section, no other bindings — the Worker
  has none today (no D1, R2, queues, cron, or custom routes; it serves on
  workers.dev).
- Because this file now exists, it becomes the config the build reads. If you
  know a production setting it fails to declare (a compatibility flag the
  dashboard shows, an observability toggle), say so in the PR description
  instead of guessing it into the file.
- Update worker.js's header comment only if it claims no wrangler file exists;
  keep the edit to that one claim.
- Tests: the node suites do not cover this file; run them anyway
  (`node test/<name>-test.js` for the glob **plus `node test/wms-ui-smoke.js`
  explicitly**) and report counts. Open the PR and stop — William merges.

## The one unknown (name it in the PR description)

Workers Builds reads the config from the build's root directory, which is a
dashboard setting Faye cannot see. If the build's root is the repo root rather
than `worker/`, the file may need to live at the root instead. The next preview
build's log will say whether it found the config; if it did not, the follow-up
is moving this same file, not rewriting it.

## What "fixed" looks like

The next preview build of the witness Worker goes green. Production is
untouched throughout: same namespace id, same code, same secret.
