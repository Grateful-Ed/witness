/* wms-ai-test.js — node, no dependencies.
   The WMS's Meta Model API calls (js/wms-ai.js) against a stubbed
   /chat: request shape (system prompt, image part, token ceiling),
   what is accepted, what is refused, and the honesty rules — a
   quote the receiver never said is dropped, a number the receiver
   never gave stays empty, a bin label that cannot be read is null.
   Run: node test/wms-ai-test.js   (exit 0 = all pass) */
'use strict';

var AI = require('../js/wms-ai.js');
var B = require('../js/bol.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }

function stub(replies) {
  var calls = [];
  var fn = function (url, init) {
    calls.push({ url: url, init: init, body: JSON.parse(init.body) });
    var r = replies.shift();
    if (r && r.status) return Promise.resolve({ ok: false, status: r.status, json: function () { return Promise.resolve({}); } });
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: typeof r === 'string' ? r : JSON.stringify(r) } }] }); } });
  };
  fn.calls = calls;
  return fn;
}

var EXP = [{ desc: 'Laundry detergent — cases', expected: 120 }, { desc: 'Paper towels — cases', expected: 120 }];
var SAID = 'Detergent, four pallets, a hundred sixteen cases, four of them crushed. Towels all there.';

(async function () {
  /* 1. receiving */
  var f = stub([{ lines: [
    { line: 1, received: 116, damaged: 4, quote: 'a hundred sixteen cases, four of them crushed' },
    { line: 2, received: null, damaged: null, quote: 'Towels all there, I promise' }] }]);
  var r = await AI.readReceiving(f, SAID, EXP);
  var body = f.calls[0].body;
  check('receiving: goes to the Worker /chat', /\/chat$/.test(f.calls[0].url));
  check('receiving: system prompt + BOL lines + verbatim transcript sent', body.messages[0].content === AI.RECEIVE_PROMPT &&
    /1\. Laundry detergent — cases — BOL says 120/.test(body.messages[1].content) && body.messages[1].content.indexOf(SAID) !== -1);
  check('receiving: token ceiling is the house 6000', body.max_tokens === 6000);
  check('receiving: counts filled per BOL line', r.lines[0].received === 116 && r.lines[0].damaged === 4);
  check('receiving: a quote really in the transcript is kept verbatim', r.lines[0].quote === 'a hundred sixteen cases, four of them crushed');
  check('receiving: a quote NOT in the transcript is dropped (never shown as their words)', r.lines[1].quote === '');
  check('receiving: a number the receiver never gave stays empty', r.lines[1].received === null);
  f = stub(['not json at all', { lines: [{ line: 9, received: 5 }] }]);
  r = await AI.readReceiving(f, SAID, EXP);
  check('receiving: an unreadable reply is retried once; an out-of-range line is ignored', f.calls.length === 2 && r.lines.every(function (l) { return l.received === null; }));
  try { await AI.readReceiving(stub([]), '   ', EXP); check('receiving: empty transcript refused', false); }
  catch (e) { check('receiving: empty transcript refused before any call', /Nothing was heard/.test(e.userMessage)); }
  try { await AI.readReceiving(stub([{ status: 429 }]), SAID, EXP); check('receiving: 429 surfaces', false); }
  catch (e) { check('receiving: the daily cap (429) is an honest error, not a guess', e.code === 'cap'); }

  /* 2. flag label */
  f = stub([{ label: 'Forklift leaking oil.' }]);
  r = await AI.labelFlag(f, 'The forklift is leaking oil by B-03');
  check('label: words sent verbatim, short label back, trailing punctuation dropped', f.calls[0].body.messages[1].content.indexOf('The forklift is leaking oil by B-03') !== -1 && r.label === 'Forklift leaking oil');
  check('label: a long label is clipped to 8 words', AI.acceptLabel({ label: 'one two three four five six seven eight nine ten' }) === 'one two three four five six seven eight');
  check('label: an empty label is not accepted', AI.acceptLabel({ label: '  ' }) === null);

  /* 3. putaway photo */
  var IMG = 'data:image/jpeg;base64,AAAA';
  f = stub([{ bin_label: 'b 7', item: 'Paper towels', flags: [{ label: 'Leaning stack', detail: 'Top layer leans left.' }] }]);
  r = await AI.readPutaway(f, IMG);
  var parts = f.calls[0].body.messages[1].content;
  check('putaway photo: sent as a data: image_url part', Array.isArray(parts) && parts[1].type === 'image_url' && parts[1].image_url.url === IMG);
  check('putaway photo: "b 7" normalised to B-07, flags kept', r.read.binLabel === 'B-07' && r.read.flags[0].label === 'Leaning stack');
  check('putaway photo: an unreadable label stays null (never guessed)', AI.acceptPutaway({ bin_label: null, flags: [] }).binLabel === null &&
    AI.acceptPutaway({ bin_label: 'D-12' }).binLabel === null);
  check('putaway photo: the request uses bol.js readBody (reused, not forked)', f.calls[0].init.body === B.readBody(IMG, AI.PUTAWAY_PROMPT, 'Read the bin label and the freight in this photo and return the JSON.'));

  /* 4. dock photo */
  f = stub([{ flags: [{ label: 'Crushed cartons', detail: 'Front left corner crushed.' }, { label: '', detail: 'x' }] }]);
  r = await AI.readDock(f, IMG);
  check('dock photo: flags read; an unlabeled flag is dropped', r.flags.length === 1 && r.flags[0].label === 'Crushed cartons');
  check('dock photo: a reply without a flags list is refused', AI.acceptDock({ nope: 1 }) === null);
  try { await AI.readDock(stub([{ status: 413 }]), IMG); check('dock photo: 413', false); }
  catch (e) { check('dock photo: 413 explains the photo was too large', e.code === 'too-large'); }

  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
