import type { ExtensionContext } from '@podman-desktop/api';
import { beforeEach, expect, test, vi } from 'vitest';
import { activate, deactivate } from './main';
import { WslcExtension } from './wslc-extension';

let extensionContextMock: ExtensionContext;

vi.mock(import('./wslc-extension'));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();

  // Create a mock for the ExtensionContext
  extensionContextMock = {} as ExtensionContext;
});

test('should initialize and activate the WslcExtension when activate is called', async () => {
  expect.assertions(1);

  // Call activate
  await activate(extensionContextMock);

  // Ensure that the WslcExtension is instantiated and its activate method is called
  expect(WslcExtension.prototype.activate).toHaveBeenCalledWith();
});

test('should call deactivate when deactivate is called', async () => {
  expect.assertions(1);

  // Call activate first to initialize WslcExtension
  await activate(extensionContextMock);

  // Call deactivate
  await deactivate();

  // Ensure that the deactivate method was called
  expect(WslcExtension.prototype.deactivate).toHaveBeenCalledWith();
});

test('should set wslcExtension to undefined after deactivate is called', async () => {
  expect.assertions(2);

  // Call activate to initialize the extension
  await activate(extensionContextMock);

  // Call deactivate
  await deactivate();

  expect(global).toHaveProperty('wslcExtension');
  expect((global as Record<string, unknown>).wslcExtension).toBeUndefined();
});
