/**
 * Email copy parser — parses pasted campaign copy into structured data.
 *
 * Supports multiple input formats:
 * - "Email 1A (New Thread)" / "Email 2 (Reply)"
 * - "Step 1A" / "Step 2"
 * - Headers without parentheses: "Email 1 - New Thread"
 * - Implicit body (no "Body:" label)
 */

export interface ParsedEmail {
  /** Step number in the sequence: 1, 2, 3, 4 */
  stepNumber: number;
  /** Variant letter if A/B split test: 'A', 'B', 'C', or null */
  variant: string | null;
  /** Whether this email starts a new thread or replies to previous */
  threadType: 'new' | 'reply';
  /** Email subject line */
  subject: string;
  /** Email body text */
  body: string;
  /** Variables used in this email (e.g. ['firstName', 'companyName', 'erp name']) */
  variables: string[];
}

export interface ParsedCopy {
  /** All parsed emails */
  emails: ParsedEmail[];
  /** All unique variables across all emails */
  variables: string[];
  /** Whether any A/B split tests were detected */
  hasVariants: boolean;
  /** Thread structure summary */
  threadStructure: Array<{ step: number; type: 'new' | 'reply' }>;
}

/**
 * Regex pattern for email header lines.
 * Matches:
 * - "Email 1A (New Thread)"
 * - "Email 1 (Reply)"
 * - "Step 1A - New Thread"
 * - "Email 3 (Follow-up)"
 * - "Email 2 (Follow up)"
 * - "Email 1A"
 * - "Step 2"
 */
const EMAIL_HEADER_RE =
  /^(?:Email|Step)\s+(\d+)([A-Z]?)[\s\-]*(?:\(?\s*(New\s*Thread|Reply|Follow[\s-]*up)\s*\)?)?/im;

/**
 * Pattern to detect all header lines (used for splitting).
 */
const EMAIL_HEADER_SPLIT_RE =
  /^(?=(?:Email|Step)\s+\d+[A-Z]?[\s\-]*(?:\(?\s*(?:New\s*Thread|Reply|Follow[\s-]*up)\s*\)?)?)/im;

/**
 * Extract merge variables from text: {{variable name}} or {{accountSignature}}
 * Matches any content inside {{ }} that isn't a spintax block (no pipe character).
 */
const VARIABLE_RE = /\{\{([^}|]+?)\}\}/g;

/**
 * Parse raw pasted email copy into structured data.
 *
 * @param rawText - The raw copy pasted by the user
 * @returns ParsedCopy with structured email data
 */
export function parseCopy(rawText: string): ParsedCopy {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      emails: [],
      variables: [],
      hasVariants: false,
      threadStructure: [],
    };
  }

  // Split the text into email sections at each header line
  const sections = splitIntoSections(trimmed);
  const emails: ParsedEmail[] = [];
  const allVariables = new Set<string>();

  for (const section of sections) {
    const parsed = parseSection(section);
    if (parsed) {
      emails.push(parsed);
      for (const v of parsed.variables) {
        allVariables.add(v);
      }
    }
  }

  // Determine thread structure (deduplicated by step number)
  const threadMap = new Map<number, 'new' | 'reply'>();
  for (const email of emails) {
    if (!threadMap.has(email.stepNumber)) {
      threadMap.set(email.stepNumber, email.threadType);
    }
  }
  const threadStructure = Array.from(threadMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([step, type]) => ({ step, type }));

  const hasVariants = emails.some((e) => e.variant !== null);

  return {
    emails,
    variables: Array.from(allVariables).sort(),
    hasVariants,
    threadStructure,
  };
}

/**
 * Split raw text into sections, one per email header.
 */
function splitIntoSections(text: string): string[] {
  const lines = text.split('\n');
  const sections: string[] = [];
  let currentSection: string[] = [];

  for (const line of lines) {
    if (EMAIL_HEADER_RE.test(line.trim()) && currentSection.length > 0) {
      sections.push(currentSection.join('\n'));
      currentSection = [line];
    } else {
      currentSection.push(line);
    }
  }

  if (currentSection.length > 0) {
    sections.push(currentSection.join('\n'));
  }

  return sections;
}

/**
 * Parse a single email section into a ParsedEmail.
 */
function parseSection(section: string): ParsedEmail | null {
  const lines = section.split('\n');
  const firstLine = lines[0].trim();

  // Try to match header
  const headerMatch = firstLine.match(EMAIL_HEADER_RE);
  if (!headerMatch) {
    return null;
  }

  const stepNumber = parseInt(headerMatch[1], 10);
  const variant = headerMatch[2] || null;
  const threadHint = (headerMatch[3] || '').toLowerCase().trim();

  // Determine thread type from header
  let threadType: 'new' | 'reply' = 'new'; // default
  if (threadHint.includes('reply') || threadHint.includes('follow')) {
    threadType = 'reply';
  } else if (threadHint.includes('new')) {
    threadType = 'new';
  }

  // Extract subject and body from remaining lines
  const rest = lines.slice(1);
  let subject = '';
  let body = '';
  let subjectFound = false;
  let bodyStartIndex = -1;

  for (let i = 0; i < rest.length; i++) {
    const trimmedLine = rest[i].trim();

    // Look for "Subject:" label
    const subjectMatch = trimmedLine.match(/^Subject:\s*(.*)/i);
    if (subjectMatch && !subjectFound) {
      subject = subjectMatch[1].trim();
      subjectFound = true;
      continue;
    }

    // Look for "Body:" label
    const bodyMatch = trimmedLine.match(/^Body:\s*(.*)/i);
    if (bodyMatch) {
      // If there's inline body content after "Body:", capture it
      const inlineBody = bodyMatch[1].trim();
      bodyStartIndex = i + 1;
      if (inlineBody) {
        body = inlineBody + '\n' + rest.slice(bodyStartIndex).join('\n');
      } else {
        body = rest.slice(bodyStartIndex).join('\n');
      }
      break;
    }

    // If we found subject but no "Body:" label, the first non-empty line
    // after subject is the start of the body (implicit body)
    if (subjectFound && trimmedLine && bodyStartIndex === -1) {
      bodyStartIndex = i;
      body = rest.slice(bodyStartIndex).join('\n');
      break;
    }
  }

  // If no subject was found but there's content, treat first non-empty line as subject
  if (!subjectFound && rest.length > 0) {
    for (let i = 0; i < rest.length; i++) {
      const trimmedLine = rest[i].trim();
      if (trimmedLine) {
        subject = trimmedLine;
        body = rest
          .slice(i + 1)
          .join('\n');
        break;
      }
    }
  }

  // Clean up subject and body
  subject = subject.trim();
  body = body.trim();

  // If subject starts with "Re:" and we haven't determined thread type from header,
  // mark as reply
  if (subject.toLowerCase().startsWith('re:') && !threadHint) {
    threadType = 'reply';
  }

  // Extract variables from subject and body
  const fullText = `${subject} ${body}`;
  const variables = extractVariables(fullText);

  return {
    stepNumber,
    variant: variant || null,
    threadType,
    subject,
    body,
    variables,
  };
}

/**
 * Extract unique variable names from text.
 * Matches {{firstName}}, {{companyName}} (Instantly standard vars) and {{custom var}} (space-separated custom vars).
 * Excludes RANDOM (spintax keyword).
 */
function extractVariables(text: string): string[] {
  const vars = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(VARIABLE_RE.source, 'g');

  while ((match = re.exec(text)) !== null) {
    const varName = match[1];
    // Exclude spintax keyword
    if (varName.toUpperCase() !== 'RANDOM') {
      vars.add(varName);
    }
  }

  return Array.from(vars).sort();
}
