/* =====================================================================
   world.js — the demo warehouse, as data.

   One small building, seeded on purpose: freight staged at the dock
   doors waiting for putaway, partial pallets of the same item in two
   different bins (they should be married up), one stored pallet that
   needs breaking down, open orders to pick, and a truck at Door 1
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

    /* Dock doors. Each door sits in a zone; state is what the door
       is doing right now. */
    doors: [
      { id: 'Door 1', zone: 'A', state: 'unloading', shipmentId: 'IN-1001' },
      { id: 'Door 2', zone: 'A', state: 'staged', shipmentId: null },
      { id: 'Door 3', zone: 'B', state: 'empty', shipmentId: null },
      { id: 'Door 4', zone: 'C', state: 'loading', shipmentId: null }
    ],

    zones: ['A', 'B', 'C'],

    /* Bins: 8 per zone. contents is a list of {desc, qty}; an empty
       list means an empty bin. needsBreakdown marks a stored pallet
       that has to come apart into cartons. */
    bins: [
      /* Zone A */
      { id: 'A-01', zone: 'A', status: 'ok', contents: [{ desc: 'Canned peaches — cases', qty: 40 }] },
      { id: 'A-02', zone: 'A', status: 'ok', contents: [{ desc: 'Paper towels — cases', qty: 22 }] },
      { id: 'A-03', zone: 'A', status: 'ok', contents: [] },
      { id: 'A-04', zone: 'A', status: 'ok', contents: [{ desc: 'Laundry detergent — cases', qty: 16 }] },
      { id: 'A-05', zone: 'A', status: 'hold', contents: [{ desc: 'Dog food — bags', qty: 25 }] },
      { id: 'A-06', zone: 'A', status: 'ok', needsBreakdown: true, contents: [{ desc: 'Mixed grocery', qty: 24 }] },
      { id: 'A-07', zone: 'A', status: 'ok', contents: [] },
      { id: 'A-08', zone: 'A', status: 'ok', contents: [{ desc: 'Bottled water — cases', qty: 35 }] },
      /* Zone B */
      { id: 'B-01', zone: 'B', status: 'ok', contents: [{ desc: 'Canned peaches — cases', qty: 12 }] },
      { id: 'B-02', zone: 'B', status: 'ok', contents: [{ desc: 'Tomato sauce — cases', qty: 28 }] },
      { id: 'B-03', zone: 'B', status: 'ok', contents: [] },
      { id: 'B-04', zone: 'B', status: 'ok', contents: [{ desc: 'Rice — bags', qty: 30 }] },
      { id: 'B-05', zone: 'B', status: 'ok', contents: [{ desc: 'Pasta — cases', qty: 18 }] },
      { id: 'B-06', zone: 'B', status: 'ok', contents: [] },
      { id: 'B-07', zone: 'B', status: 'ok', contents: [{ desc: 'Cooking oil — cases', qty: 20 }] },
      { id: 'B-08', zone: 'B', status: 'ok', contents: [{ desc: 'Flour — bags', qty: 14 }] },
      /* Zone C */
      { id: 'C-01', zone: 'C', status: 'ok', contents: [{ desc: 'Canned peaches — cases', qty: 9 }] },
      { id: 'C-02', zone: 'C', status: 'ok', contents: [{ desc: 'Green beans — cases', qty: 26 }] },
      { id: 'C-03', zone: 'C', status: 'ok', contents: [] },
      { id: 'C-04', zone: 'C', status: 'ok', contents: [{ desc: 'Sugar — bags', qty: 22 }] },
      { id: 'C-05', zone: 'C', status: 'ok', contents: [{ desc: 'Coffee — cases', qty: 11 }] },
      { id: 'C-06', zone: 'C', status: 'ok', contents: [] },
      { id: 'C-07', zone: 'C', status: 'ok', contents: [{ desc: 'Tea — cases', qty: 15 }] },
      { id: 'C-08', zone: 'C', status: 'ok', contents: [{ desc: 'Cereal — cases', qty: 33 }] }
    ],

    /* Pallets sitting at the doors, waiting to be put away. */
    staging: [
      { id: 'STG-1', door: 'Door 2', desc: 'Paper towels — cases', qty: 18 },
      { id: 'STG-2', door: 'Door 2', desc: 'Laundry detergent — cases', qty: 24 },
      { id: 'STG-3', door: 'Door 1', desc: 'Canned peaches — cases', qty: 15 },
      { id: 'STG-4', door: 'Door 4', desc: 'Bottled water — cases', qty: 30 }
    ],

    /* Labor units — a labor unit is an employee. Six workers spread
       two to a zone, one manager over the building. */
    labor: [
      { id: 'u-marcus', name: 'Marcus Reed', role: 'worker', zone: 'A', currentTaskId: null },
      { id: 'u-dee', name: 'Dee Carter', role: 'worker', zone: 'A', currentTaskId: null },
      { id: 'u-tommy', name: 'Tommy Nguyen', role: 'worker', zone: 'B', currentTaskId: null },
      { id: 'u-rosa', name: 'Rosa Flores', role: 'worker', zone: 'B', currentTaskId: null },
      { id: 'u-jay', name: 'Jay Patel', role: 'worker', zone: 'C', currentTaskId: null },
      { id: 'u-priya', name: 'Priya Shah', role: 'worker', zone: 'C', currentTaskId: null },
      { id: 'u-sam', name: 'Sam Whitaker', role: 'manager', zone: 'A', currentTaskId: null }
    ],

    /* Inbound: what is expected at the doors. IN-1001 is at Door 1
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
      { id: 'IN-1001', door: 'Door 1', desc: 'Peach truck — Blue Ridge Freight', pallets: 6, status: 'staged at door',
        lines: [{ desc: 'Canned peaches — cases', pallets: 6, perPallet: 40 }],
        bol: { bolNumber: 'BRFL-1001', carrier: 'Blue Ridge Freight Lines', shipper: 'Orchard Valley Canning',
          consignee: 'Witness Demo Warehouse', piecesClaimed: 240, totalWeightLb: 7200,
          lines: [{ name: 'Canned peaches', match: ['peach'], pieces: 240, weightLb: 7200 }] } },
      { id: 'IN-1002', door: 'Door 3', desc: 'Household goods — Southeast Line', pallets: 10, status: 'expected today',
        lines: [{ desc: 'Laundry detergent — cases', pallets: 4, perPallet: 30 },
                { desc: 'Paper towels — cases', pallets: 6, perPallet: 20 }],
        bol: { bolNumber: 'SEL-1002', carrier: 'Southeast Line', shipper: 'Carolina Household Co.',
          consignee: 'Witness Demo Warehouse', piecesClaimed: 240, totalWeightLb: 4440,
          lines: [{ name: 'Laundry detergent', match: ['detergent', 'laundry'], pieces: 120, weightLb: 3000 },
                  { name: 'Paper towels', match: ['towel'], pieces: 120, weightLb: 1440 }] } },
      { id: 'IN-1003', door: 'Door 2', desc: 'Paper goods — Blue Ridge Freight', pallets: 8, status: 'expected tomorrow',
        lines: [{ desc: 'Paper towels — cases', pallets: 8, perPallet: 24 }],
        bol: { bolNumber: 'BRFL-1003', carrier: 'Blue Ridge Freight Lines', shipper: 'Piedmont Paper Mills',
          consignee: 'Witness Demo Warehouse', piecesClaimed: 192, totalWeightLb: 2304,
          lines: [{ name: 'Paper towels', match: ['towel'], pieces: 192, weightLb: 2304 }] } },
      { id: 'IN-1004', door: 'Door 2', desc: 'Janitorial supply — Blue Ridge Freight (Test Load 001)', pallets: 1, status: 'expected today',
        lines: [{ desc: 'Janitorial supply — cartons', pallets: 1, perPallet: 20 }],
        bol: { bolNumber: 'BRFL-TL-001', carrier: 'Blue Ridge Freight Lines', shipper: 'Piedmont Janitorial Supply',
          consignee: 'Witness Demo Warehouse', piecesClaimed: 20, totalWeightLb: 624,
          lines: [{ name: 'All-purpose cleaner', match: ['cleaner'], pieces: 6, weightLb: 216 },
                  { name: 'Aerosol air freshener', match: ['aerosol', 'air freshener'], pieces: 4, weightLb: 88 },
                  { name: 'Paper towels', match: ['towel'], pieces: 6, weightLb: 120 },
                  { name: 'Dish soap', match: ['soap', 'dish'], pieces: 4, weightLb: 200 }] } }
    ],

    /* Outbound: orders to pick from the bins. door is where picked
       freight is staged and loaded — Door 4 is the loading door. */
    outbound: [
      { id: 'ORD-501', status: 'open', door: 'Door 4', lines: [
        { binId: 'B-04', desc: 'Rice — bags', qty: 10 },
        { binId: 'A-08', desc: 'Bottled water — cases', qty: 12 }
      ] },
      { id: 'ORD-502', status: 'open', door: 'Door 4', lines: [
        { binId: 'C-02', desc: 'Green beans — cases', qty: 8 }
      ] },
      { id: 'ORD-503', status: 'open', door: 'Door 4', lines: [
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
