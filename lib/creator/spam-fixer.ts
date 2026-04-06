/**
 * Spam word fixer — replaces ONE character per spam word with a Unicode lookalike
 * to bypass spam filters while keeping emails visually identical.
 *
 * Ported from: ~/workspace/campaign-creation/shared/scripts/fix_spam.py
 *
 * Key rules:
 * - Replace only ONE character per spam word occurrence (sufficient to bypass filters)
 * - Priority order: o→ο, e→ė, a→α, i→𝔦, s→ѕ (least noticeable first)
 * - Always replace $ → ＄ and % → ％
 * - NEVER corrupt {{firstName}}, {{companyName}}, or {{custom var}} tokens
 * - Handle spintax: apply fixes to all options in {{RANDOM | ... }} blocks
 */

import { CHAR_REPLACEMENTS, REPLACEMENT_PRIORITY } from './char-map';

export interface SpamFixResult {
  /** The text with spam words fixed */
  fixedText: string;
  /** List of changes made */
  changes: Array<{
    word: string;
    original: string;
    replacement: string;
  }>;
  /** Number of words fixed */
  wordsFixed: number;
}

/**
 * Replace ONE character in a word with a Unicode lookalike.
 * Returns the modified word and the character change description.
 */
function replaceCharInWord(word: string): { result: string; change: string | null } {
  const chars = Array.from(word); // handle multi-byte chars correctly

  // Try priority characters first (most visually similar)
  for (const priorityChar of REPLACEMENT_PRIORITY) {
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === priorityChar && CHAR_REPLACEMENTS[priorityChar]) {
        const original = chars[i];
        chars[i] = CHAR_REPLACEMENTS[priorityChar];
        return {
          result: chars.join(''),
          change: `'${original}' → '${CHAR_REPLACEMENTS[priorityChar]}'`,
        };
      }
    }
  }

  // Fallback: try any available character replacement
  for (let i = 0; i < chars.length; i++) {
    if (CHAR_REPLACEMENTS[chars[i]]) {
      const original = chars[i];
      chars[i] = CHAR_REPLACEMENTS[chars[i]];
      return {
        result: chars.join(''),
        change: `'${original}' → '${chars[i]}'`,
      };
    }
  }

  return { result: word, change: null };
}

/**
 * Fix spam words in text by applying Unicode character replacements.
 *
 * @param text - The email text to fix
 * @param spamWords - Array of spam word strings to fix
 * @returns SpamFixResult with fixed text, changes made, and count
 */
export function fixSpam(text: string, spamWords: string[]): SpamFixResult {
  const result: SpamFixResult = {
    fixedText: text,
    changes: [],
    wordsFixed: 0,
  };

  let fixedText = text;

  // Step 1: Protect {{variable name}} tokens by replacing them with placeholders
  // Matches space-separated vars like {{first name}} and camelCase like {{accountSignature}}
  // but NOT spintax blocks which contain pipes: {{RANDOM | ... }}
  const variablePattern = /\{\{([^}|]+?)\}\}/g;
  const variables: Array<{ placeholder: string; original: string }> = [];
  let varIndex = 0;

  fixedText = fixedText.replace(variablePattern, (match) => {
    const placeholder = `\x00VAR${varIndex}\x00`;
    variables.push({ placeholder, original: match });
    varIndex++;
    return placeholder;
  });

  // Step 2: Protect spintax structure markers but process content within
  // We handle spintax by finding {{RANDOM | ... }} blocks and processing
  // each option inside them separately
  const spintaxPattern = /\{\{RANDOM\s*\|(.*?)\}\}/gi;
  const spintaxBlocks: Array<{
    placeholder: string;
    fullMatch: string;
    options: string[];
  }> = [];
  let spintaxIndex = 0;

  fixedText = fixedText.replace(spintaxPattern, (fullMatch, content: string) => {
    const placeholder = `\x00SPINTAX${spintaxIndex}\x00`;
    // Split options by | but respect nested braces
    const options = splitSpintaxOptions(content);
    spintaxBlocks.push({ placeholder, fullMatch, options });
    spintaxIndex++;
    return placeholder;
  });

  // Step 3: Always replace $ and % symbols (common spam triggers)
  if (fixedText.includes('$')) {
    const count = (fixedText.match(/\$/g) || []).length;
    fixedText = fixedText.replace(/\$/g, CHAR_REPLACEMENTS['$']);
    result.changes.push({
      word: '$',
      original: '$',
      replacement: `${CHAR_REPLACEMENTS['$']} (${count}x)`,
    });
    result.wordsFixed += count;
  }

  if (fixedText.includes('%')) {
    const count = (fixedText.match(/%/g) || []).length;
    fixedText = fixedText.replace(/%/g, CHAR_REPLACEMENTS['%']);
    result.changes.push({
      word: '%',
      original: '%',
      replacement: `${CHAR_REPLACEMENTS['%']} (${count}x)`,
    });
    result.wordsFixed += count;
  }

  // Step 4: Fix spam words in the main text
  if (spamWords.length > 0) {
    // Deduplicate and sort by length (shortest first so individual words get fixed
    // even when part of longer phrases)
    const seen = new Set<string>();
    const uniqueWords: string[] = [];
    for (const w of spamWords) {
      const lower = w.toLowerCase();
      if (lower && !seen.has(lower)) {
        seen.add(lower);
        uniqueWords.push(w);
      }
    }
    uniqueWords.sort((a, b) => a.length - b.length);

    // Track modified positions to avoid double-fixing
    const modifiedPositions = new Set<number>();

    for (const word of uniqueWords) {
      if (!word || word.length < 2) continue;

      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\b${escaped}\\b`, 'gi');

      // Find all matches (iterate in reverse to preserve positions)
      const matches: Array<{ start: number; end: number; text: string }> = [];
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(fixedText)) !== null) {
        matches.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
      }

      for (const m of matches.reverse()) {
        // Check for overlap with already-modified positions
        let hasOverlap = false;
        for (let pos = m.start; pos < m.end; pos++) {
          if (modifiedPositions.has(pos)) {
            hasOverlap = true;
            break;
          }
        }
        if (hasOverlap) continue;

        const { result: fixedWord, change } = replaceCharInWord(m.text);
        if (fixedWord !== m.text && change) {
          fixedText = fixedText.substring(0, m.start) + fixedWord + fixedText.substring(m.end);

          // Mark positions as modified
          for (let pos = m.start; pos < m.start + fixedWord.length; pos++) {
            modifiedPositions.add(pos);
          }

          result.changes.push({
            word,
            original: m.text,
            replacement: fixedWord,
          });
          result.wordsFixed++;
        }
      }
    }
  }

  // Step 5: Process spintax blocks — apply same fixes to each option
  for (const block of spintaxBlocks) {
    const fixedOptions = block.options.map((option) => {
      const optionResult = fixSpam(option.trim(), spamWords);
      // Merge changes from spintax options (but don't double-count wordsFixed
      // since we already count the main text fixes)
      for (const change of optionResult.changes) {
        // Only add if not already recorded
        const alreadyRecorded = result.changes.some(
          (c) => c.original === change.original && c.replacement === change.replacement
        );
        if (!alreadyRecorded) {
          result.changes.push(change);
          result.wordsFixed++;
        }
      }
      return optionResult.fixedText;
    });

    const reconstructed = `{{RANDOM | ${fixedOptions.join(' | ')}}}`;
    fixedText = fixedText.replace(block.placeholder, reconstructed);
  }

  // Step 6: Restore variable placeholders
  for (const v of variables) {
    fixedText = fixedText.replace(v.placeholder, v.original);
  }

  result.fixedText = fixedText;
  return result;
}

/**
 * Split spintax content by | respecting nested braces.
 */
function splitSpintaxOptions(content: string): string[] {
  const options: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of content) {
    if (char === '{') {
      depth++;
      current += char;
    } else if (char === '}') {
      depth--;
      current += char;
    } else if (char === '|' && depth === 0) {
      options.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    options.push(current.trim());
  }

  return options;
}
