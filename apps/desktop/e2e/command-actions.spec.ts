import { expect, test } from '@playwright/test';
import { commandRevision } from '@geared-term/command-parser';
import { launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
  await openLocalTab(session.app);
});

test.afterEach(async () => {
  await session?.close();
});

async function activeSessionId(page: AppSession['page']): Promise<string> {
  const wrapper = page.locator('.terminal-wrapper:not([hidden])');
  const sessionId = await wrapper.getAttribute('data-session-id');
  if (!sessionId) throw new Error('Active terminal did not expose a session id');
  return sessionId;
}

async function waitForRunning(page: AppSession['page']): Promise<void> {
  await expect(page.locator('.statusbar-state')).toHaveText('Running', { timeout: 30_000 });
}

function activeTerminal(page: AppSession['page']) {
  return page.locator('.terminal-wrapper:not([hidden]) .xterm-rows');
}

test('rejects command actions whose revision is stale', async () => {
  const { page } = session;
  await waitForRunning(page);
  const sessionId = await activeSessionId(page);
  await expect(
    page.evaluate(
      ([id]) => {
        const request = {
          sessionId: id,
          action: 'insert' as const,
          shell: 'powershell' as const,
          payload: 'echo geared-e2e',
          revision: 'not-the-current-revision'
        };
        return (
          window as unknown as {
            geared: {
              executeCommandAction: (input: typeof request) => Promise<{ accepted: boolean }>;
            };
          }
        ).geared.executeCommandAction(request);
      },
      [sessionId]
    )
  ).rejects.toThrow(/changed before/u);
});

test('rejects unsafe or destructive run actions', async () => {
  const { page } = session;
  await waitForRunning(page);
  const sessionId = await activeSessionId(page);
  const payload = 'Remove-Item -Recurse -Force C:\\';
  await expect(
    page.evaluate(
      ([id, text, revision]) => {
        const request = {
          sessionId: id,
          action: 'run' as const,
          shell: 'powershell' as const,
          payload: text,
          revision
        };
        return (
          window as unknown as {
            geared: {
              executeCommandAction: (input: typeof request) => Promise<{ accepted: boolean }>;
            };
          }
        ).geared.executeCommandAction(request);
      },
      [sessionId, payload, commandRevision(payload)]
    )
  ).rejects.toThrow(/not safe to run/u);
});

test('inserts commands into the terminal through the gated action', async () => {
  const { page } = session;
  await waitForRunning(page);
  const sessionId = await activeSessionId(page);
  const payload = 'echo geared-e2e-inserted';
  const result = await page.evaluate(
    ([id, text, revision]) => {
      const request = {
        sessionId: id,
        action: 'insert' as const,
        shell: 'powershell' as const,
        payload: text,
        revision
      };
      return (
        window as unknown as {
          geared: {
            executeCommandAction: (input: typeof request) => Promise<{ accepted: boolean }>;
          };
        }
      ).geared.executeCommandAction(request);
    },
    [sessionId, payload, commandRevision(payload)]
  );
  expect(result.accepted).toBe(true);
  await expect(activeTerminal(page)).toContainText('geared-e2e-inserted', { timeout: 15_000 });
});

test('runs destructive commands once allowRiskyRun is enabled', async () => {
  const { page } = session;
  await waitForRunning(page);
  const sessionId = await activeSessionId(page);
  const payload = 'echo geared-e2e-risky; rm -rf /tmp/opencode/geared-e2e-missing';
  const runDestructive = () =>
    page.evaluate(
      ([id, text, revision]) => {
        const request = {
          sessionId: id,
          action: 'run' as const,
          shell: 'bash' as const,
          payload: text,
          revision
        };
        return (
          window as unknown as {
            geared: {
              executeCommandAction: (input: typeof request) => Promise<{ accepted: boolean }>;
            };
          }
        ).geared.executeCommandAction(request);
      },
      [sessionId, payload, commandRevision(payload)]
    );

  await expect(runDestructive()).rejects.toThrow(/not safe to run/u);

  const settings = await page.evaluate(() =>
    (
      window as unknown as {
        geared: { getSettings: () => Promise<Record<string, unknown>> };
      }
    ).geared.getSettings()
  );
  await page.evaluate((current) => {
    return (
      window as unknown as {
        geared: {
          saveSettings: (next: Record<string, unknown>) => Promise<Record<string, unknown>>;
        };
      }
    ).geared.saveSettings({ ...current, allowRiskyRun: true });
  }, settings);

  expect((await runDestructive()).accepted).toBe(true);
  await expect(activeTerminal(page)).toContainText('geared-e2e-risky', { timeout: 15_000 });

  await page.evaluate((current) => {
    return (
      window as unknown as {
        geared: {
          saveSettings: (next: Record<string, unknown>) => Promise<Record<string, unknown>>;
        };
      }
    ).geared.saveSettings({ ...current, allowRiskyRun: false });
  }, settings);
});
