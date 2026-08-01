# claude-code-style-hello

A minimal Claude Code-style plugin that adds a `/hello` slash command.
Demonstrates the `plugin.json` manifest + `commands/<name>.md` layout
that Ollopa reads at startup.

Install locally:

```bash
cp -r examples/plugins/claude-code-style-hello ~/.ollopa/plugins/
```

Or pack and install via the marketplace:

```bash
# from a tarball
github:your-fork/your-plugin@v0.1.0
```

The plugin adds:

- `/hello [name=Ada]` — greets the named person, or 'world' by default.

After loading, `/hello name=Ada` is available immediately in the chat.