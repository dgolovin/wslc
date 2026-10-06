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

import net from 'node:net';
import { type ChildProcess, spawn } from 'node:child_process';

/**
 * Windows named pipe path used by the WSLC Docker bridge.
 * Node.js `net` module natively supports Windows named pipes.
 */
export const WSLC_DOCKER_PIPE_PATH = '\\\\.\\pipe\\podman-desktop-wslc';

/**
 * Creates a Windows named pipe server that bridges Docker API traffic
 * to the WSLC guest's Docker daemon using a single persistent
 * `wslc.exe system session run docker system dial-stdio` child process
 * per Podman Desktop session.
 *
 * When the bridge starts it spawns one `wslc.exe` process whose stdio
 * is connected to the Docker daemon inside WSL.  The named pipe server
 * accepts one active client at a time (Podman Desktop's Docker API
 * client) and forwards traffic bidirectionally through that single
 * child process.  If the child dies it is respawned on the next
 * incoming connection.
 *
 * This replaces the need for an external bridge executable (like
 * socktainer in the Apple Container extension) by using Node.js native
 * npipe support.
 */
export class WslcDockerBridge {
  #server: net.Server | undefined;
  #child: ChildProcess | undefined;
  #activeClient: net.Socket | undefined;
  #pipePath: string;

  constructor(pipePath: string = WSLC_DOCKER_PIPE_PATH) {
    this.#pipePath = pipePath;
  }

  get pipePath(): string {
    return this.#pipePath;
  }

  get isRunning(): boolean {
    return this.#server?.listening === true;
  }

  /**
   * Spawns (or respawns) the single `wslc.exe` child process.
   * If a previous child is still alive it is killed first.
   */
  spawnChild(): void {
    this.#child?.kill();

    this.#child = spawn(
      'wslc.exe',
      ['system', 'session', 'run', 'docker', 'system', 'dial-stdio'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    this.#child.stderr?.on('data', (data: Buffer) => {
      console.error(`[wslc stderr]: ${data.toString()}`);
    });

    this.#child.on('close', code => {
      console.log(`wslc process exited with code ${code}`);
      this.#child = undefined;
      // Backend died — tear down the active client so Podman Desktop
      // knows the connection is gone and can reconnect.
      this.#activeClient?.destroy();
      this.#activeClient = undefined;
    });
  }

  /**
   * Starts the named pipe server and the backing `wslc.exe` process.
   *
   * Only one client connection is active at a time.  When a new client
   * connects any previous client is disconnected.  If the child process
   * has exited it is automatically respawned for the new connection.
   */
  async start(): Promise<void> {
    if (this.#server) {
      return;
    }

    this.spawnChild();

    return new Promise<void>((resolve, reject) => {
      const server = net.createServer(clientSocket => {
        // Only one active client at a time
        if (this.#activeClient) {
          this.#activeClient.destroy();
        }
        this.#activeClient = clientSocket;

        // Respawn child if it died since last connection
        if (!this.#child || this.#child.exitCode !== undefined) {
          this.spawnChild();
        }

        const child = this.#child!;
        clientSocket.pipe(child.stdin!, { end: false });
        child.stdout!.pipe(clientSocket, { end: false });

        clientSocket.on('error', () => {
          child.stdout!.unpipe(clientSocket);
        });

        clientSocket.on('close', () => {
          if (this.#activeClient === clientSocket) {
            this.#activeClient = undefined;
          }
          child.stdout!.unpipe(clientSocket);
        });
      });

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          console.warn('Named pipe already in use, attempting cleanup...');
          net.connect(this.#pipePath, () => {
            reject(new Error(`Named pipe ${this.#pipePath} is already in use by another process`));
          }).on('error', () => {
            // Pipe is stale — remove and retry
            server.listen(this.#pipePath, () => {
              this.#server = server;
              resolve();
            });
          });
        } else {
          reject(error);
        }
      });

      server.listen(this.#pipePath, () => {
        this.#server = server;
        resolve();
      });
    });
  }

  /**
   * Stops the named pipe server, kills the child process, and cleans up.
   */
  async stop(): Promise<void> {
    this.#activeClient?.destroy();
    this.#activeClient = undefined;

    this.#child?.kill();
    this.#child = undefined;

    return new Promise<void>(resolve => {
      if (this.#server) {
        this.#server.close(() => {
          this.#server = undefined;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
