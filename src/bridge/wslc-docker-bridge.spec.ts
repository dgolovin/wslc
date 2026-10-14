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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WslcDockerBridge, WSLC_DOCKER_PIPE_PATH } from './wslc-docker-bridge';
import net from 'node:net';
import { spawn } from 'node:child_process';

vi.mock(import('node:net'));
vi.mock(import('node:child_process'));

function createMockChild(): {
  stdin: { write: ReturnType<typeof vi.fn>; once: ReturnType<typeof vi.fn>; destroyed: boolean };
  stdout: { on: ReturnType<typeof vi.fn>; pipe: ReturnType<typeof vi.fn>; unpipe: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
  exitCode: number | null;
} {
  return {
    stdin: { write: vi.fn().mockReturnValue(true), once: vi.fn(), destroyed: false },
    stdout: { on: vi.fn(), pipe: vi.fn(), unpipe: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    killed: false,
    exitCode: null,
  };
}

describe('WslcDockerBridge', () => {
  let bridge: WslcDockerBridge;

  beforeEach(() => {
    vi.resetAllMocks();
    bridge = new WslcDockerBridge();
  });

  it('should have the default pipe path', () => {
    expect.assertions(1);

    expect(bridge.pipePath).toBe(WSLC_DOCKER_PIPE_PATH);
  });

  it('should accept a custom pipe path', () => {
    expect.assertions(1);

    const customBridge = new WslcDockerBridge('\\\\.\\pipe\\custom-pipe');
    expect(customBridge.pipePath).toBe('\\\\.\\pipe\\custom-pipe');
  });

  it('should not be running initially', () => {
    expect.assertions(1);

    expect(bridge.isRunning).toBe(false);
  });

  it('should not spawn a child process until a client connects', async () => {
    expect.assertions(1);

    const mockServer = {
      listen: vi.fn<(path: string, callback: () => void) => void>().mockImplementation((_path, callback) => {
        callback();
      }),
      listening: true,
      on: vi.fn(),
      close: vi.fn(),
    };
    vi.mocked(net.createServer).mockReturnValue(mockServer as unknown as net.Server);

    await bridge.start();

    expect(spawn).not.toHaveBeenCalled();
  });

  it('should spawn a dial-stdio child per client connection', async () => {
    expect.assertions(3);

    const mockChild = createMockChild();
    vi.mocked(spawn).mockReturnValue(mockChild as never);

    let connectionHandler: ((socket: net.Socket) => void) | undefined;
    const mockServer = {
      listen: vi.fn<(path: string, callback: () => void) => void>().mockImplementation((_path, callback) => {
        callback();
      }),
      listening: true,
      on: vi.fn(),
      close: vi.fn(),
    };
    vi.mocked(net.createServer).mockImplementation(((handler: (socket: net.Socket) => void) => {
      connectionHandler = handler;
      return mockServer;
    }) as unknown as typeof net.createServer);

    await bridge.start();

    const mockClient = {
      on: vi.fn().mockReturnThis(),
      pause: vi.fn(),
      resume: vi.fn(),
      destroy: vi.fn(),
      end: vi.fn(),
      destroyed: false,
    };

    connectionHandler?.(mockClient as unknown as net.Socket);
    connectionHandler?.(mockClient as unknown as net.Socket);

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledWith(
      'wslc.exe',
      ['system', 'session', 'run', 'docker', 'system', 'dial-stdio'],
      expect.objectContaining({ windowsHide: true }),
    );
    expect(bridge.activeConnections).toBe(2);
  });

  it('should start the named pipe server and listen', async () => {
    expect.assertions(1);

    const mockServer = {
      listen: vi.fn<(path: string, callback: () => void) => void>().mockImplementation((_path, callback) => {
        callback();
      }),
      listening: true,
      on: vi.fn(),
      close: vi.fn(),
    };
    vi.mocked(net.createServer).mockReturnValue(mockServer as unknown as net.Server);

    await bridge.start();

    expect(mockServer.listen).toHaveBeenCalledWith(WSLC_DOCKER_PIPE_PATH, expect.any(Function));
  });

  it('should kill active children and close the server on stop', async () => {
    expect.assertions(2);

    const mockChild = createMockChild();
    vi.mocked(spawn).mockReturnValue(mockChild as never);

    let connectionHandler: ((socket: net.Socket) => void) | undefined;
    const mockServer = {
      listen: vi.fn<(path: string, callback: () => void) => void>().mockImplementation((_path, callback) => {
        callback();
      }),
      listening: true,
      on: vi.fn(),
      close: vi.fn<(callback: () => void) => void>().mockImplementation(callback => {
        callback();
      }),
    };
    vi.mocked(net.createServer).mockImplementation(((handler: (socket: net.Socket) => void) => {
      connectionHandler = handler;
      return mockServer;
    }) as unknown as typeof net.createServer);

    await bridge.start();

    const mockClient = {
      on: vi.fn().mockReturnThis(),
      pause: vi.fn(),
      resume: vi.fn(),
      destroy: vi.fn(),
      end: vi.fn(),
      destroyed: false,
    };
    connectionHandler?.(mockClient as unknown as net.Socket);

    await bridge.stop();

    expect(mockChild.kill).toHaveBeenCalled();
    expect(mockServer.close).toHaveBeenCalled();
  });

  it('should not start if already started', async () => {
    expect.assertions(1);

    const mockServer = {
      listen: vi.fn<(path: string, callback: () => void) => void>().mockImplementation((_path, callback) => {
        callback();
      }),
      listening: true,
      on: vi.fn(),
      close: vi.fn(),
    };
    vi.mocked(net.createServer).mockReturnValue(mockServer as unknown as net.Server);

    await bridge.start();
    await bridge.start();

    // Server created only once
    expect(net.createServer).toHaveBeenCalledTimes(1);
  });

  it('should resolve immediately if stop is called without start', async () => {
    expect.assertions(1);

    await bridge.stop();
    expect(bridge.isRunning).toBe(false);
  });

  it('should intercept and log HTTP requests from the client', async () => {
    expect.assertions(2);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const mockChild = createMockChild();
    vi.mocked(spawn).mockReturnValue(mockChild as never);

    let connectionHandler: ((socket: net.Socket) => void) | undefined;
    const mockServer = {
      listen: vi.fn<(path: string, callback: () => void) => void>().mockImplementation((_path, callback) => {
        callback();
      }),
      listening: true,
      on: vi.fn(),
      close: vi.fn(),
    };
    vi.mocked(net.createServer).mockImplementation(((handler: (socket: net.Socket) => void) => {
      connectionHandler = handler;
      return mockServer;
    }) as unknown as typeof net.createServer);

    await bridge.start();

    const dataHandlers: Array<(chunk: Buffer) => void> = [];
    const mockClient = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'data') {
          dataHandlers.push(handler as (chunk: Buffer) => void);
        }
        return mockClient;
      }),
      pause: vi.fn(),
      resume: vi.fn(),
      destroy: vi.fn(),
      end: vi.fn(),
      destroyed: false,
    };

    connectionHandler?.(mockClient as unknown as net.Socket);

    const request = Buffer.from('GET /v1.41/images/json HTTP/1.1\r\nHost: localhost\r\n\r\n');
    for (const handler of dataHandlers) {
      handler(request);
    }

    expect(mockChild.stdin.write).toHaveBeenCalledWith(request);
    expect(logSpy).toHaveBeenCalledWith('[wslc-bridge] GET /v1.41/images/json');

    logSpy.mockRestore();
  });
});
