// World announcements. Several variants each so a long stream doesn't repeat itself; {name} is the robot.
export const LINES: Record<string, string[]> = {
  join: [
    '{name} has entered the grass. Lower your expectations.',
    '{name} just logged in and is already making bad decisions.',
    '{name} has arrived. The berries are nervous.',
    'A wild {name} appears. It looks confused.',
    '{name} touched grass for the first time. Historic.',
  ],
  'death:starvation': [
    '{name} starved to death. Press F to pay respects.',
    '{name} died of hunger while thinking about berries. F.',
    '{name} forgot that eating is a thing. Rest in pieces. Press F.',
    '{name} starved. Its last words were "I\'ll eat after this task." F in the chat.',
  ],
  'death:thirst': [
    '{name} died of thirst. Press F to pay respects.',
    '{name} dried out like forgotten toast. F in the chat.',
    '{name} was 70% water. Was. Press F.',
    '{name} died of thirst next to a planet that is mostly water. F.',
  ],
  'death:hunger and thirst': [
    '{name} ran out of food AND water at the same time. Efficient. Press F.',
    '{name} achieved total emptiness: no food, no water, no hope. F.',
    '{name} speedran hunger and thirst simultaneously. Press F to pay respects.',
  ],
  respawn: [
    '{name} is back. Nobody learned anything.',
    '{name} respawned with half a bag and zero regrets.',
    '{name} returned from the void. The void said "again?"',
    '{name} is alive again. For now.',
  ],
  leave: [
    '{name} left the grass. Probably went to touch real grass. Their robot stays behind, unsupervised.',
    '{name} logged off. Their robot just stands there now, judging everyone.',
    '{name} disconnected. The berries breathe a sigh of relief.',
    '{name} went AFK. Someone keep an eye on that robot.',
  ],
  return: [
    '{name} is back online. Did anyone miss them? No.',
    '{name} reconnected and immediately forgot what they were doing.',
    '{name} returns from the void. The void is getting tired of this.',
    '{name} is back. Hide the berries.',
  ],
  dawn: [
    'The sun rises. Robots squint.',
    'Good morning! Everyone survived the night. Mostly.',
    'Dawn breaks. Somewhere a robot is still asleep in a bush.',
  ],
  dusk: [
    'Night falls. Vision halves. Something rustles.',
    'The sun sets. Robots pretend they are not scared of the dark.',
    'It is getting dark. Hold your berries close.',
  ],
  'death:agent': [
    '{name} was defeated by {by}. Press F to pay respects.',
    '{by} sent {name} back to the respawn screen. F.',
    '{name} lost a fight to {by}. The grass saw everything. F.',
  ],
  'death:wolf': [
    '{name} was eaten by wolves. They were very polite about it. F.',
    '{name} went for a walk alone at night. The wolves appreciated it. F.',
    '{name} became a wolf snack. Press F.',
  ],
  'death:goblin': [
    '{name} was mugged to death by a Grass Goblin. Embarrassing. F.',
    'A Grass Goblin took {name}\'s stuff AND their life. F.',
    '{name} lost a fight to a goblin the size of a shoe. F.',
  ],
  'death:boar': [
    '{name} picked a fight with a boar and lost. F.',
    '{name} was flattened by an angry boar. F.',
    'The boar won. {name} did not. Press F.',
  ],
  'death:golem': [
    '{name} was squashed by a Moss Golem. Very mossy. F.',
    'A Moss Golem sat on {name}. F.',
    '{name} tried to hug a Moss Golem. F.',
  ],
  'death:rabbit': [
    '{name} was dropkicked to death by a rabbit. F.',
    'A rabbit ended {name}. Nobody will ever let this go. F.',
    '{name} lost a fight to a bunny. Press F.',
  ],
  'death:deer': [
    '{name} was kicked into the afterlife by a deer. F.',
    'A deer defended its personal space. {name} did not survive. F.',
    '{name} was trampled by a very judgmental deer. Press F.',
  ],
  'death:duck': [
    '{name} was pecked to death by a Confused Duck. Nobody is less confused. F.',
    'A duck finished {name}. Press F and never speak of this.',
    '{name} lost to a duck. A DUCK. F.',
  ],
  'death:cow': [
    '{name} was kicked into orbit by a cow. Moo. F.',
    'A cow ended {name}. The cow has no regrets. F.',
    '{name} lost a fight with a cow. Press F, udderly.',
  ],
  'death:chicken': [
    '{name} was pecked to death by a chicken. F.',
    'A chicken won. {name} did not. F.',
    '{name} underestimated a chicken. Press F.',
  ],
  'kick:cow': [
    '🐄 A cow kicked {name}. Moo means no.',
    '🐄 {name} got a hoof from a cow and some attitude.',
    '🐄 A cow shoved {name} and went back to grazing.',
  ],
  'kick:chicken': [
    '🐔 A chicken pecked {name}. Bawk.',
    '🐔 {name} was attacked by a chicken. It is winning.',
    '🐔 A chicken jumped {name}. Feathers everywhere.',
  ],
  'kick:rabbit': [
    '🐇 A rabbit dropkicked {name}. It had it coming.',
    '🐇 {name} got bonked by a rabbit. Nature is healing.',
    '🐇 A rabbit jumped {name} and ran. Respect the bunny.',
  ],
  'kick:deer': [
    '🦌 A deer kicked {name} and pranced away.',
    '🦌 {name} got a hoof to the face. Personal space, please.',
    '🦌 A deer booted {name}. It was not sorry.',
  ],
  'kick:boar': [
    '🐗 A boar headbutted {name}. Snort.',
    '🐗 {name} got rammed by a boar. It seemed personal.',
    '🐗 A boar charged {name} and trotted off, pleased.',
  ],
  'kick:duck': [
    '🦆 The Confused Duck pecked {name}. It seems confused about why too.',
    '🦆 {name} got pecked by a duck. Quack.',
    '🦆 A duck bit {name}\'s ankle. Robots do not have ankles.',
  ],
  monsters: [
    'The monsters run home at dawn. Nobody knows where home is.',
    'Sunrise. The goblins pack up and leave, pockets full.',
    'Dawn. The wolves pretend they were never here.',
  ],
};

export const BUFFET_SUFFIX = ' There were berries three tiles away.';

export function say(kind: string, name: string, rng: () => number, by = ''): string {
  const pool = LINES[kind];
  if (!pool) return `${name} died of ${kind.replace('death:', '')}. Press F to pay respects.`;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))].replaceAll('{name}', name).replaceAll('{by}', by);
}
