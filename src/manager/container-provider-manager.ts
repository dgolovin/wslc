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

import { inject, injectable } from 'inversify';
import { ExtensionContextSymbol, TelemetryLoggerSymbol } from '/@/inject/symbol';
import {
  type ProviderConnectionStatus,
  type ExtensionContext,
  provider,
  process,
  ContainerProviderConnection,
  Provider,
  Disposable,
  TelemetryLogger,
  TelemetryTrustedValue,
} from '@podman-desktop/api';
import { WslcDockerBridge, WSLC_DOCKER_PIPE_PATH } from '/@/bridge/wslc-docker-bridge';

/**
 * Manager for the WSLC container provider.
 * Bridges Docker API traffic from the Windows host to the WSLC guest
 * using a Node.js named pipe server instead of an external executable.
 */
@injectable()
export class ContainerProviderManager {
  public static readonly PROVIDER_ID = 'wslc-container';

  @inject(ExtensionContextSymbol)
  private readonly extensionContext: ExtensionContext;

  @inject(TelemetryLoggerSymbol)
  private readonly telemetryLogger: TelemetryLogger;

  #bridge: WslcDockerBridge | undefined;

  #connectionDisposable: Disposable | undefined;

  #containerProviderConnection: ContainerProviderConnection | undefined;

  #stopMonitoringStatus = false;

  async registerContainerProvider(): Promise<void> {
    this.#stopMonitoringStatus = false;
    const wslcProvider = provider.createProvider({
      name: 'WSLC',
      id: ContainerProviderManager.PROVIDER_ID,
      status: 'unknown',
      images: {
        icon: './icon.png',
        logo: './logo.png',
      },
    });
    this.extensionContext.subscriptions.push(wslcProvider);

    this.monitorContainerSystemStatus(wslcProvider).catch((error: unknown) => {
      console.error('Error monitoring WSLC status', error);
    });
  }

  async deactivate(): Promise<void> {
    this.#stopMonitoringStatus = true;
    if (this.#bridge) {
      await this.cleanupConnection();
    }
  }

  async timeout(time: number): Promise<void> {
    return new Promise<void>(resolve => {
      setTimeout(resolve, time);
    });
  }

  async cleanupConnection(): Promise<void> {
    // Stop connection
    this.#connectionDisposable?.dispose();
    if (this.#connectionDisposable) {
      this.extensionContext.subscriptions.splice(
        this.extensionContext.subscriptions.indexOf(this.#connectionDisposable!),
        1,
      );
    }
    this.#connectionDisposable = undefined;

    this.#containerProviderConnection = undefined;

    // Stop the bridge server
    await this.#bridge?.stop();
    this.#bridge = undefined;
  }

  async updateContainerSystemStatus(wslcProvider: Provider): Promise<void> {
    // Check if wslc.exe is installed by running --version
    let systemInstalled = false;
    const telemetryProperties: Record<string, string | TelemetryTrustedValue> = {};
    try {
      const { stdout } = await process.exec('wslc.exe', ['--version']);
      telemetryProperties.version = stdout.trim();
      systemInstalled = true;
    } catch (error: unknown) {
      console.error('Error checking wslc.exe version', error);
    }

    if (systemInstalled) {
      wslcProvider.updateStatus('installed');
    } else {
      wslcProvider.updateStatus('unknown');
      await this.cleanupConnection();
      return;
    }

    // Check if Docker is accessible through WSLC session
    let systemRunning = false;
    try {
      await process.exec('wslc.exe', ['system', 'session', 'run', 'docker', 'info']);
      systemRunning = true;
    } catch (error: unknown) {
      console.error('Error checking WSLC Docker status', error);
    }

    if (systemRunning) {
      // Already connected — nothing to do
      if (this.#containerProviderConnection) {
        console.log('WSLC container provider connection already started');
        return;
      }

      wslcProvider.updateStatus('ready');

      // Start the named pipe bridge
      this.#bridge = new WslcDockerBridge();
      try {
        await this.#bridge.start();
      } catch (error: unknown) {
        console.error('Error starting WSLC Docker bridge', error);
        await this.cleanupConnection();
        wslcProvider.updateStatus('stopped');
        return;
      }

      console.log('WSLC Docker bridge started on named pipe', WSLC_DOCKER_PIPE_PATH);

      let providerState: ProviderConnectionStatus = 'starting';

      this.#containerProviderConnection = {
        name: 'WSLC',
        type: 'docker',
        status: (): ProviderConnectionStatus => providerState,
        endpoint: {
          socketPath: WSLC_DOCKER_PIPE_PATH,
        },
      };

      // Brief delay to let the named pipe server stabilize
      await this.timeout(1000);
      providerState = 'started';
      this.#connectionDisposable = wslcProvider.registerContainerProviderConnection(
        this.#containerProviderConnection,
      );
      this.telemetryLogger.logUsage('registeredConnection', telemetryProperties);
      this.extensionContext.subscriptions.push(this.#connectionDisposable);
    } else {
      // Cleanup any existing connection
      await this.cleanupConnection();
      wslcProvider.updateStatus('stopped');
    }
  }

  async monitorContainerSystemStatus(wslcProvider: Provider): Promise<void> {
    if (!this.#stopMonitoringStatus) {
      try {
        await this.updateContainerSystemStatus(wslcProvider);
      } catch (error: unknown) {
        console.trace('Error updating WSLC container system status', error);
      }

      await this.timeout(30000);
      this.monitorContainerSystemStatus(wslcProvider).catch((error: unknown) => {
        console.error('Error monitoring WSLC status', error);
      });
    }
  }
}
