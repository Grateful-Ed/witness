/* photo-data-url-test.js — node, no dependencies.
   The photo scan sends the contact sheet as a data URL, never its
   public URL (briefs/claude-brief-photo-scan-data-url.md). The /chat
   service refuses hosted image URLs (media_url_not_fetchable), so a
   URL in the request is the broken path.
   askPhoto is private to js/photo.js; this test lifts its exact source
   out of the file and runs it against stubbed sheetDataUrl / chat.
   Run: node test/photo-data-url-test.js   (exit 0 = all pass) */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}

var SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo.js'), 'utf8');

/* Lift `function askPhoto(...) { ... }` by brace matching. */
function liftFunction(src, name) {
  var start = src.indexOf('function ' + name + '(');
  if (start === -1) return null;
  var open = src.indexOf('{', start);
  var depth = 0;
  for (var i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

var ASK = liftFunction(SRC, 'askPhoto');
check('askPhoto is found in js/photo.js', !!ASK);
check('askPhoto no longer sends SHEETS[loadKey] as the image URL', !/url:\s*SHEETS\[/.test(ASK || ''));
check('askPhoto resolves sheetDataUrl first', /sheetDataUrl\(loadKey\)/.test(ASK || ''));

var DATA = 'data:image/jpeg;base64,/9j/AAAA';
var GOOD = { flags: [{ label: 'Torn wrap', side: 'FRONT', detail: 'wrap torn at the front' }] };

function harness(dataUrl, reply) {
  var sent = [];
  var ctx = {
    PHOTO_PROMPT: 'PROMPT',
    SHEETS: { a: 'https://grateful-ed.github.io/witness/img/a.webp', b: 'https://grateful-ed.github.io/witness/img/b.webp' },
    sheetDataUrl: function (k) { sent.push({ dataFor: k }); return Promise.resolve(dataUrl); },
    chat: function (messages, what, maxTokens) {
      sent.push({ messages: messages, what: what, maxTokens: maxTokens });
      return Promise.resolve(reply);
    },
    normalisePhotoFlags: function (p) {
      return p && Array.isArray(p.flags) ? p.flags.map(function (f) {
        return { label: f.label, side: f.side.toLowerCase(), detail: f.detail };
      }) : null;
    }
  };
  vm.createContext(ctx);
  vm.runInContext(ASK + '\nthis.askPhoto = askPhoto;', ctx);
  return { askPhoto: ctx.askPhoto, sent: sent };
}

(async function () {
  /* --- data URL goes out, flags come back ---------------------------- */
  var h = harness(DATA, GOOD);
  var flags = await h.askPhoto('b');
  var call = h.sent.filter(function (s) { return s.messages; })[0];
  check('sheetDataUrl is asked for load b', h.sent[0] && h.sent[0].dataFor === 'b');
  check('exactly one /chat call', h.sent.filter(function (s) { return s.messages; }).length === 1);
  var img = call && call.messages[1].content[1];
  check('the image part is image_url', img && img.type === 'image_url');
  check('the image URL is the data URL', img && img.image_url.url === DATA);
  check('the image URL is not an http(s) URL', img && !/^https?:/i.test(img.image_url.url));
  check('system prompt unchanged', call && call.messages[0].role === 'system' && call.messages[0].content === 'PROMPT');
  check('user text unchanged', call && call.messages[1].content[0].text === 'Read this load\'s four sides and return the flags JSON.');
  check('label and token budget unchanged', call && call.what === 'photo scan' && call.maxTokens === 6000);
  check('flags returned through normalisePhotoFlags', Array.isArray(flags) && flags.length === 1 && flags[0].side === 'front');

  /* --- null data URL: honest error, no fallback to the URL ----------- */
  h = harness(null, GOOD);
  var err = null;
  try { await h.askPhoto('a'); } catch (e) { err = e; }
  check('a null data URL rejects', !!err);
  check('the rejection carries a userMessage', !!(err && err.userMessage));
  check('the userMessage says the photo could not be prepared', !!(err && /could not be prepared for the scan/.test(err.userMessage)));
  check('no /chat call is made when the sheet cannot be encoded', h.sent.filter(function (s) { return s.messages; }).length === 0);

  /* --- unparseable path unchanged ------------------------------------ */
  h = harness(DATA, { nope: true });
  err = null;
  try { await h.askPhoto('a'); } catch (e) { err = e; }
  check('a non-flags reply still throws the flags-shape error',
    !!(err && err.userMessage === 'The photo scan answered, but not in the flags shape this page can read.'));

  console.log(failures ? '\n' + failures + ' FAILED' : '\nall pass');
  process.exit(failures ? 1 : 0);
})();
