/*
 * Copyright 2025 coze-dev Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { renderHook } from '@testing-library/react';
import { type SlardarInstance } from '@coze-arch/logger';

// 嵌入模式（宿主 iframe）：判据来自 @coze-arch/bot-http，这里固定为 true，与 host-bridge 的 isEmbedded() 同源
vi.mock('@coze-arch/bot-http', () => ({
  isEmbedded: () => true,
  isApiError: () => false,
}));

vi.mock('@coze-arch/logger', () => ({
  logger: {
    info: vi.fn(),
    createLoggerWith: vi.fn(() => ({
      info: vi.fn(),
      persist: {
        error: vi.fn(),
      },
    })),
  },
}));

const mockAddEventListener = vi.fn();
const mockRemoveEventListener = vi.fn();

Object.defineProperty(window, 'addEventListener', {
  value: mockAddEventListener,
  writable: true,
});
Object.defineProperty(window, 'removeEventListener', {
  value: mockRemoveEventListener,
  writable: true,
});

import { useErrorCatch } from '../src/use-error-catch';

describe('use-error-catch 嵌入模式', () => {
  // 验收口径「嵌入模式下不上报」：既不挂 unhandledrejection 监听（错误上报），也不挂 slardar beforeSend 拦截
  it('不挂任何上报监听', () => {
    const slardarInstance = {
      on: vi.fn(),
      off: vi.fn(),
    };

    const { unmount } = renderHook(() =>
      useErrorCatch(slardarInstance as unknown as SlardarInstance),
    );
    unmount();

    expect(mockAddEventListener).not.toHaveBeenCalled();
    expect(mockRemoveEventListener).not.toHaveBeenCalled();
    expect(slardarInstance.on).not.toHaveBeenCalled();
  });
});
