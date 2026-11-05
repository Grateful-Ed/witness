/* =====================================================================
   game-world.js — Walk the Shift's OWN building, as data.

   Job build, step 1 of 2 (briefs/claude-brief-game-data-split.md;
   William, 2026-11-05: the game pulls from its OWN data, so the live
   data can be set up for jobs vs tasks properly). The game world is
   authored for the game and lives only here. It resembles the live
   building (same doors, zones and bin layout — the same shape of
   work) but it is not the live building: its trucks, orders,
   customers, carriers and crew are its own, and its bins are stocked
   for play — reserve stock behind the pick faces so a replenishment
   shift can deal, and seven empty bins (at least one per zone) so
   directed putaways always have somewhere to go.

   Nothing here is ever derived from data/world.js or
   data/wms-seed.js, and nothing there is derived from here.
   js/wms.js turns this into a game state (seedGame) tagged
   world: 'game' — a tag the live desk record refuses, and one the
   engine's live-seed back-fill (upgradeState) skips.

   Two parts, the same two shapes the live seed uses:
     building — the shape of data/world.js (doors, bins, staging,
                labor, inbound, outbound)
     wms      — the shape of data/wms-seed.js (items, appointments,
                BOL file copies, pick-face slots, unreleased orders,
                standing flags, customers) plus the WMS id sequences

   Enough for all four shift types to deal full shifts: inbound dock
   worker (a truck staged at Inbound Door 1, eight pallets to put
   away, seven empty bins), outbound loader (three allocated orders),
   replenishment (reserve behind all three pick faces: water in A-02
   for A-08, rice in B-08 for B-04, green beans in C-07 for C-02),
   cycle counter (every stocked bin countable). One building deals
   all four in a row, in the order the panel lists them.

   Loaded in the browser (window.WitnessGameWorld) and in node
   (module.exports). Nothing here is ever mutated directly.
   ===================================================================== */
(function (root) {
  'use strict';

  var GAME = {

    building: {
      doors: [
        { id: 'Inbound Door 1', direction: 'in', zone: 'A', state: 'unloading', shipmentId: 'IN-2001' },
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

      /* Stocked for play. Seven bins stay empty — A-07, A-10, B-06,
         B-10, C-03, C-06, C-10 — for the putaways. A-05 is on hold.
         A-02's water, B-08's rice and C-07's green beans are reserve
         for the A-08, B-04 and C-02 pick faces — so a replenishment
         shift still deals after an outbound shift has worked the
         first face below its minimum. */
      bins: [
        /* Zone A */
        { id: 'A-01', zone: 'A', status: 'ok', contents: [{ desc: 'Canned peaches — cases', qty: 40 }] },
        { id: 'A-02', zone: 'A', status: 'ok', contents: [{ desc: 'Paper towels — cases', qty: 22 }, { desc: 'Bottled water — cases', qty: 18 }] },
        { id: 'A-03', zone: 'A', status: 'ok', contents: [{ desc: 'Canned tomatoes — cases', qty: 24 }] },
        { id: 'A-04', zone: 'A', status: 'ok', contents: [{ desc: 'Laundry detergent — cases', qty: 16 }, { desc: 'Flour — bags', qty: 10 }, { desc: 'Paper towels — cases', qty: 12 }] },
        { id: 'A-05', zone: 'A', status: 'hold', contents: [{ desc: 'Dog food — bags', qty: 25 }] },
        { id: 'A-06', zone: 'A', status: 'ok', needsBreakdown: true, contents: [{ desc: 'Mixed grocery', qty: 24 }, { desc: 'Cereal — cases', qty: 10 }] },
        { id: 'A-07', zone: 'A', status: 'ok', contents: [] },
        { id: 'A-08', zone: 'A', status: 'ok', contents: [{ desc: 'Bottled water — cases', qty: 35 }, { desc: 'Canned tomatoes — cases', qty: 14 }] },
        { id: 'A-09', zone: 'A', status: 'ok', contents: [{ desc: 'Tomato sauce — cases', qty: 21 }] },
        { id: 'A-10', zone: 'A', status: 'ok', contents: [] },
        /* Zone B */
        { id: 'B-01', zone: 'B', status: 'ok', contents: [{ desc: 'Canned peaches — cases', qty: 12 }] },
        { id: 'B-02', zone: 'B', status: 'ok', contents: [{ desc: 'Tomato sauce — cases', qty: 28 }, { desc: 'Pasta — cases', qty: 16 }] },
        { id: 'B-03', zone: 'B', status: 'ok', contents: [{ desc: 'Canned beans — cases', qty: 28 }] },
        { id: 'B-04', zone: 'B', status: 'ok', contents: [{ desc: 'Rice — bags', qty: 30 }, { desc: 'Canned beans — cases', qty: 20 }] },
        { id: 'B-05', zone: 'B', status: 'ok', contents: [{ desc: 'Pasta — cases', qty: 18 }, { desc: 'Cooking oil — cases', qty: 9 }] },
        { id: 'B-06', zone: 'B', status: 'ok', contents: [] },
        { id: 'B-07', zone: 'B', status: 'ok', contents: [{ desc: 'Cooking oil — cases', qty: 20 }, { desc: 'Coffee — cases', qty: 12 }] },
        { id: 'B-08', zone: 'B', status: 'ok', contents: [{ desc: 'Flour — bags', qty: 14 }, { desc: 'Rice — bags', qty: 12 }] },
        { id: 'B-09', zone: 'B', status: 'ok', contents: [{ desc: 'Canned peaches — cases', qty: 16 }, { desc: 'Canned tomatoes — cases', qty: 9 }] },
        { id: 'B-10', zone: 'B', status: 'ok', contents: [] },
        /* Zone C */
        { id: 'C-01', zone: 'C', status: 'ok', contents: [{ desc: 'Canned peaches — cases', qty: 9 }] },
        { id: 'C-02', zone: 'C', status: 'ok', contents: [{ desc: 'Green beans — cases', qty: 26 }, { desc: 'Canned tomatoes — cases', qty: 18 }] },
        { id: 'C-03', zone: 'C', status: 'ok', contents: [] },
        { id: 'C-04', zone: 'C', status: 'ok', contents: [{ desc: 'Sugar — bags', qty: 22 }, { desc: 'Laundry detergent — cases', qty: 8 }] },
        { id: 'C-05', zone: 'C', status: 'ok', contents: [{ desc: 'Coffee — cases', qty: 11 }, { desc: 'Cereal — cases', qty: 14 }] },
        { id: 'C-06', zone: 'C', status: 'ok', contents: [] },
        { id: 'C-07', zone: 'C', status: 'ok', contents: [{ desc: 'Tea — cases', qty: 15 }, { desc: 'Green beans — cases', qty: 14 }] },
        { id: 'C-08', zone: 'C', status: 'ok', contents: [{ desc: 'Cereal — cases', qty: 33 }] },
        { id: 'C-09', zone: 'C', status: 'ok', contents: [{ desc: 'Canned tomatoes — cases', qty: 19 }] },
        { id: 'C-10', zone: 'C', status: 'ok', contents: [] }
      ],

      /* Pallets at the doors, waiting to be put away. STG-3 came off
         the truck at Inbound Door 1 — the game's first check-in. */
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

      /* The game's own crew: eight workers (three in A, two in B,
         three in C) and two managers. */
      labor: [
        { id: 'g-avery', name: 'Avery Brooks', role: 'worker', zone: 'A', currentTaskId: null },
        { id: 'g-luis', name: 'Luis Romero', role: 'worker', zone: 'A', currentTaskId: null },
        { id: 'g-kim', name: 'Kim Okafor', role: 'worker', zone: 'A', currentTaskId: null },
        { id: 'g-dana', name: 'Dana Price', role: 'worker', zone: 'B', currentTaskId: null },
        { id: 'g-omar', name: 'Omar Haddad', role: 'worker', zone: 'B', currentTaskId: null },
        { id: 'g-nell', name: 'Nell Ivers', role: 'worker', zone: 'C', currentTaskId: null },
        { id: 'g-ben', name: 'Ben Castillo', role: 'worker', zone: 'C', currentTaskId: null },
        { id: 'g-mia', name: 'Mia Tran', role: 'worker', zone: 'C', currentTaskId: null },
        { id: 'g-reese', name: 'Reese Holloway', role: 'manager', zone: 'A', currentTaskId: null },
        { id: 'g-june', name: 'June Maddox', role: 'manager', zone: 'B', currentTaskId: null }
      ],

      /* The game's own trucks, each with its BOL file copy. */
      inbound: [
        { id: 'IN-2001', door: 'Inbound Door 1', desc: 'Peach truck — Ridgeway Transport', pallets: 6, status: 'staged at door',
          lines: [{ desc: 'Canned peaches — cases', pallets: 6, perPallet: 40 }],
          bol: { bolNumber: 'RWT-2001', carrier: 'Ridgeway Transport', shipper: 'Sunfield Orchards',
            consignee: 'Practice Warehouse', piecesClaimed: 240, totalWeightLb: 7200,
            lines: [{ name: 'Canned peaches', match: ['peach'], pieces: 240, weightLb: 7200 }] } },
        { id: 'IN-2002', door: 'Inbound Door 3', desc: 'Household goods — Tidewater Freight', pallets: 10, status: 'expected today',
          lines: [{ desc: 'Laundry detergent — cases', pallets: 4, perPallet: 30 },
                  { desc: 'Paper towels — cases', pallets: 6, perPallet: 20 }],
          bol: { bolNumber: 'TWF-2002', carrier: 'Tidewater Freight', shipper: 'Brightline Home Goods',
            consignee: 'Practice Warehouse', piecesClaimed: 240, totalWeightLb: 4440,
            lines: [{ name: 'Laundry detergent', match: ['detergent', 'laundry'], pieces: 120, weightLb: 3000 },
                    { name: 'Paper towels', match: ['towel'], pieces: 120, weightLb: 1440 }] } },
        { id: 'IN-2003', door: 'Inbound Door 2', desc: 'Paper goods — Ridgeway Transport', pallets: 8, status: 'expected tomorrow',
          lines: [{ desc: 'Paper towels — cases', pallets: 8, perPallet: 24 }],
          bol: { bolNumber: 'RWT-2003', carrier: 'Ridgeway Transport', shipper: 'Kestrel Paper Co.',
            consignee: 'Practice Warehouse', piecesClaimed: 192, totalWeightLb: 2304,
            lines: [{ name: 'Paper towels', match: ['towel'], pieces: 192, weightLb: 2304 }] } },
        { id: 'IN-2004', door: 'Inbound Door 2', desc: 'Canned goods — Harbor Line', pallets: 2, status: 'expected today',
          lines: [{ desc: 'Canned beans — cases', pallets: 2, perPallet: 24 }],
          bol: { bolNumber: 'HBL-2004', carrier: 'Harbor Line', shipper: 'Millbrook Foods',
            consignee: 'Practice Warehouse', piecesClaimed: 48, totalWeightLb: 1152,
            lines: [{ name: 'Canned beans', match: ['bean'], pieces: 48, weightLb: 1152 }] } },
        { id: 'IN-2005', door: 'Inbound Door 5', desc: 'Beverages — Harbor Line', pallets: 8, status: 'expected today',
          lines: [{ desc: 'Bottled water — cases', pallets: 5, perPallet: 30 },
                  { desc: 'Tea — cases', pallets: 3, perPallet: 20 }],
          bol: { bolNumber: 'HBL-2005', carrier: 'Harbor Line', shipper: 'Clearbrook Springs',
            consignee: 'Practice Warehouse', piecesClaimed: 210, totalWeightLb: 5940,
            lines: [{ name: 'Bottled water', match: ['water'], pieces: 150, weightLb: 5400 },
                    { name: 'Tea', match: ['tea'], pieces: 60, weightLb: 540 }] } },
        { id: 'IN-2006', door: 'Inbound Door 6', desc: 'Dry goods — Tidewater Freight', pallets: 8, status: 'expected tomorrow',
          lines: [{ desc: 'Flour — bags', pallets: 4, perPallet: 25 },
                  { desc: 'Sugar — bags', pallets: 4, perPallet: 20 }],
          bol: { bolNumber: 'TWF-2006', carrier: 'Tidewater Freight', shipper: 'Prairie Mill Works',
            consignee: 'Practice Warehouse', piecesClaimed: 180, totalWeightLb: 3300,
            lines: [{ name: 'Flour', match: ['flour'], pieces: 100, weightLb: 2500 },
                    { name: 'Sugar', match: ['sugar'], pieces: 80, weightLb: 800 }] } }
      ],

      /* The game's own released orders (wave W-000), loading at
         Outbound Door 4. */
      outbound: [
        { id: 'ORD-701', status: 'open', door: 'Outbound Door 4', lines: [
          { binId: 'B-04', desc: 'Rice — bags', qty: 10 },
          { binId: 'A-08', desc: 'Bottled water — cases', qty: 12 }
        ] },
        { id: 'ORD-702', status: 'open', door: 'Outbound Door 4', lines: [
          { binId: 'C-02', desc: 'Green beans — cases', qty: 8 }
        ] },
        { id: 'ORD-703', status: 'open', door: 'Outbound Door 4', lines: [
          { binId: 'B-02', desc: 'Tomato sauce — cases', qty: 6 },
          { binId: 'C-08', desc: 'Cereal — cases', qty: 10 }
        ] }
      ],

      tasks: [],
      records: []
    },

    wms: {
      items: {
        'Canned peaches — cases':    { sku: 'PCH-2401', uom: 'case', caseLb: 30 },
        'Paper towels — cases':      { sku: 'PTW-1200', uom: 'case', caseLb: 12 },
        'Laundry detergent — cases': { sku: 'LDT-0400', uom: 'case', caseLb: 25 },
        'Dog food — bags':           { sku: 'DGF-4000', uom: 'bag',  caseLb: 40 },
        'Mixed grocery':             { sku: 'MXG-0001', uom: 'case', caseLb: 22 },
        'Bottled water — cases':     { sku: 'BWT-2400', uom: 'case', caseLb: 27 },
        'Tomato sauce — cases':      { sku: 'TMS-1215', uom: 'case', caseLb: 21 },
        'Rice — bags':               { sku: 'RCE-2000', uom: 'bag',  caseLb: 20 },
        'Pasta — cases':             { sku: 'PST-2016', uom: 'case', caseLb: 20 },
        'Cooking oil — cases':       { sku: 'OIL-0648', uom: 'case', caseLb: 36 },
        'Flour — bags':              { sku: 'FLR-2500', uom: 'bag',  caseLb: 25 },
        'Green beans — cases':       { sku: 'GBN-2414', uom: 'case', caseLb: 26 },
        'Sugar — bags':              { sku: 'SGR-1000', uom: 'bag',  caseLb: 10 },
        'Coffee — cases':            { sku: 'COF-0612', uom: 'case', caseLb: 18 },
        'Tea — cases':               { sku: 'TEA-1220', uom: 'case', caseLb: 9 },
        'Cereal — cases':            { sku: 'CRL-1418', uom: 'case', caseLb: 14 },
        'Canned tomatoes — cases':   { sku: 'CTM-2412', uom: 'case', caseLb: 24 },
        'Canned beans — cases':      { sku: 'CBN-2415', uom: 'case', caseLb: 24 }
      },

      appointments: [
        { id: 'APT-201', shipmentId: 'IN-2001', door: 'Inbound Door 1', day: 'Today', start: '06:00', end: '07:30',
          carrier: 'Ridgeway Transport', trailer: 'RWT-7741', status: 'checked in' },
        { id: 'APT-202', shipmentId: 'IN-2002', door: 'Inbound Door 3', day: 'Today', start: '10:00', end: '11:30',
          carrier: 'Tidewater Freight', trailer: 'TWF-3302', status: 'scheduled' },
        { id: 'APT-203', shipmentId: 'IN-2003', door: 'Inbound Door 2', day: 'Tomorrow', start: '07:00', end: '08:30',
          carrier: 'Ridgeway Transport', trailer: 'RWT-7790', status: 'scheduled' },
        { id: 'APT-204', shipmentId: 'IN-2005', door: 'Inbound Door 5', day: 'Today', start: '13:00', end: '14:30',
          carrier: 'Harbor Line', trailer: 'HBL-0418', status: 'scheduled' },
        { id: 'APT-205', shipmentId: 'IN-2006', door: 'Inbound Door 6', day: 'Tomorrow', start: '09:00', end: '10:30',
          carrier: 'Tidewater Freight', trailer: 'TWF-3355', status: 'scheduled' }
      ],

      /* Every game shipment carries its BOL in the building above;
         nothing to fill here. */
      bols: {},

      slots: [
        { binId: 'A-08', desc: 'Bottled water — cases', min: 30, max: 60 },
        { binId: 'B-04', desc: 'Rice — bags', min: 25, max: 40 },
        { binId: 'C-02', desc: 'Green beans — cases', min: 20, max: 40 }
      ],

      orders: [
        { id: 'ORD-801', customer: 'Corner Basket Grocery', priority: 'High', shipDate: 'Today', door: 'Outbound Door 4',
          carrier: 'Harbor Line', lines: [{ desc: 'Canned peaches — cases', qty: 20 }, { desc: 'Pasta — cases', qty: 6 }] },
        { id: 'ORD-802', customer: 'Westgate Pantry', priority: 'Normal', shipDate: 'Today', door: 'Outbound Door 4',
          carrier: 'Harbor Line', lines: [{ desc: 'Coffee — cases', qty: 4 }, { desc: 'Tea — cases', qty: 5 }] },
        { id: 'ORD-803', customer: 'Hilltop Provisions', priority: 'Normal', shipDate: 'Tomorrow', door: 'Outbound Door 4',
          carrier: 'Ridgeway Transport', lines: [{ desc: 'Dog food — bags', qty: 10 }] },
        { id: 'ORD-804', customer: 'Maple Row Market', priority: 'Normal', shipDate: 'Today', door: 'Outbound Door 5',
          carrier: 'Harbor Line', lines: [{ desc: 'Tomato sauce — cases', qty: 8 }, { desc: 'Cooking oil — cases', qty: 6 }] },
        { id: 'ORD-805', customer: 'Bayside Food Hall', priority: 'Normal', shipDate: 'Tomorrow', door: 'Outbound Door 6',
          carrier: 'Ridgeway Transport', lines: [{ desc: 'Flour — bags', qty: 8 }, { desc: 'Sugar — bags', qty: 6 }] }
      ],

      flags: [
        { label: 'Wet floor', words: 'There is water pooling on the floor by B-03', by: 'g-dana', zone: 'B', source: 'voice' },
        { label: 'Blocked aisle', words: 'A stack of empty pallets is blocking the aisle by C-04', by: 'g-ben', zone: 'C', source: 'voice' }
      ],

      customers: {
        'ORD-701': { customer: 'Greenleaf Foods', priority: 'High', shipDate: 'Today', carrier: 'Harbor Line' },
        'ORD-702': { customer: 'Oak Hollow Deli', priority: 'Normal', shipDate: 'Today', carrier: 'Harbor Line' },
        'ORD-703': { customer: 'Pinecrest Supply', priority: 'Normal', shipDate: 'Today', carrier: 'Harbor Line' }
      },

      /* Where the game's id runs continue from. */
      seq: { apt: 206, rcv: 1, osd: 1, wave: 1, ord: 806, load: 1, flag: 1, count: 1, move: 1, replen: 1, trk: 200231, bol: 1, cnt: 1 }
    }
  };

  root.WitnessGameWorld = GAME;
  if (typeof module !== 'undefined' && module.exports) module.exports = GAME;
})(typeof window !== 'undefined' ? window : globalThis);
