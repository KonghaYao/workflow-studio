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

import Tea, { type Tea as TeaInstance } from '@coze-studio/tea-adapter';

export {
  EVENT_NAMES,
  AddPluginToStoreEntry,
  AddWorkflowToStoreEntry,
  PublishAction,
  AddBotToStoreEntry,
  BotDetailPageAction,
  PluginPrivacyAction,
  PluginMockDataGenerateMode,
  BotShareConversationClick,
  FlowStoreType,
  FlowResourceFrom,
  FlowDuplicateType,
} from '@coze-studio/tea-interface/events';

export type {
  ExploreBotCardCommonParams,
  ShareRecallPageFrom,
  PluginMockSetCommonParams,
  SideNavClickCommonParams,
  UserGrowthEventParams,
  ParamsTypeDefine,

  /**  product event types */
  ProductEventSource,
  ProductEventFilterTag,
  ProductEventEntityType,
  ProductShowFrontParams,
  DocClickCommonParams,
} from '@coze-studio/tea-interface/events';

const noop = () => {
  // do nothing
};

/** 惰性 Tea：任何属性取值与调用都落到空实现，init / sendEvent 都不会发出请求。 */
const inertTea = new Proxy(
  function () {
    // do nothing
  },
  {
    get: () => noop,
    apply: () => undefined,
  },
);

/**
 * 嵌入模式（宿主 iframe）下画布没有 Coze 会话，埋点由宿主承担，这里下发惰性实例——
 * 无论 tea-adapter 是空实现还是真实 SDK，画布都既不初始化也不上报。
 * 判据与 `@coze-arch/bot-http/src/host-bridge.ts` 的 isEmbedded() 同义；本包未声明 bot-http 依赖
 * （pnpm 隔离链接下解析不到），故就地实现，两处语义必须保持一致。
 */
const isEmbedded = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    // 跨域 / sandbox 下读 window.top 会抛错，按"非嵌入"保守处理（与 host-bridge 一致）
    return false;
  }
};

export default (isEmbedded() ? inertTea : Tea) as TeaInstance;
