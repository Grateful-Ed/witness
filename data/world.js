/* =====================================================================
   world.js — the demo warehouse, as data.

   One small building, seeded on purpose: freight staged at the dock
   doors waiting for putaway, partial pallets of the same item in two
   different bins (they should be married up), one stored pallet that
   needs breaking down, open orders to pick, and a truck at Inbound Door 1
   waiting on a receiving cross-check (that part lives in module one,
   index.html — this file is only the world it happens in).

   William's vocabulary, kept: dock doors, bins, labor units (a labor
   unit is an employee), zones.

   Loaded two ways: in the browser it sets window.WitnessWorldSeed;
   in node it is module.exports. engine.js turns this seed into live
   state — nothing here is ever mutated directly.
   ===================================================================== */
(function (root) {
  'use strict';

  var SEED = {

    /* Dock doors: twelve, on two walls (William's sketch, 2026-11-02;
       expanded 4→6 per side 2026-11-04 — "I know 4 limits it").
       Inbound Door 1–6 take trucks in; Outbound Door 1–6 send loads
       out. direction says which wall. Each door sits in a zone; state
       is what the door is doing right now. Outbound Door 4 is the
       loading door. */
    doors: [
      { id: 'Inbound Door 1', direction: 'in', zone: 'A', state: 'unloading', shipmentId: 'IN-1001' },
      { id: 'Inbound Door 2', direction: 'in', zone: 'A', state: 'staged', shipmentId: null },
      { id: 'Inbound Door 3', direction: 'in', zone: 'B', state: 'empty', shipmentId: null },
      { id: 'Inbound Door 4', direction: 'in', zone: 'C', state: 'staged', shipmentId: null },
      { id: 'Inbound Door 5', direction: 'in', zone: 'B', state: 'staged', shipmentId: null },
      { id: 'Inbound Door 6', direction: 'in', zone: 'B', state: 'staged', shipmentId: null },
      { id: 'Outbound Door 1', direction: 'out', zone: 'A', state: 'empty', shipmentId: null },
      { id: 'Outbound Door 2', direction: 'out', zone: 'A', state: 'empty', shipmentId: null },
      { id: 'Outbound Door 3', direction: 'out', zone: 'B', state: 'empty', shipmentId: null },
      { id: 'Outbound Door 4', direction: 'out', zone: 'C', state: 'loading', shipmentId: null },
      { id: 'Outbound Door 5', direction: 'out', zone: 'B', state: 'empty', shipmentId: null },
      { id: 'Outbound Door 6', direction: 'out', zone: 'C', state: 'empty', shipmentId: null }
    ],

    zones: ['A', 'B', 'C'],

    /* Bins: 10 per zone (8 until the 2026-11-04 expansion). contents
       is a list of {desc, qty}; an empty list means an empty bin.
       needsBreakdown marks a stored pallet that has to come apart
       into cartons. */
    bins: [
      /* Zone A */
      { id: 'A-01', zone: 'A', status: 'ok', contents: [{ desc: 'Canned peaches — cases', qty: 40 }] },
      { id: 'A-02', zone: 'A', status: 'ok', contents: [{ desc: 'Paper towels — cases', qty: 22 }] },
      { id: 'A-03', zone: 'A', status: 'ok', contents: [] },
      { id: 'A-04', zone: 'A', status: 'ok', contents: [{ desc: 'Laundry detergent — cases', qty: 16 }, { desc: 'Flour — bags', qty: 10 }] },
      { id: 'A-05', zone: 'A', status: 'hold', contents: [{ desc: 'Dog food — bags', qty: 25 }] },
      { id: 'A-06', zone: 'A', status: 'ok', needsBreakdown: true, contents: [{ desc: 'Mixed grocery', qty: 24 }] },
      { id: 'A-07', zone: 'A', status: 'ok', contents: [] },
      { id: 'A-08', zone: 'A', status: 'ok', contents: [{ desc: 'Bottled water — cases', qty: 35 }] },
      { id: 'A-09', zone: 'A', status: 'ok', contents: [{ desc: 'Tomato sauce — cases', qty: 21 }] },
      { id: 'A-10', zone: 'A', status: 'ok', contents: [] },
      /* Zone B */
      { id: 'B-01', zone: 'B', status: 'ok', contents: [{ desc: 'Canned peaches — cases', qty: 12 }] },
      { id: 'B-02', zone: 'B', status: 'ok', contents: [{ desc: 'Tomato sauce — cases', qty: 28 }] },
      { id: 'B-03', zone: 'B', status: 'ok', contents: [] },
      { id: 'B-04', zone: 'B', status: 'ok', contents: [{ desc: 'Rice — bags', qty: 30 }] },
      { id: 'B-05', zone: 'B', status: 'ok', contents: [{ desc: 'Pasta — cases', qty: 18 }] },
      { id: 'B-06', zone: 'B', status: 'ok', contents: [] },
      { id: 'B-07', zone: 'B', status: 'ok', contents: [{ desc: 'Cooking oil — cases', qty: 20 }] },
      { id: 'B-08', zone: 'B', status: 'ok', contents: [{ desc: 'Flour — bags', qty: 14 }] },
      { id: 'B-09', zone: 'B', status: 'ok', contents: [{ desc: 'Canned peaches — cases', qty: 16 }, { desc: 'Canned tomatoes — cases', qty: 9 }] },
      { id: 'B-10', zone: 'B', status: 'ok', contents: [] },
      /* Zone C */
      { id: 'C-01', zone: 'C', status: 'ok', contents: [{ desc: 'Canned peaches — cases', qty: 9 }] },
      { id: 'C-02', zone: 'C', status: 'ok', contents: [{ desc: 'Green beans — cases', qty: 26 }] },
      { id: 'C-03', zone: 'C', status: 'ok', contents: [] },
      { id: 'C-04', zone: 'C', status: 'ok', contents: [{ desc: 'Sugar — bags', qty: 22 }] },
      { id: 'C-05', zone: 'C', status: 'ok', contents: [{ desc: 'Coffee — cases', qty: 11 }] },
      { id: 'C-06', zone: 'C', status: 'ok', contents: [] },
      { id: 'C-07', zone: 'C', status: 'ok', contents: [{ desc: 'Tea — cases', qty: 15 }] },
      { id: 'C-08', zone: 'C', status: 'ok', contents: [{ desc: 'Cereal — cases', qty: 33 }] },
      { id: 'C-09', zone: 'C', status: 'ok', contents: [{ desc: 'Canned tomatoes — cases', qty: 19 }] },
      { id: 'C-10', zone: 'C', status: 'ok', contents: [] }
    ],

    /* Pallets sitting at the doors, waiting to be put away. */
    staging: [
      { id: 'STG-1', door: 'Inbound Door 2', desc: 'Paper towels — cases', qty: 18 },
      { id: 'STG-2', door: 'Inbound Door 2', desc: 'Laundry detergent — cases', qty: 24 },
      { id: 'STG-3', door: 'Inbound Door 1', desc: 'Canned peaches — cases', qty: 15 },
      { id: 'STG-4', door: 'Inbound Door 4', desc: 'Bottled water — cases', qty: 30 },
      { id: 'STG-5', door: 'Inbound Door 5', desc: 'Canned tomatoes — cases', qty: 22 },
      { id: 'STG-6', door: 'Inbound Door 5', desc: 'Cooking oil — cases', qty: 16 },
      { id: 'STG-7', door: 'Inbound Door 6', desc: 'Rice — bags', qty: 26 },
      { id: 'STG-8', door: 'Inbound Door 6', desc: 'Flour — bags', qty: 20 }
    ],

    /* Labor units — a labor unit is an employee. Eight workers:
       three in A, two in B, three in C — B runs thin on purpose,
       its queue is the building's bottleneck — plus a manager over
       the building and a lead hand in B. */
    labor: [
      { id: 'u-marcus', name: 'Marcus Reed', role: 'worker', zone: 'A', currentTaskId: null },
      { id: 'u-dee', name: 'Dee Carter', role: 'worker', zone: 'A', currentTaskId: null },
      { id: 'u-chris', name: 'Chris Delgado', role: 'worker', zone: 'A', currentTaskId: null },
      { id: 'u-tommy', name: 'Tommy Nguyen', role: 'worker', zone: 'B', currentTaskId: null },
      { id: 'u-rosa', name: 'Rosa Flores', role: 'worker', zone: 'B', currentTaskId: null },
      { id: 'u-jay', name: 'Jay Patel', role: 'worker', zone: 'C', currentTaskId: null },
      { id: 'u-priya', name: 'Priya Shah', role: 'worker', zone: 'C', currentTaskId: null },
      { id: 'u-grace', name: 'Grace Liu', role: 'worker', zone: 'C', currentTaskId: null },
      { id: 'u-sam', name: 'Sam Whitaker', role: 'manager', zone: 'A', currentTaskId: null },
      { id: 'u-pat', name: 'Pat Sullivan', role: 'manager', zone: 'B', currentTaskId: null }
    ],

    /* Inbound: what is expected at the doors. IN-1001 is at Inbound Door 1
       now — staged for a receiving task. lines are what the bill of
       lading says is on the truck: pallets × cases (or bags) per
       pallet. Receiving turns each pallet into a staged pallet at the
       door, so putaway is driven by what was received.

       bol is the FILE COPY of each shipment's bill of lading — it
       arrived by email/EDI before the truck, so it is in the system
       already. A dock scan (js/summon.js) reads the paper, takes its
       BOL number, and summons the shipment that carries it here. The
       scan never creates a shipment. lines[].match words pair a line
       read off the camera with a file line (same rule as
       data/bol-loads.js). IN-1004 is Test Load 001 — its file copy is
       the same as data/bol-loads.js and the printed fixture page
       test-data/bol-test-load-001.html, so that page summons it. */
    inbound: [
      { id: 'IN-1001', door: 'Inbound Door 1', desc: 'Peach truck — Blue Ridge Freight', pallets: 6, status: 'staged at door',
        lines: [{ desc: 'Canned peaches — cases', pallets: 6, perPallet: 40 }],
        bol: { bolNumber: 'BRFL-1001', carrier: 'Blue Ridge Freight Lines', shipper: 'Orchard Valley Canning',
          consignee: 'Witness Demo Warehouse', piecesClaimed: 240, totalWeightLb: 7200,
          lines: [{ name: 'Canned peaches', match: ['peach'], pieces: 240, weightLb: 7200 }] } },
      { id: 'IN-1002', door: 'Inbound Door 3', desc: 'Household goods — Southeast Line', pallets: 10, status: 'expected today',
        lines: [{ desc: 'Laundry detergent — cases', pallets: 4, perPallet: 30 },
                { desc: 'Paper towels — cases', pallets: 6, perPallet: 20 }],
        bol: { bolNumber: 'SEL-1002', carrier: 'Southeast Line', shipper: 'Carolina Household Co.',
          consignee: 'Witness Demo Warehouse', piecesClaimed: 240, totalWeightLb: 4440,
          lines: [{ name: 'Laundry detergent', match: ['detergent', 'laundry'], pieces: 120, weightLb: 3000 },
                  { name: 'Paper towels', match: ['towel'], pieces: 120, weightLb: 1440 }] } },
      { id: 'IN-1003', door: 'Inbound Door 2', desc: 'Paper goods — Blue Ridge Freight', pallets: 8, status: 'expected tomorrow',
        lines: [{ desc: 'Paper towels — cases', pallets: 8, perPallet: 24 }],
        bol: { bolNumber: 'BRFL-1003', carrier: 'Blue Ridge Freight Lines', shipper: 'Piedmont Paper Mills',
          consignee: 'Witness Demo Warehouse', piecesClaimed: 192, totalWeightLb: 2304,
          lines: [{ name: 'Paper towels', match: ['towel'], pieces: 192, weightLb: 2304 }] } },
      { id: 'IN-1004', door: 'Inbound Door 2', desc: 'Janitorial supply — Blue Ridge Freight (Test Load 001)', pallets: 1, status: 'expected today',
        lines: [{ desc: 'Janitorial supply — cartons', pallets: 1, perPallet: 20 }],
        bol: { bolNumber: 'BRFL-TL-001', carrier: 'Blue Ridge Freight Lines', shipper: 'Piedmont Janitorial Supply',
          consignee: 'Witness Demo Warehouse', piecesClaimed: 20, totalWeightLb: 624,
          lines: [{ name: 'All-purpose cleaner', match: ['cleaner'], pieces: 6, weightLb: 216 },
                  { name: 'Aerosol air freshener', match: ['aerosol', 'air freshener'], pieces: 4, weightLb: 88 },
                  { name: 'Paper towels', match: ['towel'], pieces: 6, weightLb: 120 },
                  { name: 'Dish soap', match: ['soap', 'dish'], pieces: 4, weightLb: 200 }] } },
      { id: 'IN-1005', door: 'Inbound Door 5', desc: 'Beverages — Coastal Express', pallets: 8, status: 'expected today',
        lines: [{ desc: 'Bottled water — cases', pallets: 5, perPallet: 30 },
                { desc: 'Tea — cases', pallets: 3, perPallet: 20 }],
        bol: { bolNumber: 'CX-1005', carrier: 'Coastal Express', shipper: 'Blue Ridge Beverage Co.',
          consignee: 'Witness Demo Warehouse', piecesClaimed: 210, totalWeightLb: 5940,
          lines: [{ name: 'Bottled water', match: ['water'], pieces: 150, weightLb: 5400 },
                  { name: 'Tea', match: ['tea'], pieces: 60, weightLb: 540 }] } },
      { id: 'IN-1006', door: 'Inbound Door 6', desc: 'Dry goods — Southeast Line', pallets: 8, status: 'expected tomorrow',
        lines: [{ desc: 'Flour — bags', pallets: 4, perPallet: 25 },
                { desc: 'Sugar — bags', pallets: 4, perPallet: 20 }],
        bol: { bolNumber: 'SEL-1006', carrier: 'Southeast Line', shipper: 'Georgia Milling Co.',
          consignee: 'Witness Demo Warehouse', piecesClaimed: 180, totalWeightLb: 3300,
          lines: [{ name: 'Flour', match: ['flour'], pieces: 100, weightLb: 2500 },
                  { name: 'Sugar', match: ['sugar'], pieces: 80, weightLb: 800 }] } }
    ],

    /* Outbound: orders to pick from the bins. door is where picked
       freight is staged and loaded — Outbound Door 4 is the loading door. */
    outbound: [
      { id: 'ORD-501', status: 'open', door: 'Outbound Door 4', lines: [
        { binId: 'B-04', desc: 'Rice — bags', qty: 10 },
        { binId: 'A-08', desc: 'Bottled water — cases', qty: 12 }
      ] },
      { id: 'ORD-502', status: 'open', door: 'Outbound Door 4', lines: [
        { binId: 'C-02', desc: 'Green beans — cases', qty: 8 }
      ] },
      { id: 'ORD-503', status: 'open', door: 'Outbound Door 4', lines: [
        { binId: 'B-02', desc: 'Tomato sauce — cases', qty: 6 },
        { binId: 'C-08', desc: 'Cereal — cases', qty: 10 }
      ] }
    ],

    tasks: [],
    records: []
  };

  root.WitnessWorldSeed = SEED;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SEED;
  }
})(typeof window !== 'undefined' ? window : globalThis);
