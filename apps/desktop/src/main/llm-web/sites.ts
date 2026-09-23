import type { LlmWebSiteId } from '@geared-term/protocol';

export type LlmWebSiteConfig = {
  id: LlmWebSiteId;
  homeUrl: string;
  /** Registrable hosts the pane may navigate inside (subdomains included). */
  navigableHosts: string[];
  /** Hosts whose popups are treated as the site's own authentication flow. */
  popupHosts: string[];
  partition: string;
};

export const LLM_WEB_SITES: Record<LlmWebSiteId, LlmWebSiteConfig> = {
  chatgpt: {
    id: 'chatgpt',
    homeUrl: 'https://chatgpt.com/',
    navigableHosts: ['chatgpt.com', 'openai.com'],
    popupHosts: ['google.com'],
    partition: 'persist:llm-web-chatgpt'
  },
  deepseek: {
    id: 'deepseek',
    homeUrl: 'https://chat.deepseek.com/',
    navigableHosts: ['deepseek.com'],
    popupHosts: ['google.com', 'github.com'],
    partition: 'persist:llm-web-deepseek'
  }
};

export function hostMatchesRegistrable(hostname: string, root: string): boolean {
  const host = hostname.toLowerCase();
  const base = root.toLowerCase();
  return host === base || host.endsWith(`.${base}`);
}

export function siteHostAllowed(config: LlmWebSiteConfig, urlValue: string): boolean {
  try {
    const url = new URL(urlValue);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      config.navigableHosts.some((root) => hostMatchesRegistrable(url.hostname, root))
    );
  } catch {
    return false;
  }
}

export function sitePopupAllowed(config: LlmWebSiteConfig, urlValue: string): boolean {
  try {
    const url = new URL(urlValue);
    return (
      url.protocol === 'https:' &&
      config.popupHosts.some((root) => hostMatchesRegistrable(url.hostname, root))
    );
  } catch {
    return false;
  }
}
