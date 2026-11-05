/* =====================================================================
   glasses-help.js — the glasses view's directions, one tap away.

   William (2026-11-04): "add directions and how-to within the
   glasses demo, because people are confused how to actually work
   it." His standing info rule: an (i) button opens a dedicated
   layer — on a phone, a takeover window with an X — never an inline
   panel that shoves the view around.

   Deliberately isolated, on the js/recorder.js pattern: this file
   only builds DOM and opens/closes it. It never touches state,
   storage, the mic, the camera, or the talk pipeline — so it cannot
   break the demo it explains. The content names only flows that
   exist, in the world's own words, and picks warehouse or kitchen
   from the same ?world= the page itself uses.

   William (2026-11-05): "The directions doesn't really give good
   directions ... put them in the actual camera part with the
   glasses." So the kitchen view also carries a small steps card over
   the camera itself — the same four steps the help window shows. It
   watches #view from outside (its hidden attribute), sits in its own
   small box above the view, and never sits inside it: the rest of
   the view keeps hold-to-talk and double-tap while the card is up.
   ===================================================================== */
(function () {
  'use strict';

  var isKitchen = /[?&]world=kitchen\b/.test(window.location.search);

  var WAREHOUSE = [
    '<h3>The warehouse glasses</h3>',
    '<p class="gh-sub">The receiving dock, through the wearer\u2019s eyes.</p>',
    '<h4>Talking and photos</h4>',
    '<ul>',
    '<li><b>Hold anywhere</b> on the screen to talk. Let go when you\u2019re done.</li>',
    '<li><b>Double-tap</b> to take a photo of the pallet.</li>',
    '<li>Or say <b>\u201cHey Meta\u201d</b>, wait for the ding, then talk. (Needs Chrome or Safari.)</li>',
    '</ul>',
    '<h4>The work</h4>',
    '<ul>',
    '<li>Say what you see on the pallet \u2014 counts, labels, damage. META checks your words against the camera and the bill of lading, and flags where they disagree. The machine never signs off; a person decides.</li>',
    '<li>Ask anything out loud, any time. META answers from the record.</li>',
    '<li>Working tasks? Say <b>\u201cnext\u201d</b> for the next one and <b>\u201cdone\u201d</b> when it\u2019s finished.</li>',
    '</ul>'
  ].join('');

  /* The kitchen's four steps, verbatim from William (2026-11-05).
     One list, used by both the steps card and the help window. */
  var KITCHEN_STEPS = [
    'Take pic of receipt (double tap)',
    'Wait for tasks to be created',
    'Ask for tasks',
    'Say \u201cdone\u201d when a task is complete'
  ];
  function stepsList() {
    return '<ol class="gh-steps">' + KITCHEN_STEPS.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ol>';
  }

  var KITCHEN = [
    '<h3>The kitchen glasses</h3>',
    '<p class="gh-sub">Putting groceries away, hands-free.</p>',
    '<h4>Steps</h4>',
    stepsList()
  ].join('');

  var SHARED = [
    '<h4>Recording</h4>',
    '<ul>',
    '<li><b>\u25cf Record</b> (top right) records the camera and your voice, so you can watch the session back. It saves to this device; nothing is uploaded. It doesn\u2019t record the words on the screen \u2014 for that, use the phone\u2019s own screen recorder.</li>',
    '</ul>',
    '<h4>Good to know</h4>',
    '<ul>',
    '<li>The view needs camera and microphone permission.</li>',
    '<li>Say <b>\u201chide\u201d</b> to clear the words off the glass.</li>',
    '</ul>'
  ].join('');

  var CSS = [
    '.gh-modal{position:fixed;inset:0;z-index:10000;background:rgba(5,8,13,.72);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:22px 14px;}',
    '.gh-panel{background:#101826;color:#e8edf4;font:15px/1.55 system-ui,sans-serif;max-width:560px;width:100%;border:1px solid #2b3d55;border-radius:14px;padding:22px 22px 14px;position:relative;box-shadow:0 18px 50px rgba(0,0,0,.5);}',
    '.gh-panel h3{margin:0 30px 2px 0;font-size:21px;}',
    '.gh-sub{color:#8fb4d9;margin:0 0 14px;}',
    '.gh-panel h4{margin:16px 0 6px;font-size:13px;letter-spacing:.09em;text-transform:uppercase;color:#8fb4d9;}',
    '.gh-panel ul,.gh-panel ol{margin:0 0 6px;padding-left:19px;}',
    '.gh-panel li{margin:0 0 7px;}',
    '.gh-x{position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:50%;border:1px solid #3d5a7a;background:#1a2637;color:#fff;font-size:17px;cursor:pointer;}',
    '.gh-start-btn{display:block;margin:12px auto 2px;background:#24507e;color:#fff;border:0;border-radius:8px;padding:11px 22px;font:600 15px system-ui,sans-serif;cursor:pointer;}',
    /* The steps card: its own small box over the camera, above the view
       (z-index 1) and below the info button, Record and the window. */
    '.gh-card{position:fixed;top:64px;left:12px;z-index:50;width:min(280px,calc(100vw - 24px));box-sizing:border-box;background:rgba(10,16,26,.78);color:#fff;font:14px/1.45 system-ui,sans-serif;border:1px solid rgba(255,255,255,.35);border-radius:12px;padding:10px 40px 8px 12px;box-shadow:0 4px 16px rgba(0,0,0,.45);}',
    '.gh-card[hidden]{display:none;}',
    '.gh-card h4{margin:0 0 4px;font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#8fb4d9;}',
    '.gh-card ol{margin:0;padding-left:20px;}',
    '.gh-card li{margin:0 0 3px;}',
    '.gh-card .gh-x{top:6px;right:6px;width:30px;height:30px;font-size:14px;}',
    '.gh-info{position:fixed;top:12px;left:12px;z-index:60;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.45);background:rgba(10,16,26,.55);color:#fff;font-size:19px;cursor:pointer;}'
  ].join('');

  function build() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var modal = document.createElement('div');
    modal.className = 'gh-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'How the glasses work');
    modal.innerHTML = '<div class="gh-panel"><button type="button" class="gh-x" aria-label="Close">✕</button>' +
      (isKitchen ? KITCHEN : WAREHOUSE) + SHARED + '</div>';
    document.body.appendChild(modal);

    function open() { modal.hidden = false; }
    function close() { modal.hidden = true; }
    modal.querySelector('.gh-x').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

    /* On the start screen, a real button under Open the view — the
       confused moment is before entering, so the directions live
       there too. */
    var start = document.getElementById('start');
    if (start) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gh-start-btn';
      btn.textContent = 'How it works';
      btn.addEventListener('click', open);
      var openBtn = document.getElementById('openBtn');
      if (openBtn && openBtn.parentNode === start) start.insertBefore(btn, openBtn.nextSibling);
      else start.appendChild(btn);
    }

    /* In the view, a quiet (i) in the corner — help without leaving. */
    var info = document.createElement('button');
    info.type = 'button';
    info.className = 'gh-info';
    info.textContent = 'ⓘ';
    info.setAttribute('aria-label', 'How the glasses work');
    info.addEventListener('click', function () { reopenCard(); open(); });
    document.body.appendChild(info);

    /* In the kitchen view, the steps sit over the camera itself. The
       card lives on body, not inside #view, so its taps never reach
       the view's hold / double-tap listeners — and the view's own
       touches outside the card's box are untouched. It shows while the
       view is open, until its X; the (i) brings it back. */
    var view = document.getElementById('view');
    var card = null, dismissed = false;
    function syncCard() { if (card) card.hidden = dismissed || !view || view.hidden; }
    function reopenCard() { dismissed = false; syncCard(); }
    if (isKitchen) {
      card = document.createElement('div');
      card.className = 'gh-card';
      card.id = 'ghSteps';
      card.setAttribute('role', 'note');
      card.setAttribute('aria-label', 'Steps');
      card.innerHTML = '<button type="button" class="gh-x" aria-label="Close steps">✕</button><h4>Steps</h4>' + stepsList();
      card.querySelector('.gh-x').addEventListener('click', function () { dismissed = true; syncCard(); });
      document.body.appendChild(card);
      if (view && window.MutationObserver) new MutationObserver(syncCard).observe(view, { attributes: true, attributeFilter: ['hidden'] });
      syncCard();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
