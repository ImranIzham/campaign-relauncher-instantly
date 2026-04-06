/**
 * Spintax helpers for Instantly format: {{RANDOM | opt1 | opt2 | opt3}}
 *
 * Ported from: ~/workspace/campaign-creation/shared/scripts/spintax_handler.py
 */

/**
 * Format a sentence with variations into Instantly spintax format.
 *
 * @param original - The original text
 * @param variations - Alternative text options
 * @returns Spintax string: {{RANDOM | original | var1 | var2}}
 */
export function formatSpintax(original: string, variations: string[]): string {
  if (variations.length === 0) {
    return original;
  }

  const allOptions = [original, ...variations];
  return `{{RANDOM | ${allOptions.join(' | ')}}}`;
}

/**
 * Parse existing spintax blocks from text.
 * Finds all {{RANDOM | ... }} blocks and extracts their options.
 * Handles nested braces correctly.
 *
 * @param text - Text potentially containing spintax
 * @returns Array of parsed spintax blocks with full match string and options
 */
export function parseSpintax(text: string): Array<{ full: string; options: string[] }> {
  const results: Array<{ full: string; options: string[] }> = [];

  let i = 0;
  while (i < text.length) {
    // Look for "{{RANDOM" (case-insensitive)
    const lowerSlice = text.substring(i).toLowerCase();
    const randomIdx = lowerSlice.indexOf('{{random');

    if (randomIdx === -1) break;

    const startPos = i + randomIdx;

    // Verify there's a | after RANDOM
    const afterRandom = text.substring(startPos + 2); // skip {{
    const pipeIdx = afterRandom.indexOf('|');
    if (pipeIdx === -1) {
      i = startPos + 2;
      continue;
    }

    // Find the matching closing }}
    let depth = 0;
    let endPos = -1;

    for (let j = startPos; j < text.length - 1; j++) {
      if (text[j] === '{' && text[j + 1] === '{') {
        depth++;
        j++; // skip second {
      } else if (text[j] === '}' && text[j + 1] === '}') {
        depth--;
        if (depth === 0) {
          endPos = j + 2; // include both }}
          break;
        }
        j++; // skip second }
      }
    }

    if (endPos === -1) {
      // Unmatched braces — skip
      i = startPos + 2;
      continue;
    }

    const fullMatch = text.substring(startPos, endPos);

    // Extract content between {{ and }}
    const innerContent = fullMatch.substring(2, fullMatch.length - 2);
    // Remove "RANDOM" prefix (case-insensitive)
    const afterRandomKw = innerContent.replace(/^RANDOM\s*/i, '');

    // The content should start with |
    if (!afterRandomKw.startsWith('|')) {
      i = endPos;
      continue;
    }

    const optionsContent = afterRandomKw.substring(1); // skip the leading |

    // Split by | respecting nested braces
    const options = splitByPipe(optionsContent);

    results.push({
      full: fullMatch,
      options: options.map((o) => o.trim()).filter((o) => o.length > 0),
    });

    i = endPos;
  }

  return results;
}

/**
 * Validate spintax format in text.
 *
 * Checks:
 * - All {{ have matching }}
 * - RANDOM keyword is present in spintax blocks
 * - Each block has at least 2 options
 *
 * @param text - Text to validate
 * @returns Validation result with valid flag and error messages
 */
export function validateSpintax(text: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for balanced double braces
  const openCount = (text.match(/\{\{/g) || []).length;
  const closeCount = (text.match(/\}\}/g) || []).length;

  if (openCount !== closeCount) {
    errors.push(
      `Unbalanced braces: found ${openCount} opening '{{' but ${closeCount} closing '}}'`
    );
  }

  // Find all double-brace blocks and check for RANDOM keyword
  const blockPattern = /\{\{([\s\S]*?)\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(text)) !== null) {
    const content = match[1].trim();

    // Skip variable tokens like {{first name}} or {{accountSignature}} (no pipe = not spintax)
    if (!content.includes('|')) {
      continue;
    }

    // If it contains |, it should be a spintax block
    if (content.includes('|')) {
      // Check for RANDOM keyword
      if (!/^RANDOM\s*\|/i.test(content)) {
        errors.push(
          `Spintax block missing RANDOM keyword: "{{${content.substring(0, 30)}...}}"`
        );
      }

      // Check for at least 2 options
      const optionsStr = content.replace(/^RANDOM\s*\|\s*/i, '');
      const options = splitByPipe(optionsStr);
      const nonEmpty = options.filter((o) => o.trim().length > 0);

      if (nonEmpty.length < 2) {
        errors.push(
          `Spintax block has fewer than 2 options: "{{${content.substring(0, 30)}...}}"`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Split content by | respecting nested braces.
 */
function splitByPipe(content: string): string[] {
  const parts: string[] = [];
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
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}
