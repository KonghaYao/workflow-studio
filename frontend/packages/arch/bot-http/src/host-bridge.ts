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

/**
 * 画布宿主桥：fenix 平台以 iframe 嵌入 Coze 画布时，画布与父窗口（fenix 控制台）之间的握手与凭据通道。
 *
 * 职责（只做这三件事，其余留给调用方）：
 * 1. 握手：挂载后向父窗口发送 `ready`，接收 `bind`（一次性 code）/ `token`（新票据）/ `signout`；
 * 2. 持有短期票据：仅存内存，经请求头 `X-Fenix-Workflow-Ticket` 携带；不用 cookie / storage / URL 传递；
 * 3. 决策 API 基址：宿主经 URL 参数 `apiBase` 或 `bind` / `token` 消息下发后，画布请求前缀切到该基址
 *    （生产为 `/workflow-canvas/bff`，由 fenix 反代到 workflow-v2 透传面）。
 *
 * 消息协议（envelope `{ v, id, type, ts, payload }`）见 fenix 仓
 * `docs/design/2026-09-29-workflow-v2-interface-freeze.md` §7；票据语义见同仓
 * `docs/design/2026-09-29-workflow-v2-coze-studio-bridge.md` §5.2。
 *
 * 隔离约束：非 iframe（Coze 独立运行）下本模块完全惰性——不挂 message 监听、不发消息、不取 URL 参数、
 * 不返回基址与票据，因此对既有独立部署行为零影响。
 *
 * 安全约束：只接受 `event.source === window.parent` 且 `event.origin === window.location.origin` 的消息，
 * 回复一律发给 `window.location.origin`（不使用 `'*'`）。跨域嵌入（未来拆子域方案）需要在此显式放行宿主
 * origin，当前实现按 fail-closed 处理。
 */

/** 宿主票据请求头；与 fenix workflow-v2 透传面约定一致，改名需两侧同步。 */
export const TICKET_HEADER_NAME = 'X-Fenix-Workflow-Ticket';

/** envelope 版本号；宿主与本模块必须一致，不一致的消息直接忽略（协议演进用）。 */
const ENVELOPE_VERSION = 1;

/** 宿主下发 API 基址的 URL 参数名；放在 iframe src 上，保证首屏请求就能直达 BFF。 */
const API_BASE_URL_PARAM = 'apiBase';

/** 等待宿主换票的上限；超时按换票失败处理，由宿主展示降级页。 */
const TOKEN_WAIT_TIMEOUT_MS = 10_000;

/** 画布 → 宿主 的消息类型。 */
type CanvasMessageType = 'ready' | 'bound' | 'refresh-request' | 'error';

/** 宿主 → 画布 的消息类型。 */
type HostMessageType = 'bind' | 'token' | 'signout';

interface Envelope<TType extends string, TPayload> {
  v: typeof ENVELOPE_VERSION;
  /** 诊断用消息 id，不参与鉴权。 */
  id: string;
  type: TType;
  ts: number;
  payload: TPayload;
}

interface ReadyPayload {
  /** 构建标识，便于宿主发现版本错配。 */
  build?: string;
  capabilities: string[];
}

interface RefreshRequestPayload {
  /** 触发原因；当前只有 401 一种（票据过期前主动续期由画布入口负责）。 */
  reason: 'unauthorized';
}

interface ErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
}

/** `bind` / `token` 的入参：宿主可只给 code（子侧兑换），也可直接给票据。 */
interface HandshakePayload {
  apiBase?: string;
  code?: string;
  ticket?: string;
  expiresAt?: number;
}

/** 兑换响应：fenix 侧为 Coze 形状 `{ data: { ticket, expiresAt }, code, msg }`，此处两种形状都兼容。 */
interface ExchangeResponseBody {
  data?: { ticket?: string; expiresAt?: number };
  ticket?: string;
  expiresAt?: number;
}

let embeddedCache: boolean | undefined;
let started = false;
let apiBaseUrl: string | undefined;
let ticket: string | undefined;
let ticketExpiresAt = 0;
let refreshWaiter: ((refreshed: boolean) => void) | undefined;
let tokenWaitTimer: ReturnType<typeof setTimeout> | undefined;
let refreshInFlight: Promise<boolean> | undefined;
/** 已成功兑换且票据仍在手上的 code：宿主重试 bind 会重复下发，重复兑换只会白费一次单次消费的 code。 */
let exchangedCode: string | undefined;
/** 进行中的兑换；同一 code 的并发下发共享同一次请求。 */
let exchangeInFlight: { code: string; promise: Promise<boolean> } | undefined;

/**
 * 是否运行在 iframe 中；结果按文档生命周期缓存。
 * 跨域或 sandbox 场景下读取 `window.top` 可能抛异常，按"非嵌入"保守处理。
 */
export function isEmbedded(): boolean {
  if (embeddedCache === undefined) {
    try {
      embeddedCache =
        typeof window !== 'undefined' && window.self !== window.top;
      // eslint-disable-next-line @coze-arch/use-error-in-catch -- 抛错本身就是信号（跨域 / sandbox 拿不到 window.top），无需读取异常对象
    } catch {
      embeddedCache = false;
    }
  }
  return embeddedCache;
}

/** 当前生效的 API 基址；`undefined` 表示沿用 axios 默认（相对当前 origin，即 Coze 自身后端）。 */
export function getApiBaseUrl(): string | undefined {
  return apiBaseUrl;
}

/** 当前票据；无宿主或尚未握手完成时为 `undefined`。 */
export function getTicket(): string | undefined {
  return ticket;
}

/**
 * 401 兜底：请求宿主换票并等待 `token` 下发。
 *
 * @returns `true` 表示已拿到可用票据，调用方可重放一次原请求；`false` 表示换票失败（未嵌入 / 超时 / 宿主拒绝）。
 *
 * 并发 401 会合并为一次换票请求：多个失败请求共享同一个 Promise，避免刷新风暴。
 */
export function requestTicketRefresh(): Promise<boolean> {
  if (!isEmbedded()) {
    return Promise.resolve(false);
  }
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = waitForToken().finally(() => {
    refreshInFlight = undefined;
  });
  return refreshInFlight;
}

/** 上报画布侧致命错误，由宿主展示降级页；非嵌入场景为空操作。 */
export function reportHostError(payload: ErrorPayload): void {
  if (!isEmbedded()) {
    return;
  }
  postToHost('error', payload);
}

/**
 * 模块加载即完成握手启动（仅嵌入场景）。放在模块顶层而不是显式调用，是为了让画布最早发出的请求
 * 就能带上宿主基址与票据——bot-http 由 bot-api 在应用启动早期引入。
 */
function startHandshake(): void {
  if (started || !isEmbedded()) {
    return;
  }
  started = true;
  apiBaseUrl = readApiBaseFromLocation();
  window.addEventListener('message', handleHostMessage);
  postToHost<ReadyPayload>('ready', {
    build: readBuildTag(),
    capabilities: ['ticket'],
  });
}

function handleHostMessage(event: MessageEvent): void {
  if (event.source !== window.parent) {
    // 只认父窗口，防止同源的其它窗口（opener / 兄弟 iframe）注入票据
    return;
  }
  if (event.origin !== window.location.origin) {
    return;
  }
  const envelope = parseEnvelope(event.data);
  if (!envelope) {
    return;
  }
  const payload = readHandshakePayload(envelope.payload);
  if (envelope.type === 'bind') {
    acceptBind(payload);
  } else if (envelope.type === 'token') {
    acceptToken(payload);
  } else if (envelope.type === 'signout') {
    clearTicket();
  }
}

function acceptBind(payload: HandshakePayload): void {
  if (payload.apiBase) {
    apiBaseUrl = payload.apiBase;
  }
  if (!payload.code) {
    return;
  }
  void exchangeCode(payload.code).then(ok => {
    postToHost('bound', { ok, expiresAt: ok ? ticketExpiresAt : undefined });
  });
}

function acceptToken(payload: HandshakePayload): void {
  if (payload.apiBase) {
    apiBaseUrl = payload.apiBase;
  }
  if (payload.ticket) {
    setTicket(payload.ticket, payload.expiresAt);
    settleRefresh(true);
    return;
  }
  if (payload.code) {
    // 设计文档允许"父静默换新 code 并下发"，与直接下发票据等价
    void exchangeCode(payload.code).then(settleRefresh);
    return;
  }
  settleRefresh(false);
}

/**
 * 用一次性 code 兑换票据。不经 axiosInstance：兑换本身属于握手，不参与业务请求的拦截器链
 * （否则失败会递归触发 401 换票逻辑）。
 *
 * 幂等：宿主在收到 `bound` 之前会按 500ms 重试 `bind`，同一 code 可能被重复下发；code 单次消费，
 * 重复兑换只会失败并让宿主误判为握手失败，因此票据在手时直接回报成功、并发下发共享一次请求。
 */
async function exchangeCode(code: string): Promise<boolean> {
  if (exchangedCode === code && ticket) {
    return true;
  }
  const inFlight = exchangeInFlight;
  if (inFlight?.code === code) {
    return inFlight.promise;
  }
  const base = apiBaseUrl;
  if (!base) {
    return false;
  }
  const promise = performExchange(code, base);
  exchangeInFlight = { code, promise };
  const ok = await promise;
  if (exchangeInFlight?.promise === promise) {
    exchangeInFlight = undefined;
  }
  if (ok) {
    exchangedCode = code;
  }
  return ok;
}

/** 真正发起兑换；网络异常与非法响应体都折叠为"兑换失败"，由调用方回报宿主。 */
async function performExchange(code: string, base: string): Promise<boolean> {
  // 这里不读取异常对象，避免把 code 或票据写进日志
  const response = await fetch(`${base}/session/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  }).catch((): undefined => undefined);
  if (!response?.ok) {
    return false;
  }
  const body = (await response.json().catch((): undefined => undefined)) as
    | ExchangeResponseBody
    | undefined;
  const data = body?.data ?? body;
  if (typeof data?.ticket !== 'string' || !data.ticket) {
    return false;
  }
  setTicket(data.ticket, data.expiresAt);
  return true;
}

function waitForToken(): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    refreshWaiter = resolve;
    postToHost<RefreshRequestPayload>('refresh-request', {
      reason: 'unauthorized',
    });
    tokenWaitTimer = setTimeout(() => {
      settleRefresh(false);
    }, TOKEN_WAIT_TIMEOUT_MS);
  });
}

function settleRefresh(refreshed: boolean): void {
  if (tokenWaitTimer !== undefined) {
    clearTimeout(tokenWaitTimer);
    tokenWaitTimer = undefined;
  }
  const waiter = refreshWaiter;
  refreshWaiter = undefined;
  waiter?.(refreshed);
}

function setTicket(nextTicket: string, expiresAt?: number): void {
  ticket = nextTicket;
  ticketExpiresAt = expiresAt ?? 0;
}

function clearTicket(): void {
  ticket = undefined;
  ticketExpiresAt = 0;
  settleRefresh(false);
}

function postToHost<TPayload>(
  type: CanvasMessageType,
  payload: TPayload,
): void {
  const envelope: Envelope<CanvasMessageType, TPayload> = {
    v: ENVELOPE_VERSION,
    id: createMessageId(),
    type,
    ts: Date.now(),
    payload,
  };
  window.parent.postMessage(envelope, window.location.origin);
}

function parseEnvelope(
  raw: unknown,
): { type: HostMessageType; payload: unknown } | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (record.v !== ENVELOPE_VERSION || typeof record.type !== 'string') {
    return undefined;
  }
  // 未列出的类型（navigate-out / resize / theme / locale 等）由画布入口等其它模块处理，这里忽略
  return { type: record.type as HostMessageType, payload: record.payload };
}

function readHandshakePayload(payload: unknown): HandshakePayload {
  if (typeof payload !== 'object' || payload === null) {
    return {};
  }
  const record = payload as Record<string, unknown>;
  return {
    apiBase: normalizeApiBase(record.apiBase),
    code: readNonEmptyString(record.code),
    ticket: readNonEmptyString(record.ticket),
    expiresAt:
      typeof record.expiresAt === 'number' ? record.expiresAt : undefined,
  };
}

function readApiBaseFromLocation(): string | undefined {
  const params = new URLSearchParams(window.location.search);
  return normalizeApiBase(params.get(API_BASE_URL_PARAM));
}

/**
 * 归一化 API 基址：只接受「同源相对路径」或「http(s) 绝对地址」。
 * `//host` 这类协议相对地址会绕过 origin 约束，按非法处理。
 */
function normalizeApiBase(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed || trimmed.startsWith('//')) {
    return undefined;
  }
  if (trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * 构建期常量，由 rspack `source.define` 注入（见 frontend/config/rsbuild-config/src/index.ts 的 getDefine）。
 * 必须以裸标识符引用才会在打包时被替换：写成 `globalThis.CONSUMER_BUILD_VERSION` 是属性访问，替换不生效，
 * 运行时恒为 undefined。`typeof` 守卫用于未被替换的环境（单测、非打包运行），避免 ReferenceError。
 */
declare const CONSUMER_BUILD_VERSION: string | undefined;
declare const CUSTOM_VERSION: string | undefined;

/** 读取构建标识；未注入（如单测、非 rsbuild 运行）时返回 undefined，不抛错。 */
function readBuildTag(): string | undefined {
  if (typeof CONSUMER_BUILD_VERSION === 'string' && CONSUMER_BUILD_VERSION) {
    return CONSUMER_BUILD_VERSION;
  }
  if (typeof CUSTOM_VERSION === 'string' && CUSTOM_VERSION) {
    return CUSTOM_VERSION;
  }
  return undefined;
}

/** 文档内自增的消息序号，与时间戳拼成诊断用消息 id（不参与鉴权，无需全局唯一）。 */
let messageSeq = 0;

function createMessageId(): string {
  messageSeq += 1;
  return `${Date.now()}-${messageSeq}`;
}

startHandshake();
