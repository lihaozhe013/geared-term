// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  ADAPTERS,
  adapterForHost,
  buildGroups,
  collectBlocks,
  findBlockElement,
  probeChatSurface,
  probeGenerating,
  rowsForBlock,
  type BlockTimeline
} from './extract';

const chatgptAdapter = ADAPTERS[0]!;
const deepseekAdapter = ADAPTERS[1]!;

function loadDocument(html: string): void {
  document.documentElement.innerHTML = html;
}

describe('adapter routing', () => {
  it('resolves adapters by chat hostnames only', () => {
    expect(adapterForHost('chatgpt.com')?.id).toBe('chatgpt');
    expect(adapterForHost('chat.openai.com')?.id).toBe('chatgpt');
    expect(adapterForHost('auth.openai.com')?.id).toBeUndefined();
    expect(adapterForHost('chat.deepseek.com')?.id).toBe('deepseek');
    expect(adapterForHost('evil-chatgpt.com')?.id).toBeUndefined();
  });
});

describe('chatgpt fixture', () => {
  const html = `
    <div id="root">
      <div data-message-author-role="assistant">
        <div class="markdown">
          <div class="token-wrapper"><span>bash</span><button>Copy</button></div>
          <pre><code class="language-bash"># Update package index
sudo apt update

# Install ffmpeg
sudo apt install -y ffmpeg

ffmpeg -version
</code></pre>
        </div>
      </div>
      <div data-message-author-role="assistant">
        <pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>
      </div>
      <textarea id="prompt-textarea"></textarea>
    </div>`;

  it('collects pre blocks inside assistant messages in document order', () => {
    loadDocument(html);
    const blocks = collectBlocks(chatgptAdapter, document);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.textContent).toContain('sudo apt update');
  });

  it('splits annotated bash blocks into independent rows', () => {
    loadDocument(html);
    const groups = buildGroups(chatgptAdapter, document, 10_000, false, new WeakMap());
    expect(groups).toHaveLength(2);
    const [first, second] = groups as [
      NonNullable<(typeof groups)[number]>,
      NonNullable<(typeof groups)[number]>
    ];
    expect(first?.wholeBlock).toBe(false);
    expect(first?.rows.map((row) => row.exactText)).toEqual([
      '# Update package index\nsudo apt update',
      '# Install ffmpeg\nsudo apt install -y ffmpeg',
      'ffmpeg -version'
    ]);
    expect(first?.rows.map((row) => row.risk)).toEqual(['destructive', 'destructive', 'normal']);
    expect(first?.rows.every((row) => row.runAllowed)).toBe(true);
  });

  it('keeps an unknown-language block as a non-runnable whole block', () => {
    loadDocument(html);
    const groups = buildGroups(chatgptAdapter, document, 10_000, false, new WeakMap());
    const mermaid = groups[1]!;
    expect(mermaid.wholeBlock).toBe(true);
    expect(mermaid.rows).toHaveLength(1);
    expect(mermaid.rows[0]?.runAllowed).toBe(false);
    expect(mermaid.rows[0]?.shell).toBe('unknown');
  });

  it('detects the chat surface and the generating stop button', () => {
    loadDocument(html);
    expect(probeChatSurface(chatgptAdapter, document)).toBe(true);
    expect(probeGenerating(chatgptAdapter, document)).toBe(false);
    loadDocument(html.replace('<textarea id="prompt-textarea"></textarea>', ''));
    expect(probeChatSurface(chatgptAdapter, document)).toBe(false);
    loadDocument('<button data-testid="stop-button" aria-label="Stop generating"></button>');
    expect(probeGenerating(chatgptAdapter, document)).toBe(true);
  });

  it('marks blocks streaming while the site generates or recently changed', () => {
    loadDocument(html);
    const timeline: BlockTimeline = new WeakMap();
    const early = buildGroups(chatgptAdapter, document, 1_000, false, timeline);
    expect(early[0]?.streaming).toBe(true);
    const settled = buildGroups(chatgptAdapter, document, 10_000, false, timeline);
    expect(settled[0]?.streaming).toBe(false);
    const generating = buildGroups(chatgptAdapter, document, 10_000, true, timeline);
    expect(generating[0]?.streaming).toBe(true);
  });

  it('block ids are content-derived, survive re-renders, and change with content', () => {
    loadDocument(html);
    const timeline: BlockTimeline = new WeakMap();
    const first = buildGroups(chatgptAdapter, document, 10_000, false, timeline);
    expect(first[0]!.blockId.split(':')[0]).toMatch(/^[0-9a-f]{16}$/u);

    loadDocument(html);
    const rerendered = buildGroups(chatgptAdapter, document, 20_000, false, new WeakMap());
    expect(rerendered.map((group) => group.blockId)).toEqual(first.map((group) => group.blockId));

    const code = document.querySelector('pre code')!;
    code.textContent = 'echo changed\n';
    const changed = buildGroups(chatgptAdapter, document, 30_000, false, new WeakMap());
    expect(changed[0]!.blockId).not.toBe(first[0]!.blockId);
    expect(changed[0]!.streaming).toBe(true);
  });

  it('findBlockElement resolves ids back to live elements and rejects foreign ids', () => {
    loadDocument(html);
    const timeline: BlockTimeline = new WeakMap();
    const groups = buildGroups(chatgptAdapter, document, 10_000, false, timeline);
    const element = findBlockElement(chatgptAdapter, document, groups[1]!.blockId);
    expect(element?.querySelector('code')?.getAttribute('class')).toContain('language-mermaid');
    expect(findBlockElement(chatgptAdapter, document, 'zzzz')).toBeUndefined();
    expect(findBlockElement(chatgptAdapter, document, `${'0'.repeat(16)}:9`)).toBeUndefined();
  });
});

describe('deepseek fixture', () => {
  const html = `
    <div class="content">
      <div class="ds-message">
        <div class="markdown">
          <pre><code class="language-shell">docker run \\
  --rm \\
  -v "$PWD:/work" \\
  ubuntu:latest
</code></pre>
          <pre><code class="language-powershell">Get-Process |
  Where-Object CPU -gt 100
</code></pre>
        </div>
      </div>
      <textarea placeholder="Send a message"></textarea>
    </div>`;

  it('extracts shell and powershell blocks and splits them correctly', () => {
    loadDocument(html);
    expect(probeChatSurface(deepseekAdapter, document)).toBe(true);
    const groups = buildGroups(deepseekAdapter, document, 10_000, false, new WeakMap());
    expect(groups).toHaveLength(2);
    expect(groups[0]?.rows).toHaveLength(1);
    expect(groups[0]?.rows[0]?.shell).toBe('bash');
    expect(groups[0]?.rows[0]?.exactText).toContain('--rm');
    expect(groups[0]?.rows[0]?.exactText).toContain('ubuntu:latest');
    expect(groups[1]?.rows[0]?.shell).toBe('powershell');
    expect(groups[1]?.wholeBlock).toBe(true);
  });
});

describe('rowsForBlock fidelity', () => {
  it('preserves a heredoc as one row', () => {
    const { rows, wholeBlock } = rowsForBlock(
      'b:0',
      'cat > f <<EOF\nalpha=1\nEOF\nsystemctl restart app',
      'bash'
    );
    expect(wholeBlock).toBe(false);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.exactText).toBe('cat > f <<EOF\nalpha=1\nEOF');
    expect(rows[1]?.exactText).toBe('systemctl restart app');
  });

  it('keeps an incomplete fence out of run range', () => {
    const { rows } = rowsForBlock('b:0', 'printf "unfinished\n', 'bash');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.stability).toBe('incomplete');
    expect(rows[0]?.runAllowed).toBe(false);
  });
});
