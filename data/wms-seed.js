/* =====================================================================
   wms-seed.js — the WMS layer for the demo warehouse, as data.

   data/world.js stays the building (doors, bins, labor, inbound,
   outbound). This file is only what a full WMS adds on top of it:
   the item master, dock appointments, pick-face min/max slots,
   customer orders not yet released to the floor, and the file copy
   of each inbound bill of lading where world.js has none.

   js/wms.js merges this into live state (state.wms + fills). Nothing
   here is ever mutated directly. Loaded in the browser
   (window.WitnessWmsSeed) and in node (module.exports).
   ===================================================================== */
(function (root) {
  'use strict';

  var SEED = {

    /* Item master. Keyed by the description the building already
       uses, so the engine's bins and the WMS agree on what an item
       is. caseLb is a shipping weight per case or bag. */
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
      'Cereal — cases':            { sku: 'CRL-1418', uom: 'case', caseLb: 14 }
    },

    /* Dock appointments. day is 'Today' or 'Tomorrow'; times are
       24-hour HH:MM. IN-1001 is already at Door 1 (checked in). */
    appointments: [
      { id: 'APT-101', shipmentId: 'IN-1001', door: 'Door 1', day: 'Today', start: '06:00', end: '07:30',
        carrier: 'Blue Ridge Freight Lines', trailer: 'BRF-5521', status: 'checked in' },
      { id: 'APT-102', shipmentId: 'IN-1002', door: 'Door 3', day: 'Today', start: '10:00', end: '11:30',
        carrier: 'Southeast Line', trailer: 'SEL-2208', status: 'scheduled' },
      { id: 'APT-103', shipmentId: 'IN-1003', door: 'Door 2', day: 'Tomorrow', start: '07:00', end: '08:30',
        carrier: 'Blue Ridge Freight Lines', trailer: 'BRF-5610', status: 'scheduled' }
    ],

    /* The file copy of each BOL, for shipments world.js carries none
       for. Same shape the dock-scan work uses, so either source reads
       the same. Filled only where a shipment has no bol already. */
    bols: {
      'IN-1001': { bolNumber: 'BRFL-1001', carrier: 'Blue Ridge Freight Lines', shipper: 'Orchard Valley Canning',
        consignee: 'Witness Demo Warehouse', piecesClaimed: 240, totalWeightLb: 7200 },
      'IN-1002': { bolNumber: 'SEL-1002', carrier: 'Southeast Line', shipper: 'Carolina Household Co.',
        consignee: 'Witness Demo Warehouse', piecesClaimed: 240, totalWeightLb: 4440 },
      'IN-1003': { bolNumber: 'BRFL-1003', carrier: 'Blue Ridge Freight Lines', shipper: 'Piedmont Paper Mills',
        consignee: 'Witness Demo Warehouse', piecesClaimed: 192, totalWeightLb: 2304 }
    },

    /* Pick faces with min/max. When a face drops below min, a
       replenishment task brings it back toward max from reserve
       stock of the same item in any other usable bin. */
    slots: [
      { binId: 'A-08', desc: 'Bottled water — cases', min: 30, max: 60 },
      { binId: 'B-04', desc: 'Rice — bags', min: 25, max: 40 },
      { binId: 'C-02', desc: 'Green beans — cases', min: 20, max: 40 }
    ],

    /* Customer orders, entered but not yet released to the floor.
       Releasing a wave moves them into outbound, where allocation
       reserves real stock and picks are generated. The seeded
       outbound orders (ORD-501..503) are wave W-000, already out. */
    orders: [
      { id: 'ORD-601', customer: 'Harbor Street Market', priority: 'High', shipDate: 'Today', door: 'Door 4',
        carrier: 'Coastal Express', lines: [{ desc: 'Canned peaches — cases', qty: 20 }, { desc: 'Pasta — cases', qty: 6 }] },
      { id: 'ORD-602', customer: 'Northside Pantry Co-op', priority: 'Normal', shipDate: 'Today', door: 'Door 4',
        carrier: 'Coastal Express', lines: [{ desc: 'Coffee — cases', qty: 4 }, { desc: 'Tea — cases', qty: 5 }] },
      { id: 'ORD-603', customer: 'Lakeview Grocers', priority: 'Normal', shipDate: 'Tomorrow', door: 'Door 4',
        carrier: 'Piedmont Haulers', lines: [{ desc: 'Dog food — bags', qty: 10 }] }
    ],

    customers: {
      'ORD-501': { customer: 'Riverside Foods', priority: 'High', shipDate: 'Today', carrier: 'Coastal Express' },
      'ORD-502': { customer: 'Elm Street Deli', priority: 'Normal', shipDate: 'Today', carrier: 'Coastal Express' },
      'ORD-503': { customer: 'Summit Supply', priority: 'Normal', shipDate: 'Today', carrier: 'Coastal Express' }
    }
  };

  root.WitnessWmsSeed = SEED;
  if (typeof module !== 'undefined' && module.exports) module.exports = SEED;
})(typeof window !== 'undefined' ? window : globalThis);
