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

import { beforeEach, describe, expect, it, vi } from 'vitest';

// space store 读取构建期注入的 IS_DEV_MODE（rsbuild source.define 提供），vitest 下没有该全局；
// vi.hoisted 保证在 import 求值之前写入，否则 store 模块加载即 ReferenceError。
vi.hoisted(() => Object.assign(globalThis, { IS_DEV_MODE: false }));
// space store 依赖 @coze-arch/bot-api 一族的实现，本用例只读写 store 状态、不触网；
// 该依赖链在 vitest 下会拉入 semi/lottie 而报 canvas.getContext is not a function。
vi.mock('@coze-arch/bot-api', () => ({ PlaygroundApi: {}, DeveloperApi: {} }));

import { PUBLIC_SPACE_ID } from '@coze-workflow/base/constants';
import { useSpaceStore } from '@coze-arch/bot-studio-store';

import { seedEmbeddedSpace, watchEmbeddedSpace } from '../embedded-space';

const PLATFORM_SPACE_ID = '7512345678901234567';

describe('embedded-space', () => {
  beforeEach(() => {
    useSpaceStore.getState().reset();
  });

  // 注桩后必须同时满足 checkSpaceID 与 setSpace，否则画布初始化会抛 can not find space / space id don't in list
  it('seedEmbeddedSpace 满足 checkSpaceID 与 setSpace', () => {
    seedEmbeddedSpace(PLATFORM_SPACE_ID);

    const state = useSpaceStore.getState();
    expect(state.inited).toBe(true);
    expect(state.spaces.has_personal_space).toBe(true);
    expect(state.checkSpaceID(PLATFORM_SPACE_ID)).toBe(true);

    expect(() => state.setSpace(PLATFORM_SPACE_ID)).not.toThrow();
    expect(useSpaceStore.getState().space.id).toBe(PLATFORM_SPACE_ID);
  });

  // 注桩只认 URL 下发的 space id，其它 id 仍按原语义抛错，避免把校验放宽成「任意 id 都合法」
  it('seedEmbeddedSpace 不放行非下发的 space id', () => {
    seedEmbeddedSpace(PLATFORM_SPACE_ID);

    const state = useSpaceStore.getState();
    expect(state.checkSpaceID('123')).toBe(false);
    expect(() => state.setSpace('123')).toThrow();
  });

  // 公共空间浏览场景 Coze 侧不写 space 字段，注桩保持同一语义（只保证列表含该 id）
  it('seedEmbeddedSpace 对公共空间不写 space 字段', () => {
    seedEmbeddedSpace(PUBLIC_SPACE_ID);

    const state = useSpaceStore.getState();
    expect(state.inited).toBe(true);
    expect(state.checkSpaceID(PUBLIC_SPACE_ID)).toBe(true);
    expect(state.space.id).toBeUndefined();
  });

  // 壳层登出清理（global-adapter 的 useResetStoreOnLogout）会 reset space store，订阅需把注桩拉回来
  it('watchEmbeddedSpace 在 reset 之后自愈', () => {
    seedEmbeddedSpace(PLATFORM_SPACE_ID);
    useSpaceStore.getState().setSpace(PLATFORM_SPACE_ID);
    const unwatch = watchEmbeddedSpace(PLATFORM_SPACE_ID);

    useSpaceStore.getState().reset();

    const state = useSpaceStore.getState();
    expect(state.inited).toBe(true);
    expect(state.checkSpaceID(PLATFORM_SPACE_ID)).toBe(true);
    expect(state.space.id).toBe(PLATFORM_SPACE_ID);

    unwatch();
  });

  // 取消订阅后不再自愈，避免画布卸载后仍被注桩干扰
  it('watchEmbeddedSpace 取消订阅后不再注入', () => {
    watchEmbeddedSpace(PLATFORM_SPACE_ID)();

    useSpaceStore.getState().reset();

    expect(useSpaceStore.getState().inited).toBe(false);
  });

  // 初始化 effect 与自愈订阅可能都会调用注桩，重复调用不得产生额外副作用
  it('seedEmbeddedSpace 幂等', () => {
    seedEmbeddedSpace(PLATFORM_SPACE_ID);
    const first = useSpaceStore.getState();
    seedEmbeddedSpace(PLATFORM_SPACE_ID);

    const second = useSpaceStore.getState();
    expect(second.spaceList).toEqual(first.spaceList);
    expect(second.space).toEqual(first.space);
    expect(second.spaces).toEqual(first.spaces);
  });
});
