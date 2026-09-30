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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as HostBridge from '../src/host-bridge';

interface FakeParent {
  postMessage: ReturnType<typeof vi.fn>;
}

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

/** 把 window.parent / window.top 替换为可控的假父窗口，模拟 iframe 嵌入 */
const installFakeParent = (): FakeParent => {
  const fakeParent: FakeParent = { postMessage: vi.fn() };
  Object.defineProperty(window, 'top', {
    value: fakeParent,
    configurable: true,
  });
  Object.defineProperty(window, 'parent', {
    value: fakeParent,
    configurable: true,
  });
  return fakeParent;
};

const postFromHost = (
  parent: FakeParent,
  envelope: Record<string, unknown>,
  options: { origin?: string } = {},
): void => {
  const event = new MessageEvent('message', {
    data: envelope,
    origin: options.origin ?? window.location.origin,
  });
  Object.defineProperty(event, 'source', { value: parent, configurable: true });
  window.dispatchEvent(event);
};

const findMessage = (parent: FakeParent, type: string) =>
  parent.postMessage.mock.calls
    .map(call => call[0] as { type: string; payload: unknown })
    .find(message => message.type === type);

const findMessages = (parent: FakeParent, type: string) =>
  parent.postMessage.mock.calls
    .map(call => call[0] as { type: string; payload: unknown })
    .filter(message => message.type === type);

describe('host-bridge in standalone (non iframe) context', () => {
  it('stays inert: no handshake message, no api base, no ticket', async () => {
    vi.resetModules();
    const parentPostMessage = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: parentPostMessage },
      configurable: true,
    });

    const bridge = await import('../src/host-bridge');

    expect(bridge.isEmbedded()).toBe(false);
    expect(bridge.getApiBaseUrl()).toBeUndefined();
    expect(bridge.getTicket()).toBeUndefined();
    await expect(bridge.requestTicketRefresh()).resolves.toBe(false);
    bridge.reportHostError({ code: 'x', message: 'y', retryable: true });
    expect(parentPostMessage).not.toHaveBeenCalled();
  });
});

describe('host-bridge in iframe context', () => {
  let bridge: typeof HostBridge;
  let parent: FakeParent;
  let messageHandlers: ((event: MessageEvent) => void)[];

  beforeEach(async () => {
    vi.resetModules();
    parent = installFakeParent();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ data: { ticket: 'tk-1', expiresAt: 456 } }),
      }),
    );
    // 模块加载时注册的 message 监听在页面生命周期内不移除，而每个用例都会重新加载模块；
    // 这里记录并逐个摘除，否则同一条消息会被此前用例残留的模块实例重复处理，请求次数断言失真
    messageHandlers = [];
    const addEventListener = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation(
      (type, handler, options) => {
        addEventListener(type, handler, options);
        if (type === 'message' && typeof handler === 'function') {
          messageHandlers.push(handler as (event: MessageEvent) => void);
        }
      },
    );
    bridge = await import('../src/host-bridge');
  });

  afterEach(() => {
    messageHandlers.forEach(handler => {
      window.removeEventListener('message', handler);
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends ready to the parent on mount', () => {
    expect(findMessage(parent, 'ready')).toBeTruthy();
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ v: 1, type: 'ready' }),
      window.location.origin,
    );
  });

  it('exchanges the one-time code from bind and reports bound', async () => {
    postFromHost(parent, {
      v: 1,
      id: '1',
      type: 'bind',
      ts: Date.now(),
      payload: { code: 'code-1', apiBase: '/workflow-canvas/bff' },
    });
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith(
      '/workflow-canvas/bff/session/exchange',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(bridge.getApiBaseUrl()).toBe('/workflow-canvas/bff');
    expect(bridge.getTicket()).toBe('tk-1');
    expect(findMessage(parent, 'bound')?.payload).toMatchObject({
      ok: true,
      expiresAt: 456,
    });
  });

  it('answers a retried bind with the same code without a second exchange', async () => {
    const bindEnvelope = {
      v: 1,
      id: 'bind-1',
      type: 'bind',
      ts: Date.now(),
      payload: { code: 'code-retry', apiBase: '/workflow-canvas/bff' },
    };
    postFromHost(parent, bindEnvelope);
    await flushPromises();
    // 宿主 500ms 重试窗口内可能重复下发同一个一次性 code：必须幂等回报成功，而不是二次兑换失败
    postFromHost(parent, { ...bindEnvelope, id: 'bind-2' });
    await flushPromises();

    expect(fetch).toHaveBeenCalledTimes(1);
    const boundMessages = findMessages(parent, 'bound');
    expect(boundMessages).toHaveLength(2);
    expect(
      boundMessages.map(message => (message.payload as { ok: boolean }).ok),
    ).toEqual([true, true]);
  });

  it('accepts ticket pushed by the host and resolves pending refresh', async () => {
    const pending = bridge.requestTicketRefresh();
    expect(findMessage(parent, 'refresh-request')?.payload).toMatchObject({
      reason: 'unauthorized',
    });

    postFromHost(parent, {
      v: 1,
      id: '2',
      type: 'token',
      ts: Date.now(),
      payload: { ticket: 'tk-2', expiresAt: 789 },
    });

    await expect(pending).resolves.toBe(true);
    expect(bridge.getTicket()).toBe('tk-2');
  });

  it('exchanges the code pushed with token before resolving refresh', async () => {
    const pending = bridge.requestTicketRefresh();
    postFromHost(parent, {
      v: 1,
      id: '3',
      type: 'token',
      ts: Date.now(),
      payload: { code: 'code-2', apiBase: '/workflow-canvas/bff' },
    });

    await expect(pending).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '/workflow-canvas/bff/session/exchange',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fails refresh on timeout when the host never answers', async () => {
    vi.useFakeTimers();
    const pending = bridge.requestTicketRefresh();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toBe(false);
  });

  it('coalesces concurrent refresh requests', async () => {
    const [first, second] = [
      bridge.requestTicketRefresh(),
      bridge.requestTicketRefresh(),
    ];

    expect(findMessages(parent, 'refresh-request')).toHaveLength(1);
    postFromHost(parent, {
      v: 1,
      id: '4',
      type: 'token',
      ts: Date.now(),
      payload: { ticket: 'tk-3' },
    });

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it('clears the ticket on signout', () => {
    postFromHost(parent, {
      v: 1,
      id: '5',
      type: 'token',
      ts: Date.now(),
      payload: { ticket: 'tk-4' },
    });
    expect(bridge.getTicket()).toBe('tk-4');

    postFromHost(parent, {
      v: 1,
      id: '6',
      type: 'signout',
      ts: Date.now(),
      payload: {},
    });

    expect(bridge.getTicket()).toBeUndefined();
  });

  it('ignores messages from other windows or other origins', () => {
    postFromHost(
      parent,
      {
        v: 1,
        id: '7',
        type: 'token',
        ts: Date.now(),
        payload: { ticket: 'tk-evil' },
      },
      { origin: 'https://evil.example.com' },
    );
    postFromHost(
      { postMessage: vi.fn() },
      {
        v: 1,
        id: '8',
        type: 'token',
        ts: Date.now(),
        payload: { ticket: 'tk-sibling' },
      },
    );
    postFromHost(parent, {
      v: 2,
      id: '9',
      type: 'token',
      ts: Date.now(),
      payload: { ticket: 'tk-v2' },
    });
    // 协议相对地址会绕过同源约束，apiBase 必须被拒绝
    postFromHost(parent, {
      v: 1,
      id: '10',
      type: 'bind',
      ts: Date.now(),
      payload: { code: 'code-3', apiBase: '//evil.example.com' },
    });

    expect(bridge.getTicket()).toBeUndefined();
    expect(bridge.getApiBaseUrl()).toBeUndefined();
  });
});

describe('host-bridge api base from iframe url', () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    });
  });

  it('reads apiBase query parameter before any handshake', async () => {
    vi.resetModules();
    installFakeParent();
    // jsdom 的 history.replaceState 不改写 location，这里直接替换 location 以模拟 iframe src 上的参数
    Object.defineProperty(window, 'location', {
      value: {
        origin: originalLocation.origin,
        search: '?apiBase=/workflow-canvas/bff/',
      },
      configurable: true,
    });

    const bridge = await import('../src/host-bridge');

    expect(bridge.getApiBaseUrl()).toBe('/workflow-canvas/bff');
  });
});
