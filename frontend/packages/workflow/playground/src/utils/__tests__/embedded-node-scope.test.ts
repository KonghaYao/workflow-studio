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
import { type StandardNodeType } from '@coze-workflow/base';

/** 覆盖三类：许可集内（start/http/json-stringify）、被刻意排除（api=插件、loop、dataset）。 */
const NODE_TYPES = ['1', '4', '21', '45', '58', '6'] as StandardNodeType[];

const importModule = async () => import('../embedded-node-scope');

describe('embedded-node-scope', () => {
  afterEach(() => {
    vi.doUnmock('@coze-arch/bot-http');
    vi.resetModules();
  });

  // 非嵌入（Coze 独立部署）必须逐字节不变：同一引用直接返回，不做任何过滤
  it('非嵌入模式原样返回入参', async () => {
    vi.resetModules();
    const { filterEmbeddedNodeTypes } = await importModule();

    expect(filterEmbeddedNodeTypes(NODE_TYPES)).toBe(NODE_TYPES);
  });

  // 嵌入模式按 fenix 冻结文档 §5 的许可集收窄，未命中的（含未来新增的未知类型）一律滤除
  it('嵌入模式只保留许可集内的节点类型', async () => {
    vi.resetModules();
    vi.doMock('@coze-arch/bot-http', () => ({ isEmbedded: () => true }));
    const { filterEmbeddedNodeTypes } = await importModule();

    expect(filterEmbeddedNodeTypes(NODE_TYPES)).toEqual(['1', '45', '58']);
  });

  // 许可集常量必须与 BFF 的 WORKFLOW_V2_NODE_WHITELIST 默认值逐字一致（两处必须同步变更）
  it('许可集为冻结文档 §5 的默认值', async () => {
    vi.resetModules();
    vi.doMock('@coze-arch/bot-http', () => ({ isEmbedded: () => true }));
    const { EMBEDDED_NODE_WHITELIST } = await importModule();

    expect([...EMBEDDED_NODE_WHITELIST].sort()).toEqual([
      '1',
      '11',
      '13',
      '15',
      '18',
      '2',
      '20',
      '3',
      '30',
      '31',
      '45',
      '5',
      '58',
      '8',
    ]);
  });
});
