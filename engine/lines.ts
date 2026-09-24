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
};

export const BUFFET_SUFFIX = ' There were berries three tiles away.';

export function say(kind: string, name: string, rng: () => number): string {
  const pool = LINES[kind];
  if (!pool) return `${name} died of ${kind.replace('death:', '')}. Press F to pay respects.`;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))].replaceAll('{name}', name);
}
