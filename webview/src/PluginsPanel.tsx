import { useEffect, useState } from 'react';
import type { VsCodeApi } from './global';

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  source: string;
  integrity: string;
  installedAt: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  autoTrigger: boolean;
  prompt: string;
  origin: string;
}

export interface PluginsPanelProps {
  vscode: VsCodeApi;
}

interface InstallResult {
  ok: boolean;
  plugin?: { name: string; version: string; dir: string };
  error?: string;
}

interface UninstallResult {
  ok: boolean;
  error?: string;
}

export function PluginsPanel({ vscode }: PluginsPanelProps): JSX.Element {
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [spec, setSpec] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [importText, setImportText] = useState('');

  useEffect(() => {
    refresh();
    vscode.postMessage({ type: 'list_skills' });
    const onMsg = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (detail?.type === 'installed_list') {
        setInstalled(detail.plugins as InstalledPlugin[]);
      }
      if (detail?.type === 'skills_list') {
        setSkills((detail.skills ?? []) as SkillInfo[]);
      }
      if (detail?.type === 'export_skill_result') {
        if (detail.ok && typeof detail.json === 'string') {
          setExported(detail.json);
          setLastOk(`exported skill '${detail.name}' — copy the JSON below`);
        } else {
          setLastError(detail.error ?? 'export failed');
        }
      }
      if (detail?.type === 'import_skill_result') {
        if (detail.ok) {
          setLastOk(`imported skill → ${detail.path}`);
          setImportText('');
          refresh();
        } else {
          setLastError(detail.error ?? 'import failed');
        }
      }
    };
    window.addEventListener('ollopa:inbound', onMsg as EventListener);
    vscode.postMessage({ type: 'list_installed_plugins' });
    return () => window.removeEventListener('ollopa:inbound', onMsg as EventListener);
  }, [vscode]);

  function refresh(): void {
    vscode.postMessage({ type: 'list_installed_plugins' });
  }

  function install(): void {
    const s = spec.trim();
    if (!s) return;
    setBusy(true);
    setLastError(null);
    setLastOk(null);
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<InstallResult & { type: string }>).detail;
      if (detail.type !== 'install_result') return;
      window.removeEventListener('ollopa:inbound', handler as EventListener);
      setBusy(false);
      if (detail.ok && detail.plugin) {
        setLastOk(`installed ${detail.plugin.name}@${detail.plugin.version}`);
        setSpec('');
        refresh();
      } else {
        setLastError(detail.error ?? 'install failed');
      }
    };
    window.addEventListener('ollopa:inbound', handler as EventListener);
    vscode.postMessage({ type: 'install_plugin', spec: s });
  }

  function uninstall(name: string): void {
    setBusy(true);
    setLastError(null);
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<UninstallResult & { type: string }>).detail;
      if (detail.type !== 'uninstall_result') return;
      window.removeEventListener('ollopa:inbound', handler as EventListener);
      setBusy(false);
      if (detail.ok) {
        setLastOk(`uninstalled ${name}`);
        refresh();
      } else {
        setLastError(detail.error ?? 'uninstall failed');
      }
    };
    window.addEventListener('ollopa:inbound', handler as EventListener);
    vscode.postMessage({ type: 'uninstall_plugin', name });
  }

  return (
    <section className="plugins">
      <header className="plugins__head">
        <h2>Plugins</h2>
        <p className="plugins__hint">
          Install Claude Code-compatible plugins from npm, GitHub, or a git URL. The plugin manifest
          format mirrors Claude Code: <code>plugin.json</code> + <code>commands/</code> +{' '}
          <code>agents/</code> + <code>skills/</code> + <code>hooks/</code> + <code>.mcp.json</code>.
        </p>
      </header>
      <form
        className="plugins__install"
        onSubmit={(e) => {
          e.preventDefault();
          install();
        }}
      >
        <input
          aria-label="Plugin spec"
          placeholder="npm:@scope/name  |  github:owner/repo[@ref]  |  git:https://...git[#ref]"
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !spec.trim()}>
          {busy ? 'Installing…' : 'Install'}
        </button>
      </form>
      {lastError && <p className="plugins__err">{lastError}</p>}
      {lastOk && <p className="plugins__ok">{lastOk}</p>}
      <h3 className="plugins__sub">Installed ({installed.length})</h3>
      {installed.length === 0
        ? <p className="plugins__empty">No marketplace plugins installed yet. Try one of the example specs above.</p>
        : (
          <ul className="plugins__list">
            {installed.map((p) => (
              <li key={p.id} className="plugins__row">
                <div className="plugins__row-main">
                  <code>{p.name}@{p.version}</code>
                  <span className="plugins__src">{p.source}</span>
                </div>
                <div className="plugins__row-meta">
                  <span title={p.integrity}>{p.integrity.slice(0, 18)}…</span>
                  <span>{new Date(p.installedAt).toLocaleDateString()}</span>
                  <button
                    type="button"
                    onClick={() => uninstall(p.name)}
                    disabled={busy}
                  >
                    Uninstall
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      <h3 className="plugins__sub">Skills ({skills.length})</h3>
      {skills.length === 0
        ? <p className="plugins__empty">No skills loaded. Skills are bundled with plugins and provide reusable prompts.</p>
        : (
          <ul className="plugins__list">
            {skills.map((s) => (
              <li key={s.name} className="plugins__row">
                <div className="plugins__row-main">
                  <code>{s.name}</code>
                  <span className="plugins__src">{s.description}</span>
                </div>
                <div className="plugins__row-meta">
                  <span>{s.autoTrigger ? 'auto' : 'manual'}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => vscode.postMessage({ type: 'export_skill', name: s.name })}
                  >
                    Export .skill.json
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      <h3 className="plugins__sub">Import a skill</h3>
      <p className="plugins__hint">
        Paste a <code>.skill.json</code> bundle below. Imports land under{' '}
        <code>~/.ollopa/plugins/imported-&lt;name&gt;@0.0.0-imported/</code>.
      </p>
      <form
        className="plugins__install"
        onSubmit={(e) => {
          e.preventDefault();
          if (!importText.trim()) return;
          vscode.postMessage({ type: 'import_skill', json: importText });
        }}
      >
        <textarea
          aria-label="Skill bundle JSON"
          rows={6}
          placeholder='{"format":"ollopa-skill","version":1,"skill":{...}}'
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !importText.trim()}>Import</button>
      </form>
      {exported && (
        <>
          <h3 className="plugins__sub">Last exported bundle</h3>
          <textarea readOnly rows={8} value={exported} />
        </>
      )}
    </section>
  );
}