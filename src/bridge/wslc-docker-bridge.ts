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
import { HttpRequestInterceptor } from '/@/bridge/http-request-interceptor';

/**
 * Windows named pipe path used by the WSLC Docker bridge.
 * Node.js `net` module natively supports Windows named pipes.
 */
export const WSLC_DOCKER_PIPE_PATH = '\\\\.\\pipe\\podman-desktop-wslc';

interface BridgedConnection {
  client: net.Socket;
  child: ChildProcess;
  interceptor: HttpRequestInterceptor;
}

/**
 * Creates a Windows named pipe server that bridges Docker API traffic
 * to the WSLC guest's Docker daemon.
 *
 * Each client connection gets its own
 * `wslc.exe system session run docker system dial-stdio` child process.
 * That matches how Docker remote contexts use dial-stdio (one stdio
 * session per TCP/npipe connection) and avoids "socket hang up" when
 * Podman Desktop opens concurrent API connections or when dial-stdio
 * exits after `Connection: close`.
 *
 * Client→daemon bytes are intercepted so Docker API HTTP requests can
 * be logged (method + URL) without modifying the stream.
 */
export class WslcDockerBridge {
  #server: net.Server | undefined;
  #connections = new Set<BridgedConnection>();
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

  get activeConnections(): number {
    return this.#connections.size;
  }

  /**
   * Spawns a `wslc.exe` dial-stdio child for one client connection.
   */
  protected spawnChild(): ChildProcess {
    const child = spawn(
      'wslc.exe',
      ['system', 'session', 'run', 'docker', 'system', 'dial-stdio'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    child.stderr?.on('data', (data: Buffer) => {
      console.error(`[wslc stderr]: ${data.toString()}`);
    });

    return child;
  }

  protected attachClient(clientSocket: net.Socket): void {
    const child = this.spawnChild();
    const interceptor = new HttpRequestInterceptor((method, url) => {
      console.log(`[wslc-bridge] ${method} ${url}`);
    });

    const connection: BridgedConnection = { client: clientSocket, child, interceptor };
    this.#connections.add(connection);

    const detach = (): boolean => {
      if (!this.#connections.has(connection)) {
        return false;
      }
      this.#connections.delete(connection);
      interceptor.reset();
      child.stdout?.unpipe(clientSocket);
      return true;
    };

    // Client went away: stop the dial-stdio session for this connection only
    const onClientGone = (): void => {
      if (!detach()) {
        return;
      }
      if (!child.killed && child.exitCode === null) {
        child.kill();
      }
    };

    // dial-stdio exited (normal after Connection: close): finish the client gracefully
    child.on('close', code => {
      console.log(`wslc process exited with code ${code}`);
      if (!detach()) {
        return;
      }
      if (!clientSocket.destroyed) {
        clientSocket.end();
      }
    });

    // Intercept client→daemon traffic to log HTTP requests, then forward
    clientSocket.on('data', (chunk: Buffer) => {
      interceptor.push(chunk);
      if (!child.stdin || child.stdin.destroyed) {
        return;
      }
      const ok = child.stdin.write(chunk);
      if (!ok) {
        clientSocket.pause();
        child.stdin.once('drain', () => {
          clientSocket.resume();
        });
      }
    });

    // end: true so Connection: close / dial-stdio exit finishes the HTTP client cleanly
    child.stdout?.pipe(clientSocket);

    clientSocket.on('error', error => {
      console.error('[wslc-bridge] client socket error', error);
      onClientGone();
    });

    child.on('error', error => {
      console.error('[wslc-bridge] child process error', error);
      if (!detach()) {
        return;
      }
      if (!clientSocket.destroyed) {
        clientSocket.destroy();
      }
    });

    clientSocket.on('close', () => {
      onClientGone();
    });
  }

  /**
   * Starts the named pipe server. dial-stdio children are created per client.
   */
  async start(): Promise<void> {
    if (this.#server) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const server = net.createServer(clientSocket => {
        this.attachClient(clientSocket);
      });

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          console.warn('Named pipe already in use, attempting cleanup...');
          net
            .connect(this.#pipePath, () => {
              reject(new Error(`Named pipe ${this.#pipePath} is already in use by another process`));
            })
            .on('error', () => {
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
   * Stops the named pipe server, kills active children, and cleans up.
   */
  async stop(): Promise<void> {
    for (const connection of [...this.#connections]) {
      connection.interceptor.reset();
      if (!connection.child.killed && connection.child.exitCode === null) {
        connection.child.kill();
      }
      if (!connection.client.destroyed) {
        connection.client.destroy();
      }
    }
    this.#connections.clear();

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
