/* bol-loads.js — FIXTURE DATA for the BOL camera read (slice 3).

   Test Load 001 is a demonstration load, labeled as such. Two things
   are known about it ahead of time:
   - onFile: what its bill of lading says (the BOL is in the system
     before the truck arrives). The printed fixture page,
     test-data/bol-test-load-001.html, shows exactly this.
   - present: what is physically on the pallet — the ground truth
     the read is matched against. 20 pieces claimed, 18 present:
     the cleaner and the aerosol lines are each short one.

   Each line carries `match` words: a line read off the camera is
   paired with a fixture line when its description contains one of
   them. Loaded in the browser (window.WitnessBolLoads) and in node
   (module.exports). */
(function (root) {
  'use strict';

  var loads = [
    {
      id: 'TL-001',
      label: 'Test Load 001',
      onFile: {
        carrier: 'Blue Ridge Freight Lines',
        bolNumber: 'BRFL-TL-001',
        shipper: 'Piedmont Janitorial Supply',
        consignee: 'Witness Demo Warehouse',
        piecesClaimed: 20,
        totalWeightLb: 624
      },
      lines: [
        { key: 'cleaner', name: 'All-purpose cleaner', match: ['cleaner'], claimed: 6, present: 5, weightLb: 216 },
        { key: 'aerosol', name: 'Aerosol air freshener', match: ['aerosol', 'air freshener'], claimed: 4, present: 3, weightLb: 88, un: 'UN1950' },
        { key: 'towels', name: 'Paper towels', match: ['towel'], claimed: 6, present: 6, weightLb: 120 },
        { key: 'soap', name: 'Dish soap', match: ['soap', 'dish'], claimed: 4, present: 4, weightLb: 200 }
      ]
    }
  ];

  var api = {
    loads: loads,
    byId: function (id) {
      for (var i = 0; i < loads.length; i++) if (loads[i].id === id) return loads[i];
      return null;
    }
  };

  root.WitnessBolLoads = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
