// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('assistant markdown rendering', () => {
  it('renders basic markdown structure', () => {
    const html = renderMarkdown('# Title\n\nsome **bold** text');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('strips scripts, event handlers, and javascript urls', () => {
    const html = renderMarkdown(
      'hello <script>alert(1)</script><img src=x onerror=alert(1)>[x](javascript:alert(1))'
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
  });

  it('keeps https links and drops other protocols', () => {
    const html = renderMarkdown('[docs](https://example.test/a) [bad](file:///etc/passwd)');
    expect(html).toContain('href="https://example.test/a"');
    expect(html).not.toContain('file://');
  });

  it('syntax highlights code blocks with class hooks', () => {
    const html = renderMarkdown('```bash\nls -la\n```');
    expect(html).toContain('<pre><code class="hljs language-bash">');
    expect(html).toContain('hljs-');
  });

  it('renders inline code and lists', () => {
    const html = renderMarkdown('- a\n- b\n\nuse `rg` here');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<code>rg</code>');
  });
});
