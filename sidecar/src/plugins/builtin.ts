/**
 * Built-in plugins — registered into the live registry at sidecar startup.
 *
 * Hardcoded commands that ship with the sidecar (vs. user-authored plugins
 * in `.ollopa/plugins/`). Same shape as user plugins, no on-disk file.
 */
import { runRefinery } from '../memory/refinery';
import type { OllopaPlugin, PluginContext } from './loader';

export const BUILTIN_PLUGINS: OllopaPlugin[] = [
  {
    name: 'ollopa-builtin',
    version: '0.1.0',
    commands: [
      {
        name: 'refine',
        description: 'Distill captured mistakes into Candidate memories (Phase 6 Refinery).',
        handler: async (args: string, _ctx: PluginContext) => {
          const dry = args.trim() === '--dry';
          if (dry) {
            return { text: 'dry-run: not implemented (would print summary without persisting).', kind: 'info' };
          }
          try {
            const result = await runRefinery();
            const text = [
              `Refinery finished in ${(result.finishedAt - result.startedAt)}ms`,
              `mistakes seen: ${result.mistakesSeen}`,
              `candidates generated: ${result.candidatesGenerated}`,
              `candidates inserted: ${result.candidatesInserted}`,
              `duplicates skipped: ${result.duplicatesSkipped}`,
              result.errors.length ? `errors: ${result.errors.join('; ')}` : '',
            ].filter(Boolean).join('\n');
            const kind = result.errors.length ? 'warning' : 'success';
            return { text, kind };
          } catch (err) {
            return { text: `Refinery failed: ${(err as Error).message}`, kind: 'error' };
          }
        },
      },
    ],
  },
];