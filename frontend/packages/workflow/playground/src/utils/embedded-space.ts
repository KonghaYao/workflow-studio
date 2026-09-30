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

import { PUBLIC_SPACE_ID } from '@coze-workflow/base/constants';
import { useSpaceStore } from '@coze-arch/bot-studio-store';
import { type BotSpace, SpaceType } from '@coze-arch/bot-api/developer_api';

/**
 * 嵌入画布的 space 注桩。
 *
 * 为什么需要：画布整包以 iframe 形式挂进宿主（fenix 控制台）时没有 Coze 会话，`GetSpaceListV2` 既没有凭据
 * 也会被宿主 BFF 拒绝；而画布初始化强依赖 space store —— 除本包的 `WorkflowPlayground` 外，
 * `WorkflowGlobalStateEntity.setSpaceInfo()` 在 spaceList 里找不到当前 space 时会直接抛
 * `space id don't in list`，`useSpaceStore.setSpace()` 在 id 不在列表里时同样抛错。
 *
 * space id 从哪来：宿主按冻结协议把 Coze 侧的 space id 拼进 iframe URL 的 `space_id`
 * （fenix 仓 docs/design/2026-09-29-workflow-v2-coze-studio-bridge.md §5.2），画布侧由 Coze 既有的 query
 * 读取链路（`adapter/playground/src/hooks/use-page-params.ts`）取出后经 props 传入，本模块只消费结果，
 * 不自行解析 URL。
 *
 * 平台侧事实（同文档 §4）：平台在 Coze 侧只有 1 个服务账号，其个人空间是平台所有 workflow 的唯一容器，
 * 所以 stub 取 `space_type: Personal` + `has_personal_space: true`；这同时关掉了只在团队空间才出现的
 * 多人协作入口（`WorkflowGlobalStateEntity.canCollaboration`），与平台侧不提供协作能力的现状一致。
 */

/** 构造 stub 条目：id 必须等于 URL 下发的 space id —— checkSpaceID / setSpace 都按 id 查这张表。 */
const createStubSpace = (spaceId: string): BotSpace => ({
  id: spaceId,
  space_type: SpaceType.Personal,
});

/**
 * 把 stub 写进 space store；可重复调用（幂等）。
 *
 * 只写「平台空间存在」这一件事所需的字段：团队空间数与最近使用列表按空处理，团队空间配额沿用 store 现值，
 * 不伪造配额。
 */
export const seedEmbeddedSpace = (spaceId: string): void => {
  const { spaces } = useSpaceStore.getState();
  const space = createStubSpace(spaceId);

  useSpaceStore.setState({
    inited: true,
    spaceList: [space],
    recentlyUsedSpaceList: [],
    spaces: {
      bot_space_list: [space],
      has_personal_space: true,
      team_space_num: 0,
      max_team_space_num: spaces.max_team_space_num,
    },
    // 公共空间（浏览他人 workflow 的场景）在 Coze 里不写 space 字段，保持同一语义
    ...(spaceId === PUBLIC_SPACE_ID ? {} : { space }),
  });
};

/** stub 是否仍然完整；被 reset（见 watchEmbeddedSpace）抹掉后返回 false。 */
const isEmbeddedSpaceIntact = (spaceId: string): boolean => {
  const { inited, space, spaceList, spaces } = useSpaceStore.getState();
  const contains = (list: BotSpace[]) => list.some(item => item.id === spaceId);

  return (
    !!inited &&
    contains(spaceList) &&
    contains(spaces.bot_space_list) &&
    (spaceId === PUBLIC_SPACE_ID || space.id === spaceId)
  );
};

/**
 * 订阅并自愈 space 注桩，返回取消订阅函数。
 *
 * 为什么需要自愈：应用壳层的 `useResetStoreOnLogout`（global-adapter）在登录态 settle 为「未登录」时
 * `useSpaceStore.reset()`；嵌入模式恒满足「无 Coze 会话」，该 reset 必然在画布挂载之后触发一次，把
 * `inited` 打回 false（画布随即渲染 null = 白屏），而 `WorkflowPlayground` 的初始化 effect 依赖不变不会
 * 重跑。这里把「嵌入模式下 space store 恒含 URL 指定的 space」当成不变量来维护。
 */
export const watchEmbeddedSpace = (spaceId: string): (() => void) =>
  useSpaceStore.subscribe(() => {
    if (!isEmbeddedSpaceIntact(spaceId)) {
      seedEmbeddedSpace(spaceId);
    }
  });
