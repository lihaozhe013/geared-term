import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  indentSelection,
  insertNewline,
  insertNewlineAndIndent,
  insertNewlineKeepIndent
} from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { remoteEditorLanguageExtension } from './language';

export type RemoteCodeEditorHandle = {
  content: () => string;
  focus: () => void;
  openSearch: () => void;
  replaceContent: (content: string) => void;
};

type RemoteCodeEditorProps = {
  name: string;
  content: string;
  wrap: boolean;
  disabled: boolean;
  ariaLabel?: string;
  onChanged: () => void;
  onSave?: () => void;
};

const blockedIndentCommands = new Set<unknown>([
  indentLess,
  indentMore,
  indentSelection,
  insertNewlineAndIndent,
  insertNewlineKeepIndent
]);

const editingKeymap = defaultKeymap.filter(
  (binding) => !binding.run || !blockedIndentCommands.has(binding.run)
);

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--gt-code-fg, #d7deea)',
    backgroundColor: 'var(--gt-code-bg, #1a2332)',
    fontFamily: 'var(--gt-editor-font, monospace)',
    fontSize: 'var(--gt-editor-font-size, 14px)'
  },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.45' },
  '.cm-content': { caretColor: 'var(--gt-cursor, #9fe6d5)', padding: '10px 0' },
  '.cm-line': { padding: '0 10px' },
  '.cm-gutters': {
    color: 'var(--gt-text-muted, #71809a)',
    backgroundColor: 'var(--gt-panel-alt, #161e2a)',
    borderRight: '1px solid var(--gt-divider, #202a39)'
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--gt-hover, #1a2332)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--gt-selection, #2d4a56) !important'
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--gt-cursor, #9fe6d5)' },
  '.cm-panels': {
    color: 'var(--gt-text, #e4eaf3)',
    backgroundColor: 'var(--gt-panel-alt, #161e2a)'
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--gt-border, #2a3140)' },
  '.cm-searchMatch': { backgroundColor: 'var(--gt-search-match, #545045)' },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--gt-search-match-active, #8f6a55)'
  }
});

const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--gt-code-comment, #71809a)' },
  {
    tag: [tags.keyword, tags.modifier, tags.operatorKeyword],
    color: 'var(--gt-code-keyword, #c678dd)'
  },
  { tag: [tags.string, tags.regexp], color: 'var(--gt-code-string, #98c379)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--gt-code-number, #e5c07b)' },
  { tag: [tags.heading, tags.typeName, tags.className], color: 'var(--gt-code-title, #61afef)' },
  {
    tag: [tags.propertyName, tags.attributeName, tags.variableName],
    color: 'var(--gt-code-attr, #56b6c2)'
  }
]);

export const RemoteCodeEditor = forwardRef<RemoteCodeEditorHandle, RemoteCodeEditorProps>(
  function RemoteCodeEditor(
    { name, content, wrap, disabled, ariaLabel, onChanged, onSave },
    forwardedRef
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const wrapCompartmentRef = useRef(new Compartment());
    const editableCompartmentRef = useRef(new Compartment());
    const callbacksRef = useRef({ onChanged, onSave });
    callbacksRef.current = { onChanged, onSave };

    const createState = (documentContent: string): EditorState =>
      EditorState.create({
        doc: documentContent,
        extensions: [
          lineNumbers(),
          drawSelection(),
          history(),
          search({ top: true }),
          remoteEditorLanguageExtension(name),
          syntaxHighlighting(highlightStyle),
          editorTheme,
          wrapCompartmentRef.current.of(wrap ? EditorView.lineWrapping : []),
          editableCompartmentRef.current.of(EditorView.editable.of(!disabled)),
          EditorView.contentAttributes.of({
            'aria-label': ariaLabel ?? `Remote file ${name}`,
            spellcheck: 'false'
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacksRef.current.onChanged();
          }),
          Prec.highest(
            keymap.of([
              { key: 'Enter', run: insertNewline },
              {
                key: 'Mod-s',
                preventDefault: true,
                run: () => {
                  callbacksRef.current.onSave?.();
                  return true;
                }
              }
            ])
          ),
          keymap.of([...editingKeymap, ...historyKeymap, ...searchKeymap])
        ]
      });

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const view = new EditorView({ state: createState(content), parent: host });
      viewRef.current = view;
      view.focus();
      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, []);

    useEffect(() => {
      viewRef.current?.dispatch({
        effects: wrapCompartmentRef.current.reconfigure(wrap ? EditorView.lineWrapping : [])
      });
    }, [wrap]);

    useEffect(() => {
      viewRef.current?.dispatch({
        effects: editableCompartmentRef.current.reconfigure(EditorView.editable.of(!disabled))
      });
    }, [disabled]);

    useImperativeHandle(
      forwardedRef,
      () => ({
        content: () => viewRef.current?.state.doc.toString() ?? '',
        focus: () => viewRef.current?.focus(),
        openSearch: () => {
          const view = viewRef.current;
          if (view) openSearchPanel(view);
        },
        replaceContent: (nextContent: string) => {
          const view = viewRef.current;
          if (!view) return;
          view.setState(createState(nextContent));
          view.focus();
        }
      }),
      [disabled, name, wrap]
    );

    return <div ref={hostRef} className="remote-code-editor" />;
  }
);
