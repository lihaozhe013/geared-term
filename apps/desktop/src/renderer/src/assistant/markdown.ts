import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { Marked } from 'marked';

const marked = new Marked({
  gfm: true,
  breaks: true
});

const renderer = {
  code({ text, lang }: { text: string; lang?: string | undefined }): string {
    const language = (lang ?? '').trim().split(/\s+/u)[0] ?? '';
    let rendered: string;
    if (language && hljs.getLanguage(language)) {
      rendered = hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } else {
      rendered = hljs.highlightAuto(text).value;
    }
    const escapedLanguage = language.replace(/["<>&]/gu, '');
    return `<pre><code class="hljs language-${escapedLanguage}">${rendered}</code></pre>`;
  }
};

marked.use({ renderer });

/**
 * Renders assistant Markdown to sanitized HTML: only https and mailto links
 * survive, event handlers and inline styles are dropped, and highlighted code
 * keeps its class-based theme hooks. External navigation is validated by the
 * main process before any browser launch.
 */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false });
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_ATTR: ['style', 'srcset'],
    ALLOWED_URI_REGEXP: /^(?:https:|mailto:)/iu,
    ADD_ATTR: ['target']
  });
}
