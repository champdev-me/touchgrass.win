import { RegExpMatcher, TextCensor, englishDataset, englishRecommendedTransformers } from 'obscenity';

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
const censor = new TextCensor().setStrategy(() => 'grass');
const LINKS = /\b(?:https?:\/\/|www\.)\S+/gi;

export const isRude = (text: string): boolean => matcher.hasMatch(text);

/** Chat-safe text: links removed, rudeness becomes "grass", whitespace collapsed. Length limits are the engine's job. */
export function clean(text: string): string {
  const noLinks = text.replace(LINKS, '[link removed]').replace(/\s+/g, ' ').trim();
  return censor.applyTo(noLinks, matcher.getAllMatches(noLinks, true));
}
