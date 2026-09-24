// Gamer-tag style usernames for example robots: "mossy_otter", "Kai_2k", "pixelnoodle77".
const FIRST = ['mossy', 'sleepy', 'crispy', 'lazy', 'salty', 'feral', 'cozy', 'tiny', 'grumpy', 'sneaky', 'spicy', 'rusty', 'soggy', 'wild', 'chunky', 'lucky'];
const SECOND = ['otter', 'noodle', 'toast', 'pigeon', 'goblin', 'pickle', 'badger', 'waffle', 'raccoon', 'potato', 'moth', 'yeti', 'frog', 'biscuit', 'gecko', 'bean'];
const HUMAN = ['kai', 'maya', 'leo', 'nina', 'omar', 'zoe', 'raj', 'ivy', 'sam', 'luca', 'aria', 'dev', 'mila', 'theo', 'priya', 'jonas'];

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

/** A random human-looking username, 3-24 characters of letters, digits and _. */
export function username(): string {
  const n = Math.floor(Math.random() * 100);
  const styles = [
    () => `${pick(FIRST)}_${pick(SECOND)}`,
    () => `${pick(FIRST)}${pick(SECOND)}${n}`,
    () => `${pick(HUMAN)}_${pick(SECOND)}`,
    () => `${pick(HUMAN)}${n}`,
    () => `xx${pick(SECOND)}xx`,
    () => `${pick(HUMAN)}_the_${pick(SECOND)}`,
  ];
  return pick(styles)().slice(0, 24);
}

if (import.meta.main) console.log(username()); // bun examples/names.ts
