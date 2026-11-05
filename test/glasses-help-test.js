/* glasses-help-test.js — the glasses directions (William, 2026-11-04):
   people were confused how to work the demo. The help must exist for
   both worlds, name only real flows, stay isolated from the demo's
   machinery (the recorder.js rule), and load exactly once. */
'use strict';
var fs = require('fs');
var failures = 0, passes = 0;
function check(name, cond) { if (cond) { passes++; console.log('PASS  ' + name); } else { failures++; console.log('FAIL  ' + name); } }
var help = fs.readFileSync(__dirname + '/../js/glasses-help.js', 'utf8');
var html = fs.readFileSync(__dirname + '/../glasses.html', 'utf8');
check('help: glasses.html loads glasses-help.js exactly once', html.split('js/glasses-help.js').length - 1 === 1);
check('help: isolated — no fetch, no storage, no state writes', !/fetch\(|localStorage|Store\.|mutate|WMS|worker/.test(help));
check('help: the gestures are named', /Hold anywhere/.test(help) && /Double-tap/.test(help));
check('help: the warehouse work is explained (flags, person decides)', /flags where they disagree/.test(help) && /person decides/.test(help));
check('help: the kitchen names both intakes (receipt scan, spoken list)', /grocery receipt in view/.test(help) && /say what you have/.test(help));
check('help: the kitchen walk is explained (start word, done, voice correction)',
  /Start Groceries putaway/.test(help) && /Coffee goes in Cabinet B/.test(help));
check('help: the Record button is explained honestly (device-only, no overlay)', /nothing is uploaded/.test(help) && /screen recorder/.test(help));
check('help: world-aware (kitchen chosen from the same ?world=)', /world=kitchen/.test(help));
check('help: both entry points exist (start-screen button, in-view info button)', /How it works/.test(help) && /gh-info/.test(help));
check('help: the modal can be closed (X and backdrop)', /gh-x/.test(help) && /e\.target === modal/.test(help));
console.log('---');
console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
