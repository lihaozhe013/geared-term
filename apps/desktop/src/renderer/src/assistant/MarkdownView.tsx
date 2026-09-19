import { useMemo } from 'react';
import { renderMarkdown } from './markdown';

type MarkdownViewProps = {
  source: string;
};

/**
 * Selectable, themed, sanitized Markdown with class-based syntax highlighting.
 * Anchor clicks are forced through the main-process external-URL validation.
 */
export function MarkdownView({ source }: MarkdownViewProps): React.JSX.Element {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return (
    <div
      className="assistant-markdown"
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest('a');
        if (!anchor) return;
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noreferrer noopener');
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
