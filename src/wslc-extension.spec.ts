/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import type { ExtensionContext } from '@podman-desktop/api';
import { env } from '@podman-desktop/api';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Container, ServiceIdentifier } from 'inversify';
import { WslcExtension } from './wslc-extension';
import { ContainerProviderManager } from './manager/container-provider-manager';
import { InversifyBinding } from './inject/inversify-binding';

let extensionContextMock: ExtensionContext;
let wslcExtension: TestWslcExtension;

vi.mock(import('./manager/container-provider-manager'));

class TestWslcExtension extends WslcExtension {
  public async deferActivate(): Promise<void> {
    return super.deferActivate();
  }

  public getContainer(): Container | undefined {
    return super.getContainer();
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();

  // Create a mock for the ExtensionContext
  extensionContextMock = {} as ExtensionContext;
  wslcExtension = new TestWslcExtension(extensionContextMock);
});

test('should activate correctly', async () => {
  expect.assertions(1);

  await wslcExtension.activate();

  expect(wslcExtension.getContainer()?.get(ContainerProviderManager)).toBeInstanceOf(
    ContainerProviderManager,
  );
});

test('should call deferActivate correctly on Windows', async () => {
  expect.assertions(1);

  // Mock isWindows
  (env.isWindows as boolean) = true;
  await wslcExtension.activate();

  // Check we called the registration methods
  await vi.waitFor(() => {
    expect(ContainerProviderManager.prototype.registerContainerProvider).toHaveBeenCalledWith();
  });
});

test('should deactivate correctly', async () => {
  expect.assertions(2);

  await wslcExtension.activate();

  expect(wslcExtension.getContainer()?.isBound(ContainerProviderManager)).toBe(true);

  await wslcExtension.deactivate();

  // Check the bindings are gone
  expect(wslcExtension.getContainer()?.isBound(ContainerProviderManager)).toBe(false);
});

test('should log error if deferActivate throws', async () => {
  expect.assertions(2);

  const error = new Error('deferActivate failure');
  const spyConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  // Mock deferActivate to throw
  const spyDeferActivate = vi.spyOn(wslcExtension, 'deferActivate').mockRejectedValueOnce(error);

  await wslcExtension.activate();

  await vi.waitFor(() => {
    expect(spyDeferActivate).toHaveBeenCalledWith();
    expect(spyConsoleError).toHaveBeenCalledWith('error in deferActivate', error);
  });

  spyConsoleError.mockRestore();
});

test('should log error if getAsync for ContainerProviderManager throws', async () => {
  expect.assertions(2);

  const error = new Error('getAsync failure');
  const spyConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  // Mock the initBindings to return a container with a throwing getAsync
  const fakeContainer = {
    getAsync: vi.fn<(serviceIdentifier: ServiceIdentifier) => Promise<unknown>>().mockRejectedValueOnce(error),
  } as unknown as Container;
  const initBindingsMock = vi.fn<() => Promise<Container>>().mockResolvedValue(fakeContainer);
  const spyInitBindings = vi.spyOn(InversifyBinding.prototype, 'initBindings');
  spyInitBindings.mockImplementation(initBindingsMock);

  await wslcExtension.activate();

  expect(fakeContainer.getAsync).toHaveBeenCalledWith(ContainerProviderManager);
  expect(spyConsoleError).toHaveBeenCalledWith('Error while creating the container provider manager', error);

  spyConsoleError.mockRestore();
});
