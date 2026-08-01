/**
 * Error classifier — Phase 1.1B.
 *
 * Classifies tool/LLM errors into a small set of kinds so the worker
 * retry loop can attach a targeted hint instead of blind re-runs.
 *
 * Ponytail: a string-prefix + regex map. 6 entries, no ML. If we grow
 * past 12 kinds, switch to a tagged-union parser.
 */
export type ErrorKind =
  | 'parse_failure'        // LLM emitted unparseable JSON / contract
  | 'tool_not_unique'      // search_replace: old_str matched N>1
  | 'tool_not_found'       // search_replace: old_str missing
  | 'tool_timeout'         // bash/lint/semgrep killed by timeout
  | 'semgrep_critical'     // review caught a security finding
  | 'lint_fail'            // run_lint exit non-zero
  | 'review_fail'          // review returned FAIL (no specifics)
  | 'protected_path'       // secret/.env access refused
  | 'llm_error'            // upstream LLM 5xx / network
  | 'unknown';

const PATTERNS: Array<[ErrorKind, RegExp]> = [
  ['tool_not_unique',   /not unique in .+ \(\d+ matches\)/i],
  ['tool_not_found',    /old_str not found verbatim in /i],
  ['tool_timeout',      /\[killed after \d+ms timeout\]/i],
  ['semgrep_critical',  /semgrep critical: \d+/i],
  ['lint_fail',         /exit [1-9]\d*/i], // run_lint kind === 'error' is the gate
  ['protected_path',    /refused: .+ is a protected path/i],
  ['parse_failure',     /did not emit a parseable contract|did not return parseable JSON/i],
  ['llm_error',         /LLM failed: /i],
];

export function classifyError(message: string): ErrorKind {
  for (const [kind, re] of PATTERNS) {
    if (re.test(message)) return kind;
  }
  return 'unknown';
}

/**
 * Targeted hint for the worker on retry. Keep short — appended to
 * the system prompt, costs tokens.
 */
export function hintForKind(kind: ErrorKind): string {
  switch (kind) {
    case 'tool_not_unique':
      return 'Your previous search_replace matched the same string more than once. ' +
        'Re-read the file with read_file and pick a longer, more specific old_str ' +
        'that includes enough surrounding context to be unique.';
    case 'tool_not_found':
      return 'Your previous search_replace could not find old_str in the file. ' +
        'The file may have been edited by an earlier tool call. Re-read it with ' +
        'read_file and base the next edit on the current contents.';
    case 'tool_timeout':
      return 'A previous shell command was killed after the 30s timeout. ' +
        'Break the work into smaller commands or use a more targeted query.';
    case 'semgrep_critical':
      return 'A previous attempt triggered a semgrep critical (ERROR-severity) ' +
        'finding. The flagged line must be removed or rewritten to avoid the ' +
        'pattern. Run semgrep_scan on the narrowed file:line before re-submitting.';
    case 'lint_fail':
      return 'A previous attempt failed lint. The first ESLint error is the ' +
        'priority — fix that exact rule before adding any new code.';
    case 'protected_path':
      return 'A previous attempt tried to read or write a secret/protected path. ' +
        'This is a hard block. Do not retry on the same path — pick a non-sensitive ' +
        'location or surface the limitation to the user.';
    case 'parse_failure':
      return 'Your previous output could not be parsed as the expected JSON shape. ' +
        'Re-emit strictly: no prose, no markdown fences, JSON only.';
    case 'llm_error':
      return 'The LLM call failed (network or upstream). ' +
        'Re-state your next action concisely; the retry will go through.';
    case 'review_fail':
    case 'unknown':
    default:
      return 'The previous attempt failed review. Re-read the review feedback ' +
        'and address it before adding new edits.';
  }
}
