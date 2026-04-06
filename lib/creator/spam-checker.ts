/**
 * Pure TypeScript spam checker.
 * Uses word-boundary regex matching against the spam words database.
 * No Playwright, no external services — runs entirely in-process.
 *
 * Handles spintax: checks each variant inside {{RANDOM | ... }} blocks.
 */

import { SPAM_WORDS, type SpamCategory, type SpamSeverity } from './spam-words';
import { parseSpintax } from './spintax';

export interface SpamCheckResult {
  /** Overall score based on spam word count */
  score: 'great' | 'okay' | 'poor';
  /** Each unique spam word found with its count */
  spamWords: Array<{
    word: string;
    category: SpamCategory;
    severity: SpamSeverity;
    count: number;
  }>;
  /** Total number of spam words found (sum of all counts) */
  totalFound: number;
}

/**
 * Check text for spam words.
 *
 * - Matches whole words only (word boundary regex)
 * - Case-insensitive
 * - Handles spintax: if text contains {{RANDOM | ... }} blocks,
 *   each variant is checked independently and results are merged
 * - Score: 0 = 'great', 1-3 = 'okay', 4+ = 'poor'
 */
export function checkSpam(text: string): SpamCheckResult {
  // If text contains spintax, expand and check each variant
  const spintaxBlocks = parseSpintax(text);

  if (spintaxBlocks.length > 0) {
    return checkSpamWithSpintax(text, spintaxBlocks);
  }

  return checkSingleText(text);
}

/**
 * Check a single text string (no spintax) for spam words.
 */
function checkSingleText(text: string): SpamCheckResult {
  const found = new Map<
    string,
    { word: string; category: SpamCategory; severity: SpamSeverity; count: number }
  >();

  // Sort spam words by length descending so multi-word phrases match first
  const sortedWords = [...SPAM_WORDS].sort((a, b) => b.word.length - a.word.length);

  for (const entry of sortedWords) {
    // Build word-boundary regex, case-insensitive
    const escaped = entry.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\b`, 'gi');
    const matches = text.match(pattern);

    if (matches && matches.length > 0) {
      const key = entry.word.toLowerCase();
      const existing = found.get(key);
      if (existing) {
        // If same word appears in multiple categories, keep higher severity
        existing.count = Math.max(existing.count, matches.length);
      } else {
        found.set(key, {
          word: entry.word,
          category: entry.category,
          severity: entry.severity,
          count: matches.length,
        });
      }
    }
  }

  // Also check for $ and % symbols as spam triggers
  const dollarCount = (text.match(/\$/g) || []).length;
  if (dollarCount > 0) {
    found.set('$', {
      word: '$',
      category: 'money',
      severity: 'medium',
      count: dollarCount,
    });
  }

  const percentCount = (text.match(/%/g) || []).length;
  if (percentCount > 0) {
    found.set('%', {
      word: '%',
      category: 'money',
      severity: 'medium',
      count: percentCount,
    });
  }

  const spamWords = Array.from(found.values());
  const uniqueCount = spamWords.length;

  let score: 'great' | 'okay' | 'poor';
  if (uniqueCount === 0) {
    score = 'great';
  } else if (uniqueCount <= 3) {
    score = 'okay';
  } else {
    score = 'poor';
  }

  return {
    score,
    spamWords,
    totalFound: spamWords.reduce((sum, w) => sum + w.count, 0),
  };
}

/**
 * Check text containing spintax blocks.
 * For each spintax block, check every variant. Merge results across all variants
 * (worst-case — if ANY variant triggers a spam word, it's counted).
 */
function checkSpamWithSpintax(
  text: string,
  spintaxBlocks: Array<{ full: string; options: string[] }>
): SpamCheckResult {
  // Generate all possible text variants by substituting each spintax block
  // For efficiency, check each variant of each block independently against the
  // surrounding text, then merge results. This avoids combinatorial explosion.
  const allFound = new Map<
    string,
    { word: string; category: SpamCategory; severity: SpamSeverity; count: number }
  >();

  for (const block of spintaxBlocks) {
    for (const option of block.options) {
      // Replace this spintax block with the current option
      const expandedText = text.replace(block.full, option);
      const result = checkSingleText(expandedText);

      for (const sw of result.spamWords) {
        const key = sw.word.toLowerCase();
        const existing = allFound.get(key);
        if (!existing || sw.count > existing.count) {
          allFound.set(key, sw);
        }
      }
    }
  }

  const spamWords = Array.from(allFound.values());
  const uniqueCount = spamWords.length;

  let score: 'great' | 'okay' | 'poor';
  if (uniqueCount === 0) {
    score = 'great';
  } else if (uniqueCount <= 3) {
    score = 'okay';
  } else {
    score = 'poor';
  }

  return {
    score,
    spamWords,
    totalFound: spamWords.reduce((sum, w) => sum + w.count, 0),
  };
}
