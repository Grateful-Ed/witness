/* converse-model-stub.js — shared by the page smokes (not a test file
   itself: the glob runs *-test.js only).

   The converse model step (2026-11-06): every worker turn on the
   glasses, the phone and the warehouse page is read by the model first
   (js/wms-ai.js converseTurn, through the Worker's /chat). The smokes
   stub /chat; this answers the converse envelope the way a sensible
   model would for the plain phrases the smokes speak, so the pages'
   own adjudication (model reading vs matchIntent) is what is under
   test — not this stub.

   isConverse(body)   → true when a /chat body is the converse read
   converseReply(body) → the model's reply text: {"intent", "startText"} */
'use strict';

function userText(b) {
  var u = b && b.messages && b.messages[1] ? b.messages[1].content : '';
  if (Array.isArray(u)) u = u.map(function (p) { return (p && p.text) || ''; }).join('');
  return String(u || '');
}

function isConverse(b) {
  var sys = b && b.messages && b.messages[0] ? String(b.messages[0].content || '') : '';
  return /You read what a warehouse worker said/.test(sys);
}

function converseReply(b) {
  var u = userText(b);
  var words = (u.split('THE WORKER SAID (verbatim):\n')[1] || '').toLowerCase().trim();
  var waiting = /A question is waiting/.test(u);
  var intent = 'unknown', startText = '';
  if (/torn|damaged|problem|crushed|broken|spill/.test(words)) intent = 'problem';
  else if (waiting && /^(yes|yeah|yep|go ahead)\b/.test(words)) intent = 'confirm';
  else if (waiting && /^(no|nope|wait|cancel)\b/.test(words)) intent = 'deny';
  else if (/\b(done|finished)\b/.test(words)) intent = 'done';
  else if (/^(start|begin)\b/.test(words)) { intent = 'start'; startText = words.replace(/^(start|begin)\b\s*/, ''); }
  else if (/next|what do i do/.test(words)) intent = 'next';
  return JSON.stringify({ intent: intent, startText: startText });
}

module.exports = { isConverse: isConverse, converseReply: converseReply };
