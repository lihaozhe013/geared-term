import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { launchApp, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session?.close();
});

test('searches and saves a discovered model beyond the first 256 results', async () => {
  const models = Array.from({ length: 300 }, (_, index) => ({
    id: `openrouter/model-${String(index).padStart(3, '0')}`
  }));
  const server = createServer((request, response) => {
    if (request.url !== '/v1/models') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: models }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address() as AddressInfo;
    const { page, app } = session;
    await page.getByRole('button', { name: 'Settings' }).click();
    const settingsWindow = await app.waitForEvent('window');
    await settingsWindow.waitForLoadState('domcontentloaded');
    await settingsWindow.getByRole('button', { name: 'AI Connections' }).click();

    const editor = settingsWindow.locator('.connection-editor');
    await editor
      .locator('.settings-row')
      .filter({ hasText: 'Connection name' })
      .locator('input')
      .fill('OpenRouter fixture');
    await editor.locator('select').first().selectOption('chat-completions');
    await editor
      .locator('.settings-row')
      .filter({ hasText: 'API endpoint (base URL)' })
      .locator('input')
      .fill(`http://127.0.0.1:${address.port}/v1`);
    await editor.getByRole('button', { name: 'Discover models' }).click();

    await expect(editor.locator('.discovered-model-row')).toHaveCount(100);
    const search = editor.getByRole('searchbox', { name: 'Search discovered models' });
    await search.fill('MODEL 299');
    await expect(editor.locator('.discovered-model-row')).toHaveCount(1);
    await editor.getByRole('button', { name: 'Add model openrouter/model-299' }).click();
    await expect(editor.getByRole('button', { name: 'Added openrouter/model-299' })).toBeDisabled();

    await editor.getByRole('button', { name: 'Save connection' }).click();
    await expect(editor.locator('.status-ok')).toContainText('Saved');
    const savedModels = await settingsWindow.evaluate(async () => {
      const bridge = (
        window as unknown as {
          geared: {
            listAiConnections: () => Promise<
              Array<{ name: string; models: Array<{ model: string }> }>
            >;
          };
        }
      ).geared;
      const connections = await bridge.listAiConnections();
      return connections.find((connection) => connection.name === 'OpenRouter fixture')?.models;
    });
    expect(savedModels?.map((model) => model.model)).toContain('openrouter/model-299');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
