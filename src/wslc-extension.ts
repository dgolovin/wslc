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

import { type TelemetryLogger, type ExtensionContext, env } from '@podman-desktop/api';
import { InversifyBinding } from './inject/inversify-binding';
import type { Container } from 'inversify';
import { ContainerProviderManager } from './manager/container-provider-manager';
import { platform } from 'node:os';

export class WslcExtension {
  readonly #extensionContext: ExtensionContext;

  #containerProviderManager: ContainerProviderManager | undefined;

  #inversifyBinding: InversifyBinding | undefined;

  #container: Container | undefined;

  #telemetryLogger: TelemetryLogger | undefined;

  constructor(readonly extensionContext: ExtensionContext) {
    this.#extensionContext = extensionContext;
  }

  async activate(): Promise<void> {
    const telemetryLogger = env.createTelemetryLogger();
    this.#telemetryLogger = telemetryLogger;
    this.#inversifyBinding = new InversifyBinding(this.#extensionContext, telemetryLogger);
    this.#container = await this.#inversifyBinding.initBindings();

    try {
      this.#containerProviderManager = await this.getContainer()?.getAsync(ContainerProviderManager);
    } catch (e) {
      console.error('Error while creating the container provider manager', e);
      return;
    }

    // Perform the registration after the startup to not hold up the startup
    this.deferActivate().catch((e: unknown) => {
      console.error('error in deferActivate', e);
    });
  }

  protected async deferActivate(): Promise<void> {
    if (env.isWindows) {
      console.log('WSLC Extension activated on Windows');
      this.#telemetryLogger?.logUsage('activated');
      await this.#containerProviderManager?.registerContainerProvider();
    } else {
      this.#telemetryLogger?.logError('invalidPlatform', { platform: platform() });
      console.warn('WSLC Extension not started: can only be activated on Windows');
    }
  }

  async deactivate(): Promise<void> {
    await this.#inversifyBinding?.dispose();
    await this.#containerProviderManager?.deactivate();
    this.#containerProviderManager = undefined;
  }

  protected getContainer(): Container | undefined {
    return this.#container;
  }
}
