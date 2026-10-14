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

export type RequestLogHandler = (method: string, url: string, headers: Record<string, string>) => void;

const REQUEST_LINE_RE = /^(GET|POST|PUT|DELETE|HEAD|PATCH|OPTIONS)\s+(\S+)\s+HTTP\/[\d.]+$/i;
const MAX_BUFFER_BYTES = 256 * 1024;

/**
 * Parses HTTP/1.x request frames from a byte stream and invokes a callback
 * for each complete request (method + URL). Body bytes are skipped using
 * Content-Length so keep-alive streams can be followed.
 *
 * Chunked request bodies are not fully parsed; after headers the next
 * request line is found opportunistically.
 */
export class HttpRequestInterceptor {
  #buffer = Buffer.alloc(0);
  #bodyRemaining = 0;
  readonly #onRequest: RequestLogHandler;

  constructor(onRequest: RequestLogHandler) {
    this.#onRequest = onRequest;
  }

  push(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    this.#consume();
  }

  reset(): void {
    this.#buffer = Buffer.alloc(0);
    this.#bodyRemaining = 0;
  }

  #consume(): void {
    while (this.#buffer.length > 0) {
      if (this.#bodyRemaining > 0) {
        const skip = Math.min(this.#bodyRemaining, this.#buffer.length);
        this.#buffer = this.#buffer.subarray(skip);
        this.#bodyRemaining -= skip;
        continue;
      }

      const headerEnd = this.#buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        if (this.#buffer.length > MAX_BUFFER_BYTES) {
          this.#buffer = this.#buffer.subarray(this.#buffer.length - 4096);
        }
        return;
      }

      const headerText = this.#buffer.subarray(0, headerEnd).toString('utf8');
      this.#buffer = this.#buffer.subarray(headerEnd + 4);

      const lines = headerText.split('\r\n');
      const requestLine = lines[0] ?? '';
      const match = REQUEST_LINE_RE.exec(requestLine);

      const headers: Record<string, string> = {};
      for (let i = 1; i < lines.length; i++) {
        const colon = lines[i].indexOf(':');
        if (colon > 0) {
          const name = lines[i].slice(0, colon).trim().toLowerCase();
          headers[name] = lines[i].slice(colon + 1).trim();
        }
      }

      if (match) {
        this.#onRequest(match[1].toUpperCase(), match[2], headers);
      }

      const contentLength = Number.parseInt(headers['content-length'] ?? '0', 10);
      if (Number.isFinite(contentLength) && contentLength > 0) {
        this.#bodyRemaining = contentLength;
      }
    }
  }
}
