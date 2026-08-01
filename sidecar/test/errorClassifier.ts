/**
 * Phase 1.1E — error classifier self-check.
 *
 * Trivial assert-based test. Covers all 10 ErrorKind values.
 * Run: npx tsx sidecar/test/errorClassifier.ts
 */
import { classifyError, hintForKind, type ErrorKind } from '../src/agents/errorClassifier';

const CASES: Array<[string, ErrorKind]> = [
  ['tool search_replace failed: old_str not unique in src/foo.ts (3 matches)', 'tool_not_unique'],
  ['tool search_replace failed: old_str not found verbatim in src/foo.ts', 'tool_not_found'],
  ['tool execute_safe_bash failed: [killed after 30000ms timeout]', 'tool_timeout'],
  ['tool semgrep_scan failed: semgrep critical: 2', 'semgrep_critical'],
  ['tool run_lint failed: exit 1', 'lint_fail'],
  ['tool read_file failed: refused: .env is a protected path', 'protected_path'],
  ['architect did not emit a parseable contract', 'parse_failure'],
  ['review did not return parseable JSON', 'parse_failure'],
  ['worker LLM failed: ETIMEDOUT', 'llm_error'],
  ['review returned FAIL — must address lint', 'unknown'], // generic FAIL has no specific signature -> unknown
  ['something we have never seen before', 'unknown'],
];

let pass = 0;
let fail = 0;
for (const [msg, want] of CASES) {
  const got = classifyError(msg);
  if (got === want) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: classifyError(${JSON.stringify(msg)}) -> ${got}, want ${want}`);
  }
}

// Hint smoke check: every kind has a non-empty hint.
const KINDS: ErrorKind[] = [
  'parse_failure', 'tool_not_unique', 'tool_not_found', 'tool_timeout',
  'semgrep_critical', 'lint_fail', 'review_fail', 'protected_path',
  'llm_error', 'unknown',
];
for (const k of KINDS) {
  const h = hintForKind(k);
  if (!h || h.length < 10) {
    fail++;
    console.error(`FAIL: hintForKind(${k}) returned empty/short: ${JSON.stringify(h)}`);
  } else {
    pass++;
  }
}

console.log(`errorClassifier: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
