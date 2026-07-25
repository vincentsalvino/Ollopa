/**
 * Example plugin: /commit.
 *
 * Slash command that takes the current temp workspace diff and produces a
 * commit message using the sidecar's LLM router.
 */
module.exports = {
  name: 'commit-message',
  version: '0.1.0',
  commands: [
    {
      name: 'commit',
      description: 'Generate a commit message from the current task diff.',
      handler: async (_args, ctx) => {
        const root = ctx.tempWorkspaceRoot;
        if (!root) {
          return { text: 'No temp workspace. Run a Quick task first.', kind: 'warning' };
        }
        const diff = await runDiff(root);
        if (!diff.trim()) {
          return { text: 'No changes to commit yet.', kind: 'info' };
        }
        const prompt = `Write a one-line conventional commit message (max 72 chars) and a short body for this diff:\n\n${diff.slice(0, 4000)}`;
        try {
          const { chatCompletion } = require('../../dist/llm/chatClient');
          const result = await chatCompletion(
            [
              { role: 'system', content: 'You write concise commit messages.' },
              { role: 'user', content: prompt },
            ],
            [],
          );
          return { text: result.message.content.trim(), kind: 'success' };
        } catch (err) {
          return { text: `LLM unavailable: ${(err).message}`, kind: 'error' };
        }
      },
    },
  ],
};

function runDiff(cwd) {
  return new Promise((resolve) => {
    const { spawn } = require('node:child_process');
    const proc = spawn('git', ['diff', '--no-color'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', (b) => { out += b.toString('utf8'); });
    proc.on('exit', () => resolve(out));
    proc.on('error', () => resolve(''));
  });
}
