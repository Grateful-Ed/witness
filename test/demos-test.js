/* demos-test.js — the demos hub (William, 2026-11-04): every demo we
   have made gets its own separate link on demos.html, and the WMS
   console links to the hub. Static checks over the shipped files. */
'use strict';
var fs = require('fs');
var failures = 0, passes = 0;
function check(name, cond) { if (cond) { passes++; console.log('PASS  ' + name); } else { failures++; console.log('FAIL  ' + name); } }
var demos = fs.readFileSync(__dirname + '/../demos.html', 'utf8');
var wms = fs.readFileSync(__dirname + '/../wms.html', 'utf8');
check('demos: the hub page exists and names itself', /Witness — Demos/.test(demos));
[['the cross-check', 'href="index.html"'], ['Walk the Shift (practice copy, Receiving)', 'href="wms.html?practice=1#/receiving"'],
 ['the WMS console', 'href="wms.html"'], ['the warehouse glasses', 'href="glasses.html"'],
 ['the kitchen glasses', 'href="glasses.html?world=kitchen"'], ['the desk record', 'href="warehouse.html"']
].forEach(function (pair) { check('demos: ' + pair[0] + ' has its own link', demos.indexOf(pair[1]) !== -1); });
check('demos: the kitchen card says any receipt works', /any grocery receipt/.test(demos));
check('wms: the console topbar links to the demos hub', /href="demos\.html"/.test(wms));
console.log('---');
console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
