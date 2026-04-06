/**
 * Unicode character replacement map for spam word fixing.
 * Each ASCII character maps to a visually similar Unicode lookalike.
 * Used to break spam filter pattern matching while keeping emails readable.
 *
 * Ported from: ~/workspace/campaign-creation/shared/references/character-map.md
 */

/** Map of ASCII characters to their Unicode lookalikes */
export const CHAR_REPLACEMENTS: Record<string, string> = {
  // Lowercase letters
  o: '\u03BF', // ο — Greek Small Letter Omicron
  e: '\u0117', // ė — Latin Small Letter E with Dot Above
  a: '\u03B1', // α — Greek Small Letter Alpha
  i: '\uD835\uDD26', // 𝔦 — Mathematical Fraktur Small I (U+1D526)
  s: '\u0455', // ѕ — Cyrillic Small Letter Dze
  u: '\u00F9', // ù — Latin Small Letter U with Grave
  c: '\u010B', // ċ — Latin Small Letter C with Dot Above
  l: '\u0406', // І — Cyrillic Capital Letter Byelorussian-Ukrainian I
  n: '\u0578', // ո — Armenian Small Letter Vo
  t: '\u03C4', // τ — Greek Small Letter Tau

  // Uppercase letters
  O: '\u039F', // Ο — Greek Capital Letter Omicron
  E: '\u0395', // Ε — Greek Capital Letter Epsilon
  A: '\u0391', // Α — Greek Capital Letter Alpha
  S: '\u0405', // Ѕ — Cyrillic Capital Letter Dze
  I: '\u0399', // Ι — Greek Capital Letter Iota
  T: '\u03A4', // Τ — Greek Capital Letter Tau

  // Symbols
  $: '\uFF04', // ＄ — Fullwidth Dollar Sign
  '%': '\uFF05', // ％ — Fullwidth Percent Sign
  '0': '\u03BF', // ο — Greek Small Letter Omicron
  '!': '\u01C3', // ǃ — Latin Letter Alveolar Click
};

/**
 * Priority order for character replacement.
 * Start with the least noticeable replacements (vowels first).
 * When fixing a spam word, try these characters in order and replace only ONE.
 */
export const REPLACEMENT_PRIORITY: string[] = [
  'o', 'e', 'a', 'i', 's', 'O', 'E', 'A', 'S', 'l', 'I',
];
