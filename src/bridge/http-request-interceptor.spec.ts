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
import { HttpRequestInterceptor } from './http-request-interceptor';

describe('HttpRequestInterceptor', () => {
  let onRequest: ReturnType<typeof vi.fn>;
  let interceptor: HttpRequestInterceptor;

  beforeEach(() => {
    onRequest = vi.fn();
    interceptor = new HttpRequestInterceptor(onRequest);
  });

  it('should log a complete GET request', () => {
    expect.assertions(1);

    interceptor.push(Buffer.from('GET /v1.41/images/json HTTP/1.1\r\nHost: localhost\r\n\r\n'));

    expect(onRequest).toHaveBeenCalledWith('GET', '/v1.41/images/json', {
      host: 'localhost',
    });
  });

  it('should handle request split across chunks', () => {
    expect.assertions(2);

    interceptor.push(Buffer.from('GET /containers/json HTTP/1.1\r\nHo'));
    expect(onRequest).not.toHaveBeenCalled();

    interceptor.push(Buffer.from('st: localhost\r\n\r\n'));
    expect(onRequest).toHaveBeenCalledWith('GET', '/containers/json', {
      host: 'localhost',
    });
  });

  it('should skip body using Content-Length before next request', () => {
    expect.assertions(3);

    const body = '{"Image":"alpine"}';
    const request =
      `POST /v1.41/containers/create HTTP/1.1\r\n` +
      `Content-Length: ${body.length}\r\n` +
      `Content-Type: application/json\r\n` +
      `\r\n` +
      body +
      `GET /v1.41/version HTTP/1.1\r\nHost: localhost\r\n\r\n`;

    interceptor.push(Buffer.from(request));

    expect(onRequest).toHaveBeenCalledTimes(2);
    expect(onRequest).toHaveBeenNthCalledWith(1, 'POST', '/v1.41/containers/create', {
      'content-length': String(body.length),
      'content-type': 'application/json',
    });
    expect(onRequest).toHaveBeenNthCalledWith(2, 'GET', '/v1.41/version', {
      host: 'localhost',
    });
  });

  it('should reset buffered state', () => {
    expect.assertions(2);

    interceptor.push(Buffer.from('GET /partial'));
    interceptor.reset();
    interceptor.push(Buffer.from('GET /v1.41/info HTTP/1.1\r\n\r\n'));

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith('GET', '/v1.41/info', {});
  });
});
