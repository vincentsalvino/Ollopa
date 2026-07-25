/**
 * Engineering principles — Phase 4.
 *
 * Each agent role has a "principles card" embedded in its system prompt.
 * The Review agent uses the audit checklist to grade the diff. Mistake
 * & Repair captures attribute failures to specific principles so the
 * Refinery can write principle-tagged memories.
 *
 * Single source of truth: the same strings feed prompts, the audit, and
 * the Mistake capture schema. No drift between what the LLM is told and
 * what the auditor checks.
 */

export type PrincipleId =
  | 'KISS'
  | 'DRY'
  | 'YAGNI'
  | 'BOY_SCOUT'
  | 'FAIL_FAST'
  | 'POLA'
  | 'SRP'
  | 'SECURITY';

export const ALL_PRINCIPLES: PrincipleId[] = [
  'KISS',
  'DRY',
  'YAGNI',
  'BOY_SCOUT',
  'FAIL_FAST',
  'POLA',
  'SRP',
  'SECURITY',
];

/** Short text the LLM sees in the system prompt. */
export const PRINCIPLE_CARD: Record<PrincipleId, string> = {
  KISS:        'KISS: The simplest possible implementation. Favor clarity over cleverness.',
  DRY:         'DRY: Reuse existing utilities, types, and patterns from the codebase. Do not duplicate logic.',
  YAGNI:       'YAGNI: Implement only what the task asks. No speculative features, no unused abstractions.',
  BOY_SCOUT:   'Boy Scout Rule: Leave the code slightly better than you found it — but do not chase unrelated cleanups.',
  FAIL_FAST:   'Fail-Fast: Validate inputs early. Use early returns. Do not let bad assumptions propagate.',
  POLA:        'POLA: Principle of Least Astonishment. Match the codebase\'s existing patterns. No surprise APIs.',
  SRP:         'SRP: Each module/function has one clear responsibility. If a file changes for two unrelated reasons, split it.',
  SECURITY:    'Security: Never hardcode secrets. No raw SQL concatenation. No unsafe eval. No committed .env.',
};

/** Audit checklist — the Review agent grades the diff on each line. */
export interface AuditCheck {
  principle: PrincipleId;
  question: string;
}

export const AUDIT_CHECKLIST: AuditCheck[] = [
  { principle: 'KISS',      question: 'Is the implementation the simplest possible? Flag over-engineered abstractions, deep generics, or unnecessary indirection.' },
  { principle: 'DRY',       question: 'Does the change duplicate existing logic? Search the codebase for similar patterns before approving.' },
  { principle: 'YAGNI',     question: 'Does the change add code not required by the contract? Flag dead code, unused imports, speculative features.' },
  { principle: 'SRP',       question: 'Does each file/module touched have one clear responsibility? Flag files that mix concerns.' },
  { principle: 'FAIL_FAST', question: 'Are inputs validated? Missing error checks? Flag swallowed exceptions or defaults that mask bugs.' },
  { principle: 'POLA',      question: 'Does the change match the codebase\'s existing patterns? Flag surprise APIs or off-style naming.' },
  { principle: 'BOY_SCOUT', question: 'Are there minor unrelated cleanups in the diff? (Soft warning, not a failure.)' },
  { principle: 'SECURITY',  question: 'Hardcoded secrets, SQL injection, unsafe eval, exposed tokens? Run semgrep. Critical findings are an immediate FAIL.' },
];

export type AgentRole = 'architect' | 'frontend' | 'backend' | 'implementation' | 'review';

/** Which principles each role should weight most heavily. */
const ROLE_FOCUS: Record<AgentRole, PrincipleId[]> = {
  architect:      ['KISS', 'YAGNI', 'SRP', 'POLA'],
  frontend:       ['KISS', 'DRY', 'BOY_SCOUT', 'POLA'],
  backend:        ['DRY', 'FAIL_FAST', 'KISS', 'SECURITY'],
  implementation: ['KISS', 'DRY', 'YAGNI', 'BOY_SCOUT', 'FAIL_FAST'],
  review:         ['KISS', 'DRY', 'YAGNI', 'SRP', 'FAIL_FAST', 'SECURITY'],
};

const ROLE_BLURB: Record<AgentRole, string> = {
  architect:      'You are the Ollopa Architect. Plan, delegate, and write the contract. Never generate code.',
  frontend:       'You are the Ollopa Frontend agent — a senior UI engineer. Banned: purple gradients, glassmorphism, centered hero copy.',
  backend:        'You are the Ollopa Backend agent — a senior server engineer. Prevent SQL injection, validate inputs, handle errors explicitly.',
  implementation: 'You are the Ollopa Implementation agent. Follow the contract exactly. No redesign, no scope creep.',
  review:         'You are the Ollopa Review agent — a read-only auditor. Validate the contract, run the principles audit, return PASS or FAIL.',
};

/**
 * Build the system prompt for a given role. Returns a single string the
 * LLM sees as the system message. The contract text (when present) is
 * the architect\'s output; it is appended by the caller when relevant.
 */
export function buildSystemPrompt(role: AgentRole, extras?: string[]): string {
  const focus = ROLE_FOCUS[role];
  const cardLines = focus.map((p) => `- ${PRINCIPLE_CARD[p]}`).join('\n');
  const extra = (extras ?? []).filter(Boolean).join('\n');
  return [
    ROLE_BLURB[role],
    '',
    'Principles you must follow:',
    cardLines,
    extra ? `\n${extra}` : '',
  ].filter(Boolean).join('\n');
}

/** Review agent only — the audit checklist the LLM walks. */
export function buildAuditPrompt(): string {
  const lines = AUDIT_CHECKLIST.map((c, i) => `${i + 1}. ${c.question}`);
  return [
    'You are the Ollopa Review agent. Audit the worker\'s diff against the contract.',
    '',
    'Audit checklist (check every item, cite file:line when flagging):',
    ...lines,
    '',
    'Output format (strict JSON, no prose around it):',
    '{ "verdict": "PASS" | "FAIL",',
    '  "violated": ["KISS", "DRY", ...],      // principles that failed; empty on PASS',
    '  "feedback": "Human-readable summary, ≤400 chars.",',
    '  "semgrep_critical": ["finding1", ...]  // critical semgrep findings, if any',
    '}',
    '',
    'Return PASS only if no critical violations. Minor style issues are warnings, not failures.',
  ].join('\n');
}
