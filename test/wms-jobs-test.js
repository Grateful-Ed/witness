/* wms-jobs-test.js — node, no dependencies.
   Job-based assignment (briefs/claude-brief-job-assignment.md, step 2
   of the assignment build). The acceptance list, in the brief's order:
     - assignment by department (a picking job never lands on an
       inbound-only unit);
     - exclusivity (a held job's tasks are unreachable for anyone else,
       including nextFor-style reads and voice's assigned list);
     - auto-assign on job completion (the finisher holds the next pool
       job at once, deterministically);
     - pools drain OLDEST JOB FIRST (job createdAt, then job sequence);
     - manager reassign (remaining tasks move, the record attributes the
       move, completed tasks keep their doer; voice can never call it);
     - the seed invariants: FLG-001/002 stand, and the Zone B bottleneck
       proposal still fires — reading JOB load;
     - the game never gets jobs and keeps its pull (the full game
       session with the live state byte-identical is in
       test/game-data-split-test.js).
   Run: node test/wms-jobs-test.js   (exit 0 = all pass) */
'use strict';

var fs = require('fs');
var path = require('path');
var E = require('../js/engine.js');
var W = require('../js/wms.js');
var V = require('../js/wms-voice.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }

var t0 = Date.parse('2026-11-05T08:00:00Z'), tick = 0;
W.now = function () { return new Date(t0 + 60000 * (tick++)).toISOString(); };

function fresh() { return W.seed(); }
function task(s, id) { return E.taskById(s, id); }
function unit(s, id) { return E.unitById(s, id); }
function owners(s) { var o = {}; s.wms.jobs.forEach(function (j) { if (j.status === 'open') o[j.id] = j.owner; }); return o; }
function workers(s) { return s.labor.filter(function (u) { return u.role === 'worker'; }); }
/* The holder works a job through to its end, one task at a time. */
function finishJob(s, uid, jobId) {
  for (var n = 0; n < 20 && W.job(s, jobId).status === 'open'; n++) {
    var nx = W.nextFor(s, uid);
    if (!nx.task || nx.task.jobId !== jobId) break;
    W.complete(s, nx.task.id, { by: uid });
  }
  return W.job(s, jobId).status === 'done';
}

/* Every rule that must hold on ANY state: each open held job sits with
   a unit of its department; each open task of a held job is in its
   holder's hands or queued for them; no pool task is queued for
   anyone. */
function lawHolds(s) {
  return s.wms.jobs.every(function (j) {
    if (j.status !== 'open') return true;
    if (j.owner) {
      var u = unit(s, j.owner);
      if (!u || u.depts.indexOf(j.dept) === -1) return false;
    }
    return W.jobTasks(s, j.id).every(function (t) {
      if (t.status === 'done') return true;
      if (!j.owner) return !t.queuedFor && !t.assignee;
      return t.status === 'assigned' ? t.assignee === j.owner : t.queuedFor === j.owner;
    });
  });
}

/* Work the whole building the way the floor does: each worker takes
   the next task of their own job and closes it. Receiving is posted at
   the desk (a human-signed act). Returns the number of completions. */
function workShift(s, maxRounds) {
  var done = 0;
  for (var round = 0; round < (maxRounds || 60); round++) {
    var moved = false;
    workers(s).forEach(function (u) {
      var n = W.nextFor(s, u.id);
      if (!n.task) return;
      var t = n.task;
      if (t.type === 'receive') {
        var sh = E.shipmentById(s, t.shipmentId);
        var lines = W.expectedLines(sh).map(function (l) { return { desc: l.desc, received: l.expected, damaged: 0 }; });
        var rr = W.receive(s, sh.id, lines, { by: u.id });
        if (rr.ok) { done++; moved = true; }
        return;
      }
      var r = W.complete(s, t.id, { by: u.id });
      if (r.ok) { done++; moved = true; }
    });
    if (!moved) break;
  }
  return done;
}

/* ================= departments ======================================== */
var s = fresh();
check('departments: every worker works at least one department; managers work none',
  workers(s).every(function (u) { return Array.isArray(u.depts) && u.depts.length > 0; }) &&
  s.labor.filter(function (u) { return u.role === 'manager'; }).every(function (u) { return u.depts.length === 0; }));
check('departments: the six areas of the building, each labelled',
  W.DEPTS.map(function (d) { return d.id; }).join(',') === 'inbound,putaway,replen,picking,packship,count' &&
  W.deptLabel('packship') === 'Pack & Ship' && W.deptLabel('replen') === 'Replenishment');
check('jobs: every seeded shipment, order and staged pallet is a job (17 jobs on the seed)',
  s.wms.jobs.length === 17 && !!W.job(s, 'J-IN-1001') && !!W.job(s, 'J-ORD-501') && !!W.job(s, 'J-ORD-502') &&
  !!W.job(s, 'J-ORD-503') && !!W.job(s, 'J-STG-1') && !!W.job(s, 'J-STG-8'));
check('jobs: every task belongs to a job', s.tasks.every(function (t) { return !!t.jobId && !!W.job(s, t.jobId); }));
check('jobs: an order\'s picks are one job; a shipment\'s receive is its job',
  task(s, 't-pick-ORD-501-B-04').jobId === 'J-ORD-501' && task(s, 't-pick-ORD-501-A-08').jobId === 'J-ORD-501' &&
  task(s, 't-receive-IN-1001').jobId === 'J-IN-1001');
check('jobs: department read from the job\'s first task (receive → Inbound, pick → Picking, staged pallet → Putaway, consolidation → Replenishment)',
  W.job(s, 'J-IN-1001').dept === 'inbound' && W.job(s, 'J-ORD-501').dept === 'picking' &&
  W.job(s, 'J-STG-1').dept === 'putaway' && W.job(s, 'J-breakdown-A-06').dept === 'replen');
check('assignment by department: on the seed, every held job sits with a unit of its department', lawHolds(s));
check('assignment by department: no picking job is held by Marcus (Inbound only)',
  !s.wms.jobs.some(function (j) { return j.dept === 'picking' && j.owner === 'u-marcus'; }));
var r = W.reassignJob(s, 'J-ORD-503', 'u-marcus', 'u-sam');
check('assignment by department: a manager cannot land a picking job on an inbound-only unit either',
  !r.ok && /does not work Picking/.test(r.reason) && !W.job(s, 'J-ORD-503').owner);
var shift = fresh();
W.releaseWave(shift, ['ORD-601', 'ORD-602', 'ORD-603', 'ORD-604', 'ORD-605'], 'u-sam');
W.checkIn(shift, 'APT-102', 'u-sam');
var allOk = true, rounds = 0;
for (var k = 0; k < 40; k++) { rounds++; if (!workShift(shift, 1)) break; if (!lawHolds(shift)) allOk = false; }
check('assignment by department: holds at every step of a worked shift (' + rounds + ' rounds, waves + a receipt)', allOk && lawHolds(shift));
check('the worked shift really ran: orders shipped to the door, IN-1002 received and put away',
  shift.tasks.filter(function (t) { return t.status === 'done'; }).length > 30 &&
  W.job(shift, 'J-IN-1002').status === 'done' && W.job(shift, 'J-ORD-501').status === 'done');

/* ================= the seed deal ===================================== */
s = fresh();
var o = owners(s);
check('seed deal: Marcus holds IN-1001, Dee STG-1, Tommy STG-2, Chris + Rosa the two oldest consolidations, Priya ORD-501, Grace ORD-502',
  o['J-IN-1001'] === 'u-marcus' && o['J-STG-1'] === 'u-dee' && o['J-STG-2'] === 'u-tommy' &&
  o['J-consolidate-Flour-bags'] === 'u-chris' && o['J-consolidate-Tomato-sauce-cases'] === 'u-rosa' &&
  o['J-ORD-501'] === 'u-priya' && o['J-ORD-502'] === 'u-grace');
check('seed deal: the rest sit in their pools — Putaway 6, Replenishment 3, Picking 1 (ORD-503)',
  W.pool(s, 'putaway').length === 6 && W.pool(s, 'replen').length === 3 &&
  W.pool(s, 'picking').length === 1 && W.pool(s, 'picking')[0].id === 'J-ORD-503' && W.pool(s, 'inbound').length === 0);
check('seed deal: Jay (Pack & Ship, Cycle Count) holds nothing — both his pools are empty', W.jobsOf(s, 'u-jay').length === 0);
check('seed deal: deterministic — two fresh seeds deal the same', JSON.stringify(owners(fresh())) === JSON.stringify(owners(fresh())));
check('seed deal: assignment is the system\'s act — nothing in anyone\'s hands yet, no record written for it',
  workers(s).every(function (u) { return !u.currentTaskId; }) && !s.records.some(function (x) { return /assign/.test(x.kind || ''); }));

/* ================= exclusivity ======================================= */
s = fresh();
var held = W.jobTasks(s, 'J-ORD-501').map(function (t) { return t.id; });
var others = workers(s).filter(function (u) { return u.id !== 'u-priya'; });
check('exclusivity: ORD-501\'s tasks are queued for Priya and nobody else',
  W.jobTasks(s, 'J-ORD-501').every(function (t) { return t.queuedFor === 'u-priya'; }));
check('exclusivity: no other worker\'s queue lists them', others.every(function (u) {
  var q = W.queueFor(s, u.id);
  return q.queued.concat(q.suggested).every(function (t) { return held.indexOf(t.id) === -1; });
}));
check('exclusivity: voice\'s assigned list (context next-up) for every other worker leaves them out', others.every(function (u) {
  return V.context(s, u.id, null).nextUp.every(function (line) { return !/ORD-501/.test(line); });
}));
var got = others.map(function (u) { var n = W.nextFor(s, u.id); return n.task ? n.task.id : null; });
check('exclusivity: nextFor for every other worker never reaches them', got.every(function (id) { return held.indexOf(id) === -1; }));
check('exclusivity: nextFor never reaches a pool job either (ORD-503 stays unheld, untouched)',
  !W.job(s, 'J-ORD-503').owner && W.jobTasks(s, 'J-ORD-503').every(function (t) { return t.status === 'open' && !t.assignee && !t.queuedFor; }));
check('exclusivity: each worker\'s nextFor was their own job\'s task', others.every(function (u, i) {
  var id = got[i]; if (!id) return true; return W.jobOf(s, id).owner === u.id;
}));
r = W.reassign(s, 't-pick-ORD-501-A-08', 'u-grace', 'u-sam');
check('exclusivity: a single task cannot be handed to someone else (task-level reassign refused on the live building)',
  !r.ok && task(s, 't-pick-ORD-501-A-08').queuedFor === 'u-priya');
s = fresh();
W.hold(s, { binId: 'B-04' }, 'u-sam', 'recount');
check('exclusivity survives a hold: the blocked pick stays Priya\'s (queued, not dropped to the pool)',
  task(s, 't-pick-ORD-501-B-04').queuedFor === 'u-priya' && W.job(s, 'J-ORD-501').owner === 'u-priya');
check('a hold skips the blocked task: Priya\'s next is the other pick of her own job', W.nextFor(s, 'u-priya').task.id === 't-pick-ORD-501-A-08');

/* ================= auto-assign on job completion ===================== */
s = fresh();
W.nextFor(s, 'u-dee');
r = W.complete(s, 't-putaway-STG-1', { by: 'u-dee' });
check('auto-assign: Dee finishes STG-1 — the job closes', r.ok && W.job(s, 'J-STG-1').status === 'done');
check('auto-assign: Dee holds the next Putaway job at once — STG-3, the oldest in the pool', W.jobsOf(s, 'u-dee').map(function (j) { return j.id; }).join() === 'J-STG-3' &&
  task(s, 't-putaway-STG-3').queuedFor === 'u-dee');
check('auto-assign: no gap — her assigned list is not empty, and voice names it', /STG-3/.test(V.context(s, 'u-dee', null).nextUp[0] || ''));
check('auto-assign: the done task keeps its doer', task(s, 't-putaway-STG-1').doneBy === 'u-dee');
tick = 0; var sA = fresh(); W.nextFor(sA, 'u-dee'); W.complete(sA, 't-putaway-STG-1', { by: 'u-dee' });
tick = 0; var sB = fresh(); W.nextFor(sB, 'u-dee'); W.complete(sB, 't-putaway-STG-1', { by: 'u-dee' });
function dealOf(x) { return JSON.stringify([owners(x), x.tasks.map(function (t) { return t.id + '>' + (t.queuedFor || t.assignee || ''); })]); }
check('auto-assign: deterministic — the same finish deals the same jobs to the same hands', dealOf(sA) === dealOf(sB) && W.jobsOf(sA, 'u-dee')[0].id === 'J-STG-3');
/* a multi-task job does NOT close on its first task */
s = fresh();
W.nextFor(s, 'u-priya');
W.complete(s, 't-pick-ORD-501-B-04', { by: 'u-priya' });
check('a job with work left stays with its holder — Priya keeps ORD-501, nothing new is dealt',
  W.jobsOf(s, 'u-priya').map(function (j) { return j.id; }).join() === 'J-ORD-501' && task(s, 't-pick-ORD-501-A-08').queuedFor === 'u-priya');
/* a whole order job: pick → pack → load, all one holder, then the next */
W.nextFor(s, 'u-priya');
W.complete(s, 't-pick-ORD-501-A-08', { by: 'u-priya' });
check('an order job flows pick → pack → load on ONE holder: the pack is queued for Priya, ahead of the load',
  task(s, 't-pack-ORD-501').queuedFor === 'u-priya' && task(s, 't-load-ORD-501').queuedFor === 'u-priya' &&
  s.tasks.indexOf(task(s, 't-pack-ORD-501')) < s.tasks.indexOf(task(s, 't-load-ORD-501')));
check('voice reads her list in flow order: the pack first', /^Pack ORD-501/.test(V.context(s, 'u-priya', null).nextUp[0] || ''));
W.nextFor(s, 'u-priya'); W.complete(s, 't-pack-ORD-501', { by: 'u-priya' });
W.nextFor(s, 'u-priya'); r = W.complete(s, 't-load-ORD-501', { by: 'u-priya' });
check('the load closes the order job…', r.ok && W.job(s, 'J-ORD-501').status === 'done');
check('…and Priya is dealt the next Picking job at once — ORD-503', W.jobsOf(s, 'u-priya').map(function (j) { return j.id; }).join() === 'J-ORD-503');
/* a shipment job: receive → putaway, all one holder */
s = fresh();
W.receive(s, 'IN-1001', [{ desc: 'Canned peaches — cases', received: 240, damaged: 0 }], { by: 'u-marcus' });
var pa = s.tasks.filter(function (t) { return t.type === 'putaway' && t.jobId === 'J-IN-1001'; });
check('a shipment job flows receive → putaway on ONE holder: IN-1001\'s 6 putaways are Marcus\'s, not the Putaway pool\'s',
  pa.length === 6 && pa.every(function (t) { return t.queuedFor === 'u-marcus'; }) && W.job(s, 'J-IN-1001').status === 'open');
check('the receive keeps its doer', task(s, 't-receive-IN-1001').doneBy === 'u-marcus');

/* ================= pools drain oldest first ========================== */
s = fresh();
var order = [];
for (var i = 0; i < 6; i++) {
  var j = W.jobsOf(s, 'u-dee')[0];
  if (!j) break;
  order.push(j.id);
  finishJob(s, 'u-dee', j.id);
}
check('pools: Dee works her way through the Putaway pool oldest first — STG-1, 3, 4, 5, 6, 7',
  order.join() === 'J-STG-1,J-STG-3,J-STG-4,J-STG-5,J-STG-6,J-STG-7');
s = fresh();
W.releaseWave(s, ['ORD-602'], 'u-sam');
W.releaseWave(s, ['ORD-601'], 'u-sam');   /* High priority, but released later */
check('pools: the Picking pool is ORD-503, then ORD-602, then ORD-601 — age, not priority',
  W.pool(s, 'picking').map(function (j) { return j.id; }).join() === 'J-ORD-503,J-ORD-602,J-ORD-601');
check('pools: Grace finishes ORD-502 (pick, pack, load) and is dealt ORD-503 — the oldest', finishJob(s, 'u-grace', 'J-ORD-502') && W.jobsOf(s, 'u-grace').map(function (j) { return j.id; }).join() === 'J-ORD-503');

/* ================= manager reassign ================================== */
s = fresh();
W.nextFor(s, 'u-priya');
W.complete(s, 't-pick-ORD-501-B-04', { by: 'u-priya' });
W.nextFor(s, 'u-priya');                         /* A-08 now in her hands */
check('setup: Priya has done B-04 and holds A-08 in hand', task(s, 't-pick-ORD-501-A-08').assignee === 'u-priya' && unit(s, 'u-priya').currentTaskId === 't-pick-ORD-501-A-08');
var before = JSON.stringify(s);
r = W.reassignJob(s, 'J-ORD-501', 'u-grace', 'u-tommy');
check('reassign: a worker cannot move a job — only a manager', !r.ok && /Only a manager/.test(r.reason) && JSON.stringify(s) === before);
r = W.reassignJob(s, 'J-ORD-501', 'u-dee', 'u-sam');
check('reassign: a worker outside the job\'s department is refused, nothing moves', !r.ok && /Dee Carter does not work Picking/.test(r.reason) && JSON.stringify(s) === before);
r = W.reassignJob(s, 'J-ORD-501', 'u-priya', 'u-sam');
check('reassign: to the holder is refused', !r.ok && /already holds/.test(r.reason));
check('reassign: an unknown job is refused', !W.reassignJob(s, 'J-NOPE', 'u-grace', 'u-sam').ok);
r = W.reassignJob(s, 'J-ORD-501', 'u-grace', 'u-sam');
check('reassign: Sam moves ORD-501 from Priya to Grace', r.ok && r.from === 'u-priya' && r.to === 'u-grace' && r.moved === 1 && W.job(s, 'J-ORD-501').owner === 'u-grace');
check('reassign: the remaining task moves — out of Priya\'s hands, queued for Grace',
  task(s, 't-pick-ORD-501-A-08').status === 'open' && !task(s, 't-pick-ORD-501-A-08').assignee &&
  task(s, 't-pick-ORD-501-A-08').queuedFor === 'u-grace' && unit(s, 'u-priya').currentTaskId !== 't-pick-ORD-501-A-08');
check('reassign: the completed task keeps its doer (Priya)', task(s, 't-pick-ORD-501-B-04').status === 'done' && task(s, 't-pick-ORD-501-B-04').doneBy === 'u-priya');
var rec = s.records.filter(function (x) { return x.kind === 'job-reassign'; })[0];
check('reassign: the record shows who moved it, when, and from whom',
  !!rec && rec.jobId === 'J-ORD-501' && rec.by === 'u-sam' && rec.from === 'u-priya' && rec.to === 'u-grace' && !!rec.ts &&
  /moved from Priya Shah to Grace Liu by Sam Whitaker/.test(rec.text));
var hist = W.job(s, 'J-ORD-501').history;
check('reassign: the job\'s own history carries the move too', hist[hist.length - 1].act === 'reassigned' && hist[hist.length - 1].from === 'u-priya' &&
  hist[hist.length - 1].by === 'u-sam' && hist[hist.length - 1].to === 'u-grace');
check('reassign: Grace now holds two jobs, hers first — ORD-502, then ORD-501',
  W.jobsOf(s, 'u-grace').map(function (j) { return j.id; }).join() === 'J-ORD-502,J-ORD-501');
check('reassign: Priya, freed, is dealt the next Picking job by the system — ORD-503',
  W.jobsOf(s, 'u-priya').map(function (j) { return j.id; }).join() === 'J-ORD-503');
check('reassign: the law still holds after the move', lawHolds(s));
check('reassign: a finished job cannot be moved', (function () {
  var x = fresh(); W.nextFor(x, 'u-dee'); W.complete(x, 't-putaway-STG-1', { by: 'u-dee' });
  var rr = W.reassignJob(x, 'J-STG-1', 'u-tommy', 'u-sam'); return !rr.ok && /already finished/.test(rr.reason);
})());
check('reassign: a manager can give out a pool job ("from the pool"), recorded the same way', (function () {
  var x = fresh(); var rr = W.reassignJob(x, 'J-ORD-503', 'u-grace', 'u-pat');
  var rc = x.records.filter(function (y) { return y.kind === 'job-reassign'; })[0];
  return rr.ok && rr.from === null && /from the pool to Grace Liu by Pat Sullivan/.test(rc.text) && rc.from === null;
})());
var voiceSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'wms-voice.js'), 'utf8');
var aiSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'wms-ai.js'), 'utf8');
check('reassign: voice can never reassign — the voice and model modules never name reassign', !/reassign/i.test(voiceSrc) && !/reassign/i.test(aiSrc));

/* ================= the seed invariants =============================== */
s = fresh();
check('seed: FLG-001 and FLG-002 stand, open, in the reporters\' words',
  s.wms.flags.length === 2 && s.wms.flags[0].id === 'FLG-001' && s.wms.flags[1].id === 'FLG-002' &&
  s.wms.flags.every(function (f) { return f.status === 'open'; }) && /leaking oil/.test(s.wms.flags[0].words));
var props = W.proposals(s);
check('seed: the Zone B bottleneck proposal fires — Jay Patel, Zone C → B', props.length === 1 && props[0].unitName === 'Jay Patel' &&
  props[0].fromZone === 'C' && props[0].toZone === 'B');
check('seed: it reads JOB load — "Zone B has 9 jobs waiting for 2 workers (4.5 each). Zone C has 3 for 3."',
  props[0].why === 'Zone B has 9 jobs waiting for 2 workers (4.5 each). Zone C has 3 for 3.');
var bn = W.bottleneck(s);
check('seed: the bottleneck is counted in jobs (unit: job), and the dashboard carries the same call', bn.unit === 'job' && bn.pending === 9 &&
  JSON.stringify(W.dashboard(s).bottleneck) === JSON.stringify(bn));
var zl = W.jobLoad(s);
check('seed: job load by zone — A 5 / 3, B 9 / 2, C 3 / 3', zl.map(function (z) { return z.zone + z.pending + '/' + z.workers; }).join() === 'A5/3,B9/2,C3/3');
/* jobs, not tasks: a receipt at a zone B door makes ten putaway tasks
   but ONE job */
s = fresh();
W.checkIn(s, 'APT-102', 'u-sam');   /* IN-1002 at Inbound Door 3, zone B */
var tasksB0 = s.tasks.filter(function (t) { return t.zone === 'B' && t.status !== 'done'; }).length;
var jobsB0 = W.jobLoad(s)[1].pending;
W.receive(s, 'IN-1002', [{ desc: 'Laundry detergent — cases', received: 120, damaged: 0 }, { desc: 'Paper towels — cases', received: 120, damaged: 0 }], { by: 'u-sam' });
var tasksB1 = s.tasks.filter(function (t) { return t.zone === 'B' && t.status !== 'done'; }).length;
var jobsB1 = W.jobLoad(s)[1].pending;
check('job load, not task count: IN-1002\'s ten putaways add 9 tasks to zone B but no new job (the receive\'s job carries them)',
  tasksB1 - tasksB0 === 9 && jobsB1 === jobsB0 && /Zone B has 10 jobs waiting/.test(W.proposals(s)[0].why));

/* ================= an older live record upgrades ===================== */
s = fresh();
var legacy = JSON.parse(JSON.stringify(s));
delete legacy.wms.jobs;
legacy.tasks.forEach(function (t) { delete t.jobId; delete t.queuedFor; });
legacy.labor.forEach(function (u) { delete u.depts; });
/* pulled before jobs existed: Tommy had a pick in hand */
var lt = legacy.tasks.filter(function (t) { return t.id === 't-pick-ORD-503-B-02'; })[0];
lt.status = 'assigned'; lt.assignee = 'u-tommy';
legacy.labor.filter(function (u) { return u.id === 'u-tommy'; })[0].currentTaskId = lt.id;
W.install(legacy); W.refresh(legacy);
check('upgrade: a record from before jobs takes the seed\'s departments by unit id', unit(legacy, 'u-marcus').depts.join() === 'inbound' && unit(legacy, 'u-sam').depts.length === 0);
check('upgrade: work already in someone\'s hands makes them its job\'s holder (adopted, never yanked)',
  W.job(legacy, 'J-ORD-503').owner === 'u-tommy' && task(legacy, 't-pick-ORD-503-B-02').assignee === 'u-tommy' &&
  task(legacy, 't-pick-ORD-503-C-08').queuedFor === 'u-tommy' && W.job(legacy, 'J-ORD-503').history[0].act === 'adopted');

/* ================= the game never gets jobs ========================== */
var g = W.seedGame();
check('game: its world carries no jobs and no job marks — the pull stays the game\'s', !g.wms.jobs &&
  g.tasks.every(function (t) { return !t.jobId && !t.queuedFor; }));
check('game: the live-only job calls refuse the game world', !W.jobsOn(g) && !W.reassignJob(g, 'J-x', 'g-a', 'g-b').ok);
var gt = g.tasks.filter(function (t) { return t.status === 'open' && !W.blocked(g, t); })[0];
var gu = g.labor.filter(function (u) { return u.role === 'worker'; })[0];
var gn = W.nextFor(g, gu.id);
check('game: nextFor still pulls from the game\'s open work exactly as before', !!gn.task && gn.task.status === 'assigned' && !g.wms.jobs && !!gt);

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
