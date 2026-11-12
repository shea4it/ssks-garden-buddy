'use strict';

/* Cute and fun pet names (v0.76.0; v0.77.0 bigger, with ranks).
 *
 * Built for thousands of hatches: 300 general names, plus two-word names
 * ("Sleepy Tofu", "Lil Mochi", "Sir Waffles", "Empress Tofu", "Disco Bean"),
 * about 15,000 in all. The app remembers the last 1,500 names it gave
 * (petNaming.recent in main.js) and never repeats one of those or a name a
 * pet of yours has.
 *
 * Ranks, from the pet's Pet Power at max against your other pets (main.js):
 *   top (your best 10%): grand names (Maximus, Valkyrie, Excalibur) or a
 *     ruler's title (King Biscuit, Empress Tofu);
 *   high (the next 30%): fancy names (Reginald, Clementine) or a noble's
 *     title (Sir Waffles, Duchess Plum);
 *   normal: everyday cute names, now and then "Lil", "Baby", "Uncle"…
 * Gold and Rainbow pets get their own names most of the time ("Midas",
 * "Aurora" for the best of them). Species lists ("Hamlet" for a Pig) show up
 * now and then at any rank.
 *
 * Letters and spaces only, at most 12 characters, so the game's name box
 * takes them. No names of characters from shows, films or games. */

const MAX = 12;

const GENERIC = [
  // Food and sweets
  'Biscuit', 'Mochi', 'Noodle', 'Waffles', 'Pudding', 'Peanut', 'Dumpling', 'Tofu', 'Jellybean', 'Marshmallow',
  'Cupcake', 'Muffin', 'Pancake', 'Tater Tot', 'Gnocchi', 'Nacho', 'Churro', 'Pretzel', 'Bagel', 'Crumpet',
  'Scone', 'Truffle', 'Fudge', 'Toffee', 'Cocoa', 'Latte', 'Sushi', 'Wasabi', 'Kiwi', 'Mango',
  'Peaches', 'Plum', 'Olive', 'Basil', 'Pesto', 'Meatball', 'Cheddar', 'Gouda', 'Pumpkin', 'Jelly',
  'Taffy', 'Gumdrop', 'Lollipop', 'Sugarplum', 'Bonbon', 'Brownie', 'Cookie', 'Cannoli', 'Macaron', 'Eclair',
  'Strudel', 'Tiramisu', 'Sorbet', 'Gelato', 'Custard', 'Praline', 'Nougat', 'Licorice', 'Gingersnap', 'Shortcake',
  'Popcorn', 'Pickle', 'Radish', 'Turnip', 'Parsnip', 'Beetroot', 'Sprout', 'Lentil', 'Chickpea', 'Edamame',
  'Ravioli', 'Rigatoni', 'Linguine', 'Tortilla', 'Burrito', 'Empanada', 'Pierogi', 'Samosa', 'Bao', 'Ramen',
  'Udon', 'Soba', 'Miso', 'Tempura', 'Boba', 'Matcha', 'Chai', 'Espresso', 'Biscotti', 'Crepe',
  'Croissant', 'Baguette', 'Brioche', 'Focaccia', 'Pita', 'Hummus', 'Falafel', 'Kimchi', 'Dango', 'Onigiri',
  'Wonton', 'Almond', 'Pecan', 'Walnut', 'Papaya', 'Guava', 'Lychee', 'Apricot', 'Tangerine', 'Kumquat',
  'Blueberry', 'Raspberry', 'Gooseberry', 'Elderberry', 'Huckleberry', 'Cherry', 'Cheesecake', 'Quesadilla', 'Teriyaki', 'Cobbler',
  // Nature
  'Pebble', 'Button', 'Clover', 'Maple', 'Twig', 'Fern', 'Thistle', 'Bramble', 'Daisy', 'Tulip',
  'Juniper', 'Willow', 'Poppy', 'Acorn', 'Moss', 'Breeze', 'Puddle', 'Drizzle', 'Misty', 'Pinecone',
  'Mushroom', 'Sprig', 'Bluebell', 'Snapdragon', 'Lavender', 'Rosemary', 'Thyme', 'Sage', 'Mint', 'Parsley',
  'Cricket', 'Cobble', 'Meadow', 'Brook', 'River', 'Comet', 'Nova', 'Cosmo', 'Orbit', 'Luna',
  'Stella', 'Starling', 'Sparrow', 'Robin', 'Wren', 'Finch', 'Pippin', 'Hazel', 'Ivy', 'Dewdrop',
  // Personality
  'Doodle', 'Wiggles', 'Zippy', 'Bubbles', 'Sparky', 'Widget', 'Sprocket', 'Pixel', 'Boop', 'Snuggles',
  'Cuddles', 'Fluffy', 'Fuzzy', 'Scruffy', 'Patches', 'Freckles', 'Dottie', 'Dimples', 'Squish', 'Tumbles',
  'Wobble', 'Fizz', 'Beans', 'Tiny', 'Chonk', 'Zoomie', 'Bonkers', 'Goober', 'Rocket', 'Turbo',
  'Giggles', 'Jiggles', 'Smudge', 'Scooter', 'Skipper', 'Scout', 'Mischief', 'Zigzag', 'Pogo', 'Yoyo',
  'Kazoo', 'Banjo', 'Ukulele', 'Tuba', 'Piccolo', 'Bongo', 'Jingles', 'Bubblegum', 'Snooze', 'Napkin',
  'Mittens', 'Socks', 'Slippers', 'Pajamas', 'Blanket', 'Pillow', 'Teacup', 'Thimble', 'Teapot', 'Spoon',
  'Spatula', 'Doorknob', 'Pip', 'Squeaky', 'Fiddlesticks', 'Wiggly', 'Hullabaloo', 'Sniffles', 'Grumbles', 'Sunshine',
  // People's names
  'Mabel', 'Gus', 'Otis', 'Milo', 'Ollie', 'Bruno', 'Rosie', 'Lulu', 'Coco', 'Kiki',
  'Ziggy', 'Gertie', 'Hank', 'Frank', 'Stan', 'Earl', 'Doris', 'Edna', 'Mavis', 'Agnes',
  'Ethel', 'Nellie', 'Winnie', 'Penny', 'Benny', 'Lenny', 'Kevin', 'Steve', 'Dave', 'Linda',
  'Barb', 'Carol', 'Ruby', 'Wally', 'Dolores', 'Norbert', 'Herbert', 'Gilbert', 'Albert', 'Hubert',
  'Chester', 'Murphy', 'Bailey', 'Teddy', 'Freddie', 'Archie', 'Alfie', 'Reggie', 'Ronnie', 'Otto',
  'Hugo', 'Oscar', 'Iggy', 'Mojo', 'Bijou', 'Bob', 'Gladys', 'Ned', 'Mildred', 'Phyllis',
];

// Cute words for two-word names: "Sleepy Tofu", "Cheeky Plum".
const CUTE_ADJ = ['Sleepy', 'Grumpy', 'Fuzzy', 'Fluffy', 'Chunky', 'Snuggly', 'Bouncy', 'Cozy', 'Toasty', 'Spicy',
  'Salty', 'Sweet', 'Zesty', 'Jolly', 'Merry', 'Silly', 'Dizzy', 'Bubbly', 'Speedy', 'Lazy',
  'Cheeky', 'Sassy', 'Peppy', 'Perky', 'Plucky', 'Dapper', 'Brave', 'Mighty', 'Wiggly', 'Squishy',
  'Crispy', 'Fancy', 'Tiny', 'Smol', 'Cuddly', 'Dreamy', 'Breezy', 'Sunny', 'Frosty', 'Misty'];

// Everyday titles: "Lil Mochi", "Uncle Bagel"; and "Mochi Jr".
const LOW_TITLES = ['Lil', 'Tiny', 'Baby', 'Little', 'Wee', 'Mini', 'Big', 'Mama', 'Papa', 'Auntie', 'Uncle', 'Cousin', 'Grandpa', 'Granny'];

// Fancy names and noble titles, for your better pets.
const FANCY = [
  'Reginald', 'Winston', 'Beatrice', 'Penelope', 'Archibald', 'Bartholomew', 'Montgomery', 'Wellington', 'Percival', 'Theodora',
  'Clementine', 'Gwendolyn', 'Cornelius', 'Ignatius', 'Leopold', 'Rosalind', 'Humphrey', 'Wilhelmina', 'Ophelia', 'Florence',
  'Mortimer', 'Ambrose', 'Barnaby', 'Cecily', 'Dorothea', 'Ezekiel', 'Fitzgerald', 'Gertrude', 'Horatio', 'Isadora',
  'Jasper', 'Lavinia', 'Marmaduke', 'Octavia', 'Prudence', 'Quentin', 'Rupert', 'Sebastian', 'Tabitha', 'Ulysses',
  'Vivienne', 'Winifred', 'Xavier', 'Yolanda', 'Zebediah', 'Algernon', 'Benedict', 'Cordelia', 'Desmond', 'Esmeralda',
  'Felix', 'Geraldine', 'Harriet', 'Imogen', 'Jemima', 'Lysander', 'Maximilian', 'Nigel', 'Oswald', 'Philippa',
];
const MID_TITLES = ['Sir', 'Lady', 'Lord', 'Duke', 'Duchess', 'Baron', 'Baroness', 'Count', 'Countess', 'Captain', 'Mister', 'Miss', 'Madame', 'Major', 'Doctor', 'Judge', 'Mayor', 'Admiral', 'Colonel', 'Dame'];

// Grand names and rulers' titles, for your very best.
const GRAND = [
  'Maximus', 'Titan', 'Majesty', 'Valor', 'Legend', 'Sovereign', 'Champion', 'Paragon', 'Zenith', 'Apex',
  'Monarch', 'Aurelius', 'Augustus', 'Excalibur', 'Avalon', 'Odyssey', 'Supernova', 'Galaxy', 'Nebula', 'Eclipse',
  'Tempest', 'Sir Lancelot', 'Merlin', 'Atlas', 'Orion', 'Apollo', 'Athena', 'Artemis', 'Hercules', 'Zeus',
  'Odin', 'Freya', 'Valkyrie', 'Pegasus', 'Leviathan', 'Colossus', 'Behemoth', 'Goliath', 'Lionheart', 'Cosmos',
  'Infinity', 'Quasar', 'Pulsar', 'Astra', 'Magnus', 'Regis', 'Rex', 'Kaiser', 'Pharaoh', 'Majestic',
  'Imperator', 'Overlord', 'Archmage', 'Highness', 'Glory', 'Triumph', 'Victory', 'Fortune', 'Destiny', 'Starfall',
];
const GRAND_TITLES = ['King', 'Queen', 'Emperor', 'Empress', 'Prince', 'Princess', 'Kaiser', 'Czar', 'Sultan', 'General', 'Archduke', 'Pharaoh', 'Overlord'];

// By species, as the game names them (lower case, letters only).
const BY_SPECIES = {
  bat: ['Batty', 'Echo', 'Midnight', 'Fang', 'Belfry', 'Shadow', 'Flappy', 'Batsy', 'Duskie', 'Nocturne'],
  bee: ['Buzz', 'Bumble', 'Honey', 'Queenie', 'Stinger', 'Nectar', 'Buzzby', 'Beeatrice', 'Pollen', 'Bumbles'],
  bunny: ['Hopscotch', 'Binky', 'Bun Bun', 'Carrot Cake', 'Hoppy', 'Flopsy', 'Mopsy', 'Cottontail', 'Dust Bunny', 'Clover'],
  butterfly: ['Flutter', 'Monarch', 'Papillon', 'Twinkle', 'Glimmer', 'Petal', 'Blossom', 'Wings', 'Sunbeam', 'Flitter'],
  capybara: ['Capy', 'Capybarbara', 'Mellow', 'Zen', 'Bara', 'Coconut', 'Hot Tub', 'Chillbara', 'Snoozy', 'Chill Pill'],
  caribou: ['Dasher', 'Prancer', 'Blitzen', 'Snowflake', 'Antlers', 'Fawnsworth', 'Doughnut', 'Tundra', 'North Star', 'Jingle'],
  chicken: ['Nugget', 'Henrietta', 'Eggbert', 'Clucky', 'Peep', 'Sunny Side', 'Drumstick', 'Omelet', 'Pecky', 'Scramble'],
  cow: ['Bessie', 'Buttercup', 'Milkshake', 'Mooney', 'Moozart', 'Daisy Moo', 'Moosie', 'Marshmoolow', 'Cocoa Moo', 'Clover'],
  dragonfly: ['Zippy', 'Darter', 'Glint', 'Hover', 'Skimmer', 'Dash', 'Zinger', 'Whirly', 'Jet', 'Blue'],
  firehorse: ['Blaze', 'Ember', 'Cinder', 'Scorch', 'Sparks', 'Flicker', 'Wildfire', 'Kindling', 'Torch', 'Smolder'],
  goat: ['Gruff', 'Goatee', 'Pepper', 'Bleatrice', 'Clove', 'Scamper', 'Billy', 'Tumbleweed', 'Nibbler', 'Rascal'],
  horse: ['Clippity', 'Hoofer', 'Mane Event', 'Gallop', 'Trotter', 'Buttons', 'Chestnut', 'Oats', 'Haystack', 'Sugar Cube'],
  moth: ['Dusty', 'Lampy', 'Moonbeam', 'Lantern', 'Velvet', 'Fuzzwing', 'Mothball', 'Nightlight', 'Wool', 'Porch Light'],
  ostrich: ['Stretch', 'Legs', 'Dash', 'Feathers', 'Hot Rod', 'Gigi', 'Speedster', 'Noodle Neck', 'Zoom', 'Sprint'],
  peacock: ['Fancy', 'Strutter', 'Showoff', 'Sapphire', 'Plume', 'Duchess', 'Pavo', 'Glamour', 'Dazzle', 'Jewel'],
  phoenix: ['Ash', 'Ember', 'Sunny', 'Flare', 'Firecracker', 'Torchy', 'Sizzle', 'Inferno', 'Solstice', 'Cinders'],
  pig: ['Hamlet', 'Porkchop', 'Truffles', 'Oinkers', 'Penelope', 'Sir Oinks', 'Mud Pie', 'Snoutie', 'Pigsley', 'Sir Hamalot'],
  platypus: ['Puddles', 'Duckbill', 'Paddles', 'Platty', 'Plato', 'Oddball', 'Splash', 'Webster', 'Squeegee', 'Ploop'],
  redfox: ['Rusty', 'Kit', 'Maple', 'Reynard', 'Pumpkin', 'Cinnamon', 'Paprika', 'Ginger', 'Foxglove', 'Marmalade'],
  rooster: ['Crowsalot', 'Dawn Patrol', 'Alarm Clock', 'Big Red', 'Cornelius', 'Kernel', 'Strut', 'Sunrise', 'Sir Crows', 'Reveille'],
  sheep: ['Woolly', 'Fleece', 'Baabara', 'Cotton', 'Dolly', 'Wooliam', 'Cloud', 'Lambkin', 'Sweater', 'Puffball'],
  snail: ['Shelly', 'Escargot', 'Speedy', 'Sir Slime', 'Trailblazer', 'Shellby', 'Snailey', 'Glider', 'Swirl', 'Zoomer'],
  snake: ['Nope Rope', 'Hiss', 'Sssam', 'Monty', 'Slither', 'Scales', 'Hissy', 'Spaghetti', 'Bowtie', 'Squiggle'],
  snowfox: ['Frost', 'Blizzard', 'Snowball', 'Flurry', 'Icicle', 'Winter', 'Snowdrop', 'Pearl', 'Frostbite', 'Powder'],
  squirrel: ['Nutmeg', 'Acorn', 'Hazelnut', 'Chestnut', 'Nutters', 'Cheeks', 'Pistachio', 'Twitch', 'Scurry', 'Cashew'],
  stoat: ['Ermine', 'Scamp', 'Stoaty', 'Snowcap', 'Flash', 'Bandit', 'Whisk', 'Tiptoe', 'Slink', 'Pounce'],
  thunderwolf: ['Howler', 'Thunder', 'Storm', 'Zap', 'Volt', 'Static', 'Moondog', 'Rumble', 'Thunderpaw', 'Stormy'],
  toad: ['Toadstool', 'Wartholomew', 'Croaky', 'Lily Pad', 'Ribbit', 'Mister Toad', 'Bumpy', 'Gumbo', 'Sir Croaks', 'Mudpuddle'],
  turkey: ['Gobbles', 'Gobbler', 'Tom', 'Stuffing', 'Cranberry', 'Gravy', 'Wattles', 'Drumstick', 'Sir Gobble', 'Butterbean'],
  turtle: ['Shelldon', 'Tank', 'Myrtle', 'Mossback', 'Toby', 'Pokey', 'Slowmo', 'Tortellini', 'Shellington', 'Boulder'],
  worm: ['Squirmy', 'Wormy', 'Sir Wiggle', 'Gummy', 'Dirt Diva', 'Wiggly', 'Inchy', 'Loopy', 'Mudslinger', 'Burrow'],
};

// Other names the game uses for the same animals.
const ALIASES = { whitecaribou: 'caribou', pony: 'horse', rabbit: 'bunny', ewe: 'sheep', wolf: 'thunderwolf', fox: 'redfox' };

// Gold and Rainbow pets: their own names, an adjective with a short name
// ("Golden Pip", "Disco Bean"), and grand ones for the best of them.
const BY_MUTATION = {
  gold: {
    names: ['Goldie', 'Nugget', 'Midas', 'Bullion', 'Doubloon', 'Goldilocks', 'Butterscotch', 'Marigold', 'Treasure', 'Jackpot',
      'Bling', 'Karat', 'Sunny', 'Honeycomb', 'Gilded', 'Sunflower', 'Dandelion', 'Saffron', 'Topaz', 'Brass',
      'Ducat', 'Florin', 'Guinea', 'Shilling', 'Coin', 'Lucky', 'Honeybun', 'Mustard', 'Lemon Drop', 'Goldfinch',
      'Sunbeam', 'Trophy', 'Medal', 'Buttercup', 'Pineapple'],
    adjectives: ['Golden', 'Gilded', 'Lucky', 'Shiny', 'Sunny', 'Honey', 'Gold'],
    grand: ['Midas', 'El Dorado', 'Sun King', 'Gold Rush', 'Fort Knox', 'Solid Gold', 'Crown Jewel', 'Royal Mint', 'Aureus', 'Sovereign',
      'Treasury', 'Mother Lode', 'Golden Age', 'Goldheart', 'Bonanza'],
  },
  rainbow: {
    names: ['Prism', 'Spectrum', 'Kaleido', 'Sherbet', 'Confetti', 'Sprinkles', 'Opal', 'Aurora', 'Iris', 'Glitter',
      'Disco', 'Holo', 'Shimmer', 'Rainbow', 'Starlight', 'Pastel', 'Neon', 'Sparkle', 'Twinkle', 'Lolly',
      'Unicorn', 'Candy', 'Gumball', 'Tutti Frutti', 'Mosaic', 'Patchwork', 'Tie Dye', 'Crayon', 'Marbles', 'Pinwheel',
      'Kite', 'Fireworks', 'Spumoni', 'Fiesta', 'Party'],
    adjectives: ['Rainbow', 'Sparkle', 'Disco', 'Glitter', 'Prism', 'Pastel', 'Neon', 'Shimmer', 'Twinkle'],
    grand: ['Aurora', 'Spectra', 'Kaleidoscope', 'Prismatic', 'Borealis', 'Iridescent', 'Opalescent', 'Chromatic', 'Celestial', 'Starlight',
      'Supernova', 'Polaris', 'Halo', 'Radiance', 'Luminous'],
  },
};

const norm = (x) => String(x == null ? '' : x).toLowerCase().replace(/[^a-z0-9]/g, '');
// Short names that leave room for a title.
const SHORT = GENERIC.filter((n) => n.length <= 7 && !/ /.test(n));

// pick(pet, opts): pet { species, mutations }; opts { tier: 'top' | 'high'
// | 'normal', taken: names to avoid (your pets' names, the ones given
// lately), rand }. Always returns a name nobody in `taken` has.
function pick(pet, opts) {
  const o = opts || {};
  const r = typeof o.rand === 'function' ? o.rand : Math.random;
  const avoid = new Set((o.taken || []).map(norm));
  const one = (list) => list[Math.floor(r() * list.length)];
  const titled = (titles) => {
    for (let i = 0; i < 12; i += 1) {
      const n = `${one(titles)} ${one(SHORT)}`;
      if (n.length <= MAX) return n;
    }
    return null;
  };
  const sp = norm(pet && pet.species);
  const species = BY_SPECIES[ALIASES[sp] || sp];
  const muts = ((pet && pet.mutations) || []).map(norm);
  const mut = muts.includes('rainbow') ? 'rainbow' : muts.includes('gold') ? 'gold' : null;
  const tier = o.tier === 'top' || o.tier === 'high' ? o.tier : 'normal';

  // Where to look, in order: each a way of making a candidate.
  const ways = [];
  if (mut && r() < 0.75) {
    const M = BY_MUTATION[mut];
    ways.push(() => (tier === 'top' && r() < 0.6 ? one(M.grand) : r() < 0.6 ? one(M.names) : titled(M.adjectives)));
  }
  if (tier === 'top' && r() < 0.85) ways.push(() => (r() < 0.55 ? one(GRAND) : titled(GRAND_TITLES)));
  if (tier === 'high' && r() < 0.7) ways.push(() => (r() < 0.5 ? one(FANCY) : titled(MID_TITLES)));
  if (species && r() < 0.35) ways.push(() => one(species));
  ways.push(() => {
    const x = r();
    if (x < 0.5) return one(GENERIC);
    if (x < 0.75) return titled(CUTE_ADJ);
    if (x < 0.95) return titled(LOW_TITLES);
    return `${one(SHORT)} Jr`;
  });
  for (const make of ways) {
    for (let i = 0; i < 40; i += 1) {
      const n = make();
      if (n && n.length <= MAX && !avoid.has(norm(n))) return n;
    }
  }
  // Nearly everything's been used: the first free one anywhere, then a
  // general name with a number after it.
  for (const list of [GENERIC, FANCY, species || [], GRAND]) {
    const free = list.filter((n) => !avoid.has(norm(n)));
    if (free.length) return one(free);
  }
  for (const t of CUTE_ADJ.concat(LOW_TITLES, MID_TITLES)) {
    for (const b of SHORT) {
      const n = `${t} ${b}`;
      if (n.length <= MAX && !avoid.has(norm(n))) return n;
    }
  }
  const base = one(SHORT);
  for (let k = 2; k < 100000; k += 1) if (!avoid.has(norm(`${base} ${k}`))) return `${base} ${k}`;
  return base;
}

// How many different names there are, roughly (for the docs and the test).
function poolSize() {
  const all = new Set(GENERIC.concat(FANCY, GRAND, ...Object.values(BY_SPECIES)).map(norm));
  for (const M of Object.values(BY_MUTATION)) for (const n of M.names.concat(M.grand)) all.add(norm(n));
  const titles = CUTE_ADJ.concat(LOW_TITLES, MID_TITLES, GRAND_TITLES, BY_MUTATION.gold.adjectives, BY_MUTATION.rainbow.adjectives);
  for (const t of titles) for (const b of SHORT) if (`${t} ${b}`.length <= MAX) all.add(norm(`${t} ${b}`));
  for (const b of SHORT) all.add(norm(`${b} Jr`));
  return all.size;
}

module.exports = { MAX, GENERIC, CUTE_ADJ, LOW_TITLES, FANCY, MID_TITLES, GRAND, GRAND_TITLES, BY_SPECIES, ALIASES, BY_MUTATION, SHORT, pick, poolSize, norm };
