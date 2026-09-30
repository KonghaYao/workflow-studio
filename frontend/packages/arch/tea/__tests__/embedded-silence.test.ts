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

import { afterEach, describe, expect, it, vi } from 'vitest';

/** 用可观测的假 adapter 替代空实现，才能区分「画布拿到的是惰性实例」与「拿到了 adapter」。 */
const mocks = vi.hoisted(() => {
  const sendEvent = vi.fn();
  const init = vi.fn();
  return { sendEvent, init, adapterStub: { sendEvent, init } };
});

vi.mock('@coze-studio/tea-adapter', () => ({ default: mocks.adapterStub }));

describe('@coze-arch/tea 嵌入模式埋点静默', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    mocks.sendEvent.mockClear();
    mocks.init.mockClear();
  });

  // window.top 指向宿主窗口时即嵌入模式（判据同 host-bridge 的 isEmbedded()）：
  // 默认导出必须是惰性实例，init / sendEvent 都不能触达 adapter，验收口径「不初始化、不上报」。
  it('嵌入模式不触达 adapter', async () => {
    vi.stubGlobal('top', { name: 'fenix-host' });

    const tea = (await import('../src')).default;
    tea.sendEvent('workflow_xxx' as never);
    tea.init({});

    expect(window.self).not.toBe(window.top);
    expect(mocks.sendEvent).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
  });
});
