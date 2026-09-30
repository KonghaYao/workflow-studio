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

import MockAdapter from 'axios-mock-adapter';
import { redirect } from '@coze-arch/web-context';

import { reportHostError, requestTicketRefresh } from '../src/host-bridge';
import { axiosInstance } from '../src/axios';

/**
 * 宿主嵌入（iframe）场景下的 axios 行为：请求注入 BFF 基址与票据、401 不再整页跳转。
 * 基址指向 127.0.0.1:1（必然连接失败），用来让"重放"这件事本身可被确定性地观测。
 */
const { HOST_API_BASE } = vi.hoisted(() => ({
  HOST_API_BASE: 'http://127.0.0.1:1/workflow-canvas/bff',
}));
const COZE_WORKFLOW_PATH = '/api/workflow_api/latest';

const mock = new MockAdapter(axiosInstance);

vi.mock('@coze-arch/logger', () => ({
  logger: {
    info: vi.fn(),
    persist: {
      error: vi.fn(),
    },
  },
}));

vi.mock('../src/eventbus', () => ({
  emitAPIErrorEvent: vi.fn(),
  APIErrorEvent: {
    UNAUTHORIZED: 'unauthorized',
    COUNTRY_RESTRICTED: 'countryRestricted',
    COZE_TOKEN_INSUFFICIENT: 'cozeTokenInsufficient',
  },
}));

vi.mock('../src/api-error', async () => {
  const actual = (await vi.importActual('../src/api-error')) as object;

  return {
    ...actual,
    reportHttpError: vi.fn(),
  };
});

vi.mock('@coze-arch/web-context', () => ({
  redirect: vi.fn(),
}));

vi.mock('../src/host-bridge', () => ({
  TICKET_HEADER_NAME: 'X-Fenix-Workflow-Ticket',
  isEmbedded: () => true,
  getApiBaseUrl: () => HOST_API_BASE,
  getTicket: () => 'tk-fresh',
  requestTicketRefresh: vi.fn(),
  reportHostError: vi.fn(),
}));

describe('axiosInstance with fenix host', () => {
  beforeEach(() => {
    mock.reset();
    vi.clearAllMocks();
    vi.mocked(requestTicketRefresh).mockResolvedValue(true);
    // 重放会真的发一个必然失败的请求，jsdom 会把该网络错误写到 console.error，这里静音避免噪音
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends requests to the host api base with the ticket header', async () => {
    mock.onGet(COZE_WORKFLOW_PATH).reply(200, { code: 0, data: {} });

    await axiosInstance.get(COZE_WORKFLOW_PATH);

    expect(mock.history.get[0]).toMatchObject({
      baseURL: HOST_API_BASE,
      headers: { 'X-Fenix-Workflow-Ticket': 'tk-fresh' },
    });
  });

  it('asks the host for a new ticket and replays once on 401', async () => {
    mock.onGet(COZE_WORKFLOW_PATH).reply(401, {
      code: 401,
      msg: 'ticket_invalid',
    });

    await expect(axiosInstance.get(COZE_WORKFLOW_PATH)).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(requestTicketRefresh).toHaveBeenCalledTimes(1);
    // 重放走真实网络，127.0.0.1:1 必然失败，因此必须回报宿主而不是静默吞掉
    expect(reportHostError).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: true }),
    );
    expect(redirect).not.toHaveBeenCalled();
  });

  it('reports non-retryable error when the host cannot refresh the ticket', async () => {
    vi.mocked(requestTicketRefresh).mockResolvedValue(false);
    mock.onGet(COZE_WORKFLOW_PATH).reply(401, {
      code: 401,
      msg: 'ticket_invalid',
    });

    await expect(axiosInstance.get(COZE_WORKFLOW_PATH)).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(reportHostError).toHaveBeenCalledTimes(1);
    expect(reportHostError).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: false }),
    );
    expect(redirect).not.toHaveBeenCalled();
  });

  it('keeps business error handling on the normal chain', async () => {
    mock.onGet(COZE_WORKFLOW_PATH).reply(200, {
      code: 1,
      msg: 'fake error',
    });

    await expect(axiosInstance.get(COZE_WORKFLOW_PATH)).rejects.toThrowError();
    expect(requestTicketRefresh).not.toHaveBeenCalled();
  });
});
