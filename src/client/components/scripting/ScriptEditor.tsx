import React, { useEffect, useRef, useState } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import {
  listScripts,
  getScript,
  saveScript,
  createScript,
  deleteScript,
  getScriptTypes,
  getScriptErrors,
  type ScriptFileInfo,
  type ScriptError,
} from '../../io/network';
import { colors, radius } from '../../theme';

// Self-hosted Monaco: point the react wrapper at the bundled npm package
// instead of its default jsdelivr CDN fetch (vite-plugin-monaco-editor-esm
// bundles the language workers locally too).
loader.config({ monaco });

// Language defaults are a global singleton, so they are configured once per
// page load rather than per mount.
let typesConfigured = false;

async function configureJsDefaults(): Promise<void> {
  if (typesConfigured) return;
  typesConfigured = true;
  const { globalDts, contentDts } = await getScriptTypes();
  const defaults = monaco.languages.typescript.javascriptDefaults;
  defaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    allowJs: true,
    checkJs: true,
    strict: false,
    noEmit: true,
  });
  defaults.addExtraLib(globalDts, 'file:///scripts/global.d.ts');
  defaults.addExtraLib(contentDts, 'file:///scripts/content.generated.d.ts');
}

// Own marker namespace, so runtime failures sit alongside Monaco's static
// javascript diagnostics instead of overwriting them.
const RUNTIME_MARKER_OWNER = 'script-runtime';
const ERROR_POLL_MS = 5000;

const modelFor = (name: string) =>
  monaco.editor.getModel(monaco.Uri.parse(`file:///scripts/${name}`));

/**
 * Puts a squiggle on the line that threw. Errors without a line stay in the
 * list below the editor.
 */
function applyRuntimeMarkers(name: string, errors: ScriptError[]): void {
  const model = modelFor(name);
  if (!model) return;

  const markers = errors
    .filter((e) => e.script === name && e.line !== undefined)
    .map((e) => {
      // The file may have been edited since it threw, so a recorded line can
      // now be past the end of the buffer.
      const line = Math.min(e.line!, model.getLineCount());
      return {
        severity: monaco.MarkerSeverity.Error,
        message: e.count > 1 ? `${e.message} (x${e.count})` : e.message,
        startLineNumber: line,
        startColumn: e.column ?? 1,
        endLineNumber: line,
        endColumn: model.getLineMaxColumn(line),
        source: e.context ? `${e.source}:${e.context}` : e.source,
      };
    });

  monaco.editor.setModelMarkers(model, RUNTIME_MARKER_OWNER, markers);
}

// Monaco script editor, admin only and behind SCRIPT_EDITOR_ENABLED.
// Saving writes to scripts/, which the server runs with full host access;
// see the trust model in engine/scripting/sandbox.ts.
export const ScriptEditor: React.FC<{ height?: number }> = ({
  height = 520,
}) => {
  const [files, setFiles] = useState<ScriptFileInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [status, setStatus] = useState('');
  const [newName, setNewName] = useState('');
  const [errors, setErrors] = useState<ScriptError[]>([]);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const dirty = content !== savedContent;
  const fileErrors = errors.filter((e) => e.script === selected);

  const refreshFiles = () =>
    listScripts()
      .then(setFiles)
      .catch(() => setFiles([]));

  const refreshErrors = () => getScriptErrors().then(setErrors);

  // Scripts fail while the game runs, so the editor polls for failures.
  useEffect(() => {
    void refreshErrors();
    const handle = window.setInterval(
      () => void refreshErrors(),
      ERROR_POLL_MS,
    );
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    if (selected) applyRuntimeMarkers(selected, errors);
  }, [selected, errors, content]);

  useEffect(() => {
    refreshFiles();
    return () => {
      // Per-file models are dropped with the panel; language defaults stay.
      for (const model of monaco.editor.getModels()) {
        if (model.uri.path.startsWith('/scripts/')) model.dispose();
      }
    };
  }, []);

  // Switching files prompts on its own; this covers closing/reloading the tab.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const openFile = async (name: string) => {
    if (dirty && !window.confirm(`Discard unsaved changes to ${selected}?`)) {
      return;
    }
    setStatus('');
    const text = await getScript(name);
    setSelected(name);
    setContent(text);
    setSavedContent(text);
  };

  const save = async () => {
    if (!selected) return;
    const ok = await saveScript(selected, content);
    setSavedContent(ok ? content : savedContent);
    setStatus(ok ? 'Saved · hot-reloaded' : 'Save failed.');
    if (!ok) return;
    // A filesystem watcher drives the reload, so errors in what was just saved
    // land after the response; wait for them.
    window.setTimeout(() => void refreshErrors(), 400);
  };

  const goToError = (error: ScriptError) => {
    if (!error.line || !editorRef.current) return;
    const line = Math.min(
      error.line,
      editorRef.current.getModel()?.getLineCount() ?? error.line,
    );
    editorRef.current.revealLineInCenter(line);
    editorRef.current.setPosition({
      lineNumber: line,
      column: error.column ?? 1,
    });
    editorRef.current.focus();
  };

  // onMount fires once per editor, so Ctrl+S calls `save` through a ref to
  // avoid writing the first render's content.
  const saveRef = useRef(save);
  saveRef.current = save;

  const handleMount: OnMount = (editorInstance) => {
    editorRef.current = editorInstance;
    void configureJsDefaults();
    editorInstance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => void saveRef.current(),
    );
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    const fileName = /\.(js|ts)$/.test(name) ? name : `${name}.js`;
    const ok = await createScript(fileName);
    if (!ok) {
      setStatus('Could not create file (name taken or invalid).');
      return;
    }
    setNewName('');
    await refreshFiles();
    await openFile(fileName);
  };

  const remove = async (name: string) => {
    if (!window.confirm(`Delete ${name}? This removes it from the server.`)) {
      return;
    }
    await deleteScript(name);
    if (selected === name) {
      setSelected(null);
      setContent('');
      setSavedContent('');
    }
    await refreshFiles();
  };

  return (
    <div style={{ ...wrap, height }}>
      <div style={sidebar}>
        <div style={fileList}>
          {files.map((f) => (
            <div
              key={f.name}
              style={{
                ...fileRow,
                ...(f.name === selected ? fileRowActive : {}),
              }}
            >
              <button style={fileBtn} onClick={() => void openFile(f.name)}>
                {errors.some((e) => e.script === f.name) ? '⚠ ' : ''}
                {f.name}
                {f.name === selected && dirty ? ' •' : ''}
              </button>
              <button
                style={deleteBtn}
                title="Delete"
                onClick={() => void remove(f.name)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div style={newFileRow}>
          <input
            style={newFileInput}
            placeholder="new-script.js"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
          />
          <button style={fileBtn} onClick={() => void create()}>
            + New
          </button>
        </div>
      </div>
      <div style={main}>
        <div style={toolbar}>
          <span style={fileName}>{selected ?? 'Select a file'}</span>
          <button
            style={{
              ...saveBtn,
              ...(!selected || !dirty ? saveBtnDisabled : {}),
            }}
            disabled={!selected || !dirty}
            onClick={() => void save()}
          >
            Save
          </button>
          {status && <span style={statusLine}>{status}</span>}
        </div>
        <div style={editorWrap}>
          {selected ? (
            <Editor
              path={`file:///scripts/${selected}`}
              defaultLanguage="javascript"
              value={content}
              theme="vs"
              onChange={(v) => setContent(v ?? '')}
              onMount={handleMount}
              options={{ minimap: { enabled: false }, fontSize: 13 }}
            />
          ) : (
            <div style={emptyHint}>
              Pick a script on the left, or create a new one.
            </div>
          )}
        </div>
        {selected && fileErrors.length > 0 && (
          <div style={errorPanel}>
            <div style={errorHeader}>Runtime errors ({fileErrors.length})</div>
            {fileErrors.map((e) => (
              <button
                key={`${e.source}:${e.context ?? ''}:${e.line ?? ''}:${e.message}`}
                style={errorRow}
                onClick={() => goToError(e)}
                title={e.stack ?? e.message}
              >
                <span style={errorWhere}>
                  {e.line ? `line ${e.line}` : e.source}
                  {e.context ? ` · ${e.context}` : ''}
                  {e.count > 1 ? ` · x${e.count}` : ''}
                </span>
                <span style={errorMessage}>{e.message}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const wrap: React.CSSProperties = {
  display: 'flex',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  overflow: 'hidden',
};
const sidebar: React.CSSProperties = {
  width: 200,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRight: `1px solid ${colors.border}`,
  background: colors.surfaceMuted,
};
const fileList: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
};
const fileRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
};
const fileRowActive: React.CSSProperties = {
  background: colors.surface,
};
const fileBtn: React.CSSProperties = {
  flex: 1,
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  padding: '8px 10px',
  cursor: 'pointer',
  fontSize: 13,
  color: colors.text,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const deleteBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: colors.textMuted,
  cursor: 'pointer',
  padding: '4px 8px',
  fontSize: 14,
};
const newFileRow: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: 6,
  borderTop: `1px solid ${colors.border}`,
};
const newFileInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '6px 8px',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  fontSize: 12,
  outline: 'none',
};
const main: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};
const toolbar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 10px',
  borderBottom: `1px solid ${colors.border}`,
};
const fileName: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  flex: 1,
};
const saveBtn: React.CSSProperties = {
  background: colors.primary,
  color: '#fff',
  border: 'none',
  padding: '6px 14px',
  borderRadius: radius.sm,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
};
const saveBtnDisabled: React.CSSProperties = {
  background: colors.border,
  color: colors.textMuted,
  cursor: 'default',
};
const statusLine: React.CSSProperties = {
  fontSize: 12,
  color: colors.textMuted,
};
const editorWrap: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
};
const emptyHint: React.CSSProperties = {
  padding: 20,
  color: colors.textMuted,
  fontSize: 13,
};
const errorPanel: React.CSSProperties = {
  flexShrink: 0,
  maxHeight: 140,
  overflowY: 'auto',
  borderTop: `1px solid ${colors.border}`,
  background: colors.surfaceMuted,
};
const errorHeader: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: colors.textMuted,
};
const errorRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  borderTop: `1px solid ${colors.border}`,
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'monospace',
};
const errorWhere: React.CSSProperties = {
  flexShrink: 0,
  color: colors.textMuted,
};
const errorMessage: React.CSSProperties = {
  color: colors.danger,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
