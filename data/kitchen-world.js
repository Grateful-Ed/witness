/* =====================================================================
   kitchen-world.js — the demo's home-scale warehouse, as data.

   William's demo-video ruling (2026-11-01): no warehouse to film in,
   so the video runs at home. Groceries land on the Counter (the one
   staging door), storage spots are labeled like bins, and William is
   the labor unit. Same shape as data/world.js, so the same engine
   runs it.

   The world starts with an EMPTY counter and NO inbound shipment. The
   shipment exists only after a receipt scan creates it (js/kitchen.js)
   — the scan is the intake; nothing is pre-loaded.

   destinationRules is master data, like a warehouse's fixed-bin
   table: exact item rules win first, then product-type rules, in the
   order listed. Faye extends it with William's real items during demo
   prep — add a line, nothing else changes. Matching is on whole words,
   case-insensitive, against the item's name as read.

   Loaded two ways: in the browser it sets window.WitnessKitchenSeed;
   in node it is module.exports. js/world-select.js decides which seed
   the engine gets.
   ===================================================================== */
(function (root) {
  'use strict';

  var SEED = {

    /* Which world this state belongs to. data/world.js carries no
       marker; no marker means the warehouse. */
    world: 'kitchen',

    /* One staging door: the Counter. Groceries land there. */
    doors: [
      { id: 'Counter', zone: 'Kitchen', state: 'empty', shipmentId: null }
    ],

    zones: ['Kitchen'],

    /* The storage spots. mixed: a spot that holds many different
       items at once (a fridge is not a one-item pallet slot), so
       already holding stock does not make it "occupied" for the
       home-bin rule. */
    bins: [
      { id: 'Cabinet A', zone: 'Kitchen', status: 'ok', mixed: true, contents: [] },
      { id: 'Cabinet B', zone: 'Kitchen', status: 'ok', mixed: true, contents: [] },
      { id: 'Pantry', zone: 'Kitchen', status: 'ok', mixed: true, contents: [] },
      { id: 'Fridge', zone: 'Kitchen', status: 'ok', mixed: true, contents: [] },
      { id: 'Freezer', zone: 'Kitchen', status: 'ok', mixed: true, contents: [] }
    ],

    /* The counter starts empty. */
    staging: [],

    /* William is the worker; he picks himself on the glasses start
       screen. */
    labor: [
      { id: 'u-william', name: 'William', role: 'worker', zone: 'Kitchen', currentTaskId: null }
    ],

    /* No inbound shipment. The receipt scan creates it. */
    inbound: [],
    outbound: [],

    /* Where an item goes. exact first (whole-word match on the item
       name), then types in order — the first type with a matching
       word decides. Order matters: "frozen chicken" must hit frozen
       before fresh meat. */
    destinationRules: {
      exact: [
        { match: 'milk', spot: 'Fridge' },
        { match: 'ice cream', spot: 'Freezer' },
        { match: 'bananas', spot: 'Cabinet A' },
        { match: 'banana', spot: 'Cabinet A' },
        { match: 'potatoes', spot: 'Pantry' },
        { match: 'onions', spot: 'Pantry' },
        { match: 'peanut butter', spot: 'Pantry' }
      ],
      types: [
        { type: 'frozen', spot: 'Freezer',
          words: ['frozen', 'ice cream', 'popsicle', 'popsicles', 'ice pops', 'pizza rolls', 'waffles frozen', 'tv dinner'] },
        { type: 'household', spot: 'Cabinet B',
          words: ['paper towel', 'paper towels', 'toilet paper', 'bath tissue', 'tissue', 'tissues', 'napkins',
                  'detergent', 'soap', 'dish soap', 'cleaner', 'cleaning', 'spray', 'bleach', 'wipes', 'sponge',
                  'sponges', 'trash bags', 'garbage bags', 'foil', 'aluminum foil', 'plastic wrap', 'zip bags',
                  'batteries', 'light bulb', 'dishwasher', 'laundry', 'fabric softener'] },
        { type: 'refrigerated', spot: 'Fridge',
          words: ['dairy', 'cheese', 'yogurt', 'yoghurt', 'butter', 'cream', 'sour cream', 'cream cheese',
                  'eggs', 'egg', 'deli', 'ham', 'turkey', 'salami', 'chicken', 'beef', 'ground beef', 'pork',
                  'steak', 'bacon', 'sausage', 'hot dogs', 'fish', 'salmon', 'shrimp', 'tofu', 'hummus',
                  'juice', 'orange juice', 'creamer', 'refrigerated'] },
        { type: 'produce', spot: 'Fridge',
          words: ['produce', 'lettuce', 'salad', 'spinach', 'kale', 'broccoli', 'carrots', 'carrot', 'celery',
                  'cucumber', 'peppers', 'pepper', 'tomatoes', 'tomato', 'apples', 'apple', 'grapes', 'berries',
                  'strawberries', 'blueberries', 'raspberries', 'lemons', 'limes', 'oranges', 'avocado',
                  'avocados', 'mushrooms', 'zucchini', 'herbs', 'cilantro', 'parsley'] },
        { type: 'bakery-snacks-coffee', spot: 'Cabinet A',
          words: ['bread', 'bakery', 'bagels', 'bagel', 'buns', 'rolls', 'tortillas', 'muffins', 'croissants',
                  'chips', 'crackers', 'cookies', 'pretzels', 'popcorn', 'snack', 'snacks', 'granola bars',
                  'candy', 'chocolate', 'nuts', 'coffee', 'tea'] },
        { type: 'dry-goods', spot: 'Pantry',
          words: ['pasta', 'spaghetti', 'macaroni', 'noodles', 'rice', 'cereal', 'oats', 'oatmeal', 'flour',
                  'sugar', 'beans', 'canned', 'can', 'cans', 'soup', 'broth', 'sauce', 'jar', 'jarred', 'salsa',
                  'oil', 'vinegar', 'spices', 'salt', 'honey', 'jam', 'jelly', 'syrup', 'tuna', 'lentils',
                  'quinoa', 'baking'] }
      ],
      /* The words the read may use for an item no rule covers (META
         classifies from the name), and the spot each one means. */
      metaTypes: {
        'frozen': 'Freezer',
        'refrigerated': 'Fridge',
        'produce': 'Fridge',
        'dry-goods': 'Pantry',
        'bakery-snacks-coffee': 'Cabinet A',
        'household': 'Cabinet B'
      }
    },

    tasks: [],
    records: []
  };

  root.WitnessKitchenSeed = SEED;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SEED;
  }
})(typeof window !== 'undefined' ? window : globalThis);
