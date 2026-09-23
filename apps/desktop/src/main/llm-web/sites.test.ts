import { describe, expect, it } from 'vitest';
import { hostMatchesRegistrable, LLM_WEB_SITES, siteHostAllowed, sitePopupAllowed } from './sites';

describe('host matching', () => {
  it('matches registrable hosts and subdomains case-insensitively', () => {
    expect(hostMatchesRegistrable('ChatGPT.COM', 'chatgpt.com')).toBe(true);
    expect(hostMatchesRegistrable('auth.openai.com', 'openai.com')).toBe(true);
    expect(hostMatchesRegistrable('openai.com', 'openai.com')).toBe(true);
    expect(hostMatchesRegistrable('evil-openai.com', 'openai.com')).toBe(false);
    expect(hostMatchesRegistrable('notopenai.com', 'openai.com')).toBe(false);
  });
});

describe('site navigation policy', () => {
  it('allows same-site pages including sign-in hops', () => {
    expect(siteHostAllowed(LLM_WEB_SITES.chatgpt, 'https://chatgpt.com/chat/abc')).toBe(true);
    expect(siteHostAllowed(LLM_WEB_SITES.chatgpt, 'https://auth.openai.com/sign-in')).toBe(true);
    expect(siteHostAllowed(LLM_WEB_SITES.deepseek, 'https://chat.deepseek.com/')).toBe(true);
  });

  it('rejects foreign hosts, lookalikes, and dangerous schemes', () => {
    expect(siteHostAllowed(LLM_WEB_SITES.chatgpt, 'https://chatgpt.com.evil.test/x')).toBe(false);
    expect(siteHostAllowed(LLM_WEB_SITES.chatgpt, 'https://evil.test/')).toBe(false);
    expect(siteHostAllowed(LLM_WEB_SITES.chatgpt, 'file:///etc/passwd')).toBe(false);
    expect(siteHostAllowed(LLM_WEB_SITES.chatgpt, 'javascript:alert(1)')).toBe(false);
    expect(siteHostAllowed(LLM_WEB_SITES.chatgpt, 'not a url')).toBe(false);
  });
});

describe('popup allowlist', () => {
  it('permits authentication popups only over https on declared hosts', () => {
    expect(
      sitePopupAllowed(LLM_WEB_SITES.deepseek, 'https://github.com/login/oauth/authorize')
    ).toBe(true);
    expect(sitePopupAllowed(LLM_WEB_SITES.deepseek, 'https://accounts.google.com/o/oauth2')).toBe(
      true
    );
    expect(sitePopupAllowed(LLM_WEB_SITES.chatgpt, 'https://github.com/login')).toBe(false);
    expect(sitePopupAllowed(LLM_WEB_SITES.deepseek, 'http://github.com/login')).toBe(false);
    expect(sitePopupAllowed(LLM_WEB_SITES.deepseek, 'https://github.com.evil.test/')).toBe(false);
  });
});
