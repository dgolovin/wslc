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

  it('should spawn a single child process on start', async () => {
    expect.assertions(2);

    const mockChild = {
      stdin: { write: vi.fn() },
      stdout: { on: vi.fn(), pipe: vi.fn(), unpipe: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      exitCode: undefined,
    };
    vi.mocked(spawn).mockReturnValue(mockChild as never);

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

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      'wslc.exe',
      ['system', 'session', 'run', 'docker', 'system', 'dial-stdio'],
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it('should start the named pipe server and listen', async () => {
    expect.assertions(1);

    const mockChild = {
      stdin: { write: vi.fn() },
      stdout: { on: vi.fn(), pipe: vi.fn(), unpipe: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      exitCode: undefined,
    };
    vi.mocked(spawn).mockReturnValue(mockChild as never);

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

  it('should kill the child process and close the server on stop', async () => {
    expect.assertions(2);

    const mockChild = {
      stdin: { write: vi.fn() },
      stdout: { on: vi.fn(), pipe: vi.fn(), unpipe: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      exitCode: undefined,
    };
    vi.mocked(spawn).mockReturnValue(mockChild as never);

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
    vi.mocked(net.createServer).mockReturnValue(mockServer as unknown as net.Server);

    await bridge.start();
    await bridge.stop();

    expect(mockChild.kill).toHaveBeenCalled();
    expect(mockServer.close).toHaveBeenCalled();
  });

  it('should not start if already started', async () => {
    expect.assertions(1);

    const mockChild = {
      stdin: { write: vi.fn() },
      stdout: { on: vi.fn(), pipe: vi.fn(), unpipe: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      exitCode: undefined,
    };
    vi.mocked(spawn).mockReturnValue(mockChild as never);

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
});
