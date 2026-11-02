/* =====================================================================
   kitchen.js — the kitchen world's receipt intake. Pure: no DOM, no
   network of its own. Browser: window.WitnessKitchen. Node:
   module.exports, so test/kitchen-test.js runs exactly this code.

   William's scan model (2026-11-01): in the kitchen there is no back
   office, so the receipt scan IS the intake. The read lists the items,
   each item gets its spot by rule, and the shipment and its putaway
   tasks are created in one flow — no manual entry, no confirmation
   gate. A wrong spot is corrected by voice afterwards ("coffee goes in
   Cabinet B"), and the correction is logged on the record.

   The read itself is js/bol.js's structured read, reused, never
   forked: this file supplies only the receipt prompt and the receipt
   shape. bol.js is handed in (B) so node tests can stub it.

   Honest failures: an unreadable receipt creates nothing; lines the
   read could not make out are listed as "not read" — never guessed,
   never silently dropped.
   ===================================================================== */
(function (root) {
  'use strict';

  var COUNTER = 'Counter';
  var RUN_DESC = 'Grocery run';

  /* Receipt photos need more pixels than a pallet frame: small print.
     Sent at up to 1600px, stepping down until the body fits the cap.
     The cap is the /chat image cap from the desk-phone brief Step 1
     (1,500,000 chars for a request with a data: image). */
  var RECEIPT_STEPS = [
    { max: 1600, quality: 0.8 },
    { max: 1280, quality: 0.75 },
    { max: 1024, quality: 0.7 },
    { max: 800, quality: 0.65 }
  ];
  var RECEIPT_CAP = 1500000;

  /* The words the read may use for an item's type. Same list as the
     kitchen world's metaTypes. */
  var META_TYPES = ['frozen', 'refrigerated', 'produce', 'dry-goods', 'bakery-snacks-coffee', 'household'];

  var RECEIPT_PROMPT = [
    'You read ONE photo of a paper grocery store receipt. List every purchased item line on it.',
    '',
    'Return ONLY a JSON object in exactly this shape, no prose, no code fences:',
    '{"receipt":true,"items":[{"printed":"...","name":"...","qty":1,"type":"..."}],"not_read":["..."]}',
    '',
    '- "printed": the item text exactly as printed on that line.',
    '- "name": the plain product name in everyday words (expand obvious store abbreviations, e.g. "GV 2% MLK GAL" -> "2% milk"). If you cannot tell what the product is, repeat "printed" — never guess.',
    '- "qty": the quantity as printed for that line. If no quantity is printed, 1. A weighed item (priced by lb or kg) is 1.',
    '- "type": one of ' + META_TYPES.map(function (t) { return '"' + t + '"'; }).join(', ') + ', or "unknown". Decide from the product name: frozen anything = frozen; dairy, eggs, deli, fresh meat, juice = refrigerated; fresh fruit and vegetables = produce; pasta, rice, cereal, cans, jars, baking = dry-goods; bread, bakery, snacks, coffee, tea = bakery-snacks-coffee; cleaning, paper goods, household = household.',
    '- "not_read": every item line you can see but cannot read, described plainly (for example "line 5 — smudged, price $3.49"). Empty list when everything was read.',
    '',
    'Skip lines that are not items: store name and address, totals, subtotal, tax, payment, change, coupons, discounts, savings, loyalty, barcodes.',
    'If the photo is not a receipt, or no item line is legible, return {"receipt":false,"items":[],"not_read":["what you see instead, in a few words"]}.'
  ].join('\n');
  var RECEIPT_ASK = 'Read this receipt and return the JSON.';

  /* ---------- names & rules ------------------------------------------ */

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[’‘]/g, "'")
      .replace(/[^a-z0-9%' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /* Whole-word (or whole-phrase) match. */
  function hasPhrase(text, phrase) {
    var t = ' ' + norm(text) + ' ', p = norm(phrase);
    return !!p && t.indexOf(' ' + p + ' ') !== -1;
  }

  /* The spot for one item: exact item rule first, product-type rule
     second, META's type from the read third. Returns
     { spot, source, rule } — source is 'item rule', 'type rule',
     'META' or null (nothing decided: the engine's emptiest-spot rule
     will pick, and the read-back says so). */
  function spotFor(rules, name, metaType) {
    rules = rules || {};
    var i, j;
    var exact = rules.exact || [];
    for (i = 0; i < exact.length; i++) {
      if (hasPhrase(name, exact[i].match)) return { spot: exact[i].spot, source: 'item rule', rule: exact[i].match };
    }
    var types = rules.types || [];
    for (i = 0; i < types.length; i++) {
      for (j = 0; j < types[i].words.length; j++) {
        if (hasPhrase(name, types[i].words[j])) return { spot: types[i].spot, source: 'type rule', rule: types[i].type };
      }
    }
    var mt = rules.metaTypes || {};
    var t = norm(metaType).replace(/ /g, '-');
    if (t && Object.prototype.hasOwnProperty.call(mt, t)) return { spot: mt[t], source: 'META', rule: t };
    return { spot: null, source: null, rule: null };
  }

  /* ---------- the read (bol.js's machinery, receipt prompt) ---------- */

  function receiptBody(B, dataUrl) {
    return B.readBody(dataUrl, RECEIPT_PROMPT, RECEIPT_ASK);
  }

  /* The parsed JSON → a clean receipt. Never invents an item: a line
     with no name and nothing printed is dropped into not_read. */
  function parseReceipt(parsed) {
    var out = { ok: false, items: [], notRead: [], reason: null };
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      out.reason = 'The read did not come back in the receipt shape.';
      return out;
    }
    (Array.isArray(parsed.not_read) ? parsed.not_read : []).forEach(function (n) {
      var s = typeof n === 'string' ? n.trim() : '';
      if (s) out.notRead.push(s);
    });
    (Array.isArray(parsed.items) ? parsed.items : []).forEach(function (it, k) {
      if (!it || typeof it !== 'object') return;
      var printed = typeof it.printed === 'string' ? it.printed.trim() : '';
      var name = typeof it.name === 'string' ? it.name.trim() : '';
      if (!name) name = printed;
      if (!name) { out.notRead.push('item ' + (k + 1) + ' — no name came back'); return; }
      var q = Number(it.qty);
      var qty = (isFinite(q) && q >= 1) ? Math.round(q) : 1;
      var type = typeof it.type === 'string' ? norm(it.type).replace(/ /g, '-') : '';
      out.items.push({ name: name, printed: printed || name, qty: qty, metaType: META_TYPES.indexOf(type) !== -1 ? type : null });
    });
    if (parsed.receipt === false && !out.items.length) {
      out.reason = 'That doesn\'t look like a readable receipt' + (out.notRead.length ? ' — ' + out.notRead.join('; ') : '') + '.';
      return out;
    }
    if (!out.items.length) {
      out.reason = 'No item lines could be read on that receipt.';
      return out;
    }
    out.ok = true;
    return out;
  }

  /* Send the receipt read through bol.js and parse it. Resolves to
     parseReceipt's result; rejects with bol.js's honest error. */
  /* The receipt shape, for bol.js's sendRead: an items list, or an
     honest receipt:false. Anything else is the wrong shape (null), which
     earns bol.js's one retry. */
  function acceptReceipt(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return (Array.isArray(parsed.items) || parsed.receipt === false) ? parsed : null;
  }

  function readReceipt(B, doFetch, url, body) {
    return B.sendRead(doFetch, url, body, acceptReceipt).then(function (res) {
      return parseReceipt(res ? res.value : null);
    });
  }

  /* ---------- the intake: the scan creates the work ------------------- */

  function isKitchen(state) { return !!state && state.world === 'kitchen'; }

  /* Before any shipment exists, a capture in the kitchen is a receipt
     read. After, it is the ordinary photo scan. */
  function isIntakeMode(state) {
    return isKitchen(state) && (!state.inbound || state.inbound.length === 0);
  }

  function binExists(state, id) {
    return state.bins.some(function (b) { return b.id === id; });
  }

  function unitName(state, id) {
    var u = null;
    state.labor.forEach(function (x) { if (x.id === id) u = x; });
    return u ? u.name : 'the scan';
  }

  function record(state, text, extra) {
    var r = { ts: new Date().toISOString(), text: text };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    state.records.push(r);
    return r;
  }

  /* One flow: assign spots, create the Grocery run at the Counter,
     receive it (each item becomes a staged item with its home spot),
     and let the engine's task generation make one putaway task per
     item. E is the engine. Returns { ok, reason, shipmentId, created,
     notRead } — created is item → spot, task by task. Creates nothing
     when the receipt has no items. */
  function createRun(E, state, receipt, byUnit) {
    if (!receipt || !receipt.ok || !receipt.items.length) {
      return { ok: false, reason: (receipt && receipt.reason) || 'Nothing read — nothing created.', created: [], notRead: (receipt && receipt.notRead) || [] };
    }
    if (!isIntakeMode(state)) {
      return { ok: false, reason: 'A grocery run already exists — reset the kitchen to scan a new receipt.', created: [], notRead: receipt.notRead };
    }
    var rules = state.destinationRules || {};
    var id = 'RUN-1';
    var lines = [], staged = [];
    receipt.items.forEach(function (it, k) {
      var s = spotFor(rules, it.name + ' ' + it.printed, it.metaType);
      var spot = s.spot && binExists(state, s.spot) ? s.spot : null;
      lines.push({ desc: it.name, printed: it.printed, pallets: 1, perPallet: it.qty, home: spot, spotSource: spot ? s.source : null });
      staged.push({ id: 'STG-' + id + '-' + (k + 1), door: COUNTER, desc: it.name, qty: it.qty, shipmentId: id, home: spot, spotSource: spot ? s.source : null });
    });
    state.inbound.push({
      id: id, door: COUNTER, desc: RUN_DESC + ' — receipt scan', pallets: lines.length,
      status: 'received', intake: 'receipt-scan', lines: lines, notRead: receipt.notRead.slice()
    });
    staged.forEach(function (p) { state.staging.push(p); });
    var door = null;
    state.doors.forEach(function (d) { if (d.id === COUNTER) door = d; });
    if (door) door.state = 'staged';
    record(state, 'Receipt scanned by ' + unitName(state, byUnit) + ' — ' + RUN_DESC + ' (' + id + ') created at the ' + COUNTER +
      ': ' + lines.length + ' item' + (lines.length === 1 ? '' : 's') + ' received' +
      (receipt.notRead.length ? '; not read: ' + receipt.notRead.join('; ') : '') + '.',
      { kind: 'arrive', shipmentId: id, by: byUnit || null, intake: 'receipt-scan' });
    E.generateTasks(state);
    var created = staged.map(function (p) {
      var t = E.taskById(state, 't-putaway-' + p.id);
      if (t) t.item = p.desc;
      return { item: p.desc, qty: p.qty, spot: t ? t.toBinId : null, source: p.spotSource, taskId: t ? t.id : null };
    });
    return { ok: true, reason: null, shipmentId: id, created: created, notRead: receipt.notRead.slice() };
  }

  /* What META says after the intake: item → spot, task by task. */
  function intakeLines(res) {
    if (!res.ok) return [res.reason];
    var parts = res.created.map(function (c) {
      return (c.qty > 1 ? c.qty + ' × ' : '') + c.item + ' → ' + (c.spot || 'no spot') + (c.source === 'META' ? ' (META)' : c.source ? '' : ' (emptiest spot — no rule)');
    });
    var out = ['Grocery run created — ' + res.created.length + ' putaway task' + (res.created.length === 1 ? '' : 's') + ': ' + parts.join('; ') + '.'];
    if (res.notRead.length) out.push('Not read: ' + res.notRead.join('; ') + '.');
    return out;
  }

  /* ---------- voice correction: "coffee goes in Cabinet B" ------------ */

  var SPOT_WORDS = [
    { re: /^(the )?cabinet (a|ay|eh|one|1)$/, spot: 'Cabinet A' },
    { re: /^(the )?cabinet (b|bee|be|two|2)$/, spot: 'Cabinet B' },
    { re: /^(the )?pantry$/, spot: 'Pantry' },
    { re: /^(the )?(fridge|refrigerator|frig)$/, spot: 'Fridge' },
    { re: /^(the )?freezer$/, spot: 'Freezer' }
  ];
  function spotFromWords(w) {
    w = norm(w).replace(/ (please|instead|actually)$/, '').trim();
    for (var i = 0; i < SPOT_WORDS.length; i++) if (SPOT_WORDS[i].re.test(w)) return SPOT_WORDS[i].spot;
    return null;
  }

  /* A spoken correction → { item, spot } or null. Strict: the spot has
     to be one of the kitchen's spots, or it is not a correction. */
  function parseCorrection(text) {
    var t = norm(text).replace(/^(hey |ok |okay )?(muse |meta )?/, '').replace(/^(no |actually |wait )+/, '');
    var m = /^(?:the )?(.+?) (?:goes|go|belongs|belong|should go|needs to go|lives|live|should be|is) (?:in|into|to|on|in the) (.+)$/.exec(t) ||
            /^(?:put|move|store) (?:the )?(.+?) (?:in|into|to|on) (.+)$/.exec(t);
    if (!m) return null;
    var spot = spotFromWords(m[2]);
    var item = m[1].replace(/^the /, '').trim();
    if (!spot || !item) return null;
    return { item: item, spot: spot };
  }

  function stem(w) { return w.length > 3 ? w.replace(/(es|s)$/, '') : w; }
  function itemMatches(desc, said) {
    var d = norm(desc).split(' ').map(stem), s = norm(said).split(' ').map(stem);
    return s.length > 0 && s.every(function (w) { return d.indexOf(w) !== -1; });
  }

  /* Retarget the item's putaway task and log the correction on the
     task and the record. Returns { ok, lines }. */
  function applyCorrection(E, state, corr, byUnit, said) {
    if (!corr) return { ok: false, lines: ['Not a correction.'] };
    var hits = state.tasks.filter(function (t) {
      return t.type === 'putaway' && itemMatches(t.item || t.title.replace(/^Put away \d+ × /, ''), corr.item);
    });
    if (!hits.length) return { ok: false, lines: ['No "' + corr.item + '" on this run. Nothing changed.'] };
    var live = hits.filter(function (t) { return t.status !== 'done'; });
    if (!live.length) {
      return { ok: false, lines: [(hits[0].item || corr.item) + ' is already put away in ' + hits[0].toBinId + '. Nothing changed.'] };
    }
    if (live.length > 1) {
      return { ok: false, lines: ['More than one item matches "' + corr.item + '": ' + live.map(function (t) { return t.item; }).join(', ') + '. Say the full name.'] };
    }
    var task = live[0];
    var bin = E.binById(state, corr.spot);
    if (!bin) return { ok: false, lines: ['There is no ' + corr.spot + ' here. Nothing changed.'] };
    if (bin.status === 'hold') return { ok: false, lines: [corr.spot + ' is on hold. Nothing changed.'] };
    var from = task.toBinId;
    var name = task.item || corr.item;
    if (from === corr.spot) return { ok: true, lines: [name + ' already goes to ' + corr.spot + '.'] };
    task.toBinId = corr.spot;
    task.detail = 'Staged at ' + COUNTER + ' — suggested bin ' + corr.spot + ' (corrected by voice from ' + (from || 'no spot') + ')';
    var p = null;
    state.staging.forEach(function (x) { if (x.id === task.stagingId) p = x; });
    if (p) { p.home = corr.spot; p.spotSource = 'voice correction'; }
    var ts = new Date().toISOString();
    var text = 'Spot corrected by voice: ' + name + ' ' + (from || 'no spot') + ' → ' + corr.spot +
      (said ? ' (said: "' + String(said).trim() + '")' : '') + '.';
    task.notes = task.notes || [];
    task.notes.push({ ts: ts, by: byUnit || null, text: text });
    record(state, text + ' By ' + unitName(state, byUnit) + '.', { kind: 'correction', taskId: task.id, zone: task.zone, by: byUnit || null });
    return { ok: true, lines: [name + ' now goes to ' + corr.spot + '.'] };
  }

  var api = {
    COUNTER: COUNTER, RUN_DESC: RUN_DESC, RECEIPT_STEPS: RECEIPT_STEPS, RECEIPT_CAP: RECEIPT_CAP,
    META_TYPES: META_TYPES, RECEIPT_PROMPT: RECEIPT_PROMPT,
    spotFor: spotFor, receiptBody: receiptBody, parseReceipt: parseReceipt, acceptReceipt: acceptReceipt, readReceipt: readReceipt,
    isKitchen: isKitchen, isIntakeMode: isIntakeMode, createRun: createRun, intakeLines: intakeLines,
    parseCorrection: parseCorrection, applyCorrection: applyCorrection
  };

  root.WitnessKitchen = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
