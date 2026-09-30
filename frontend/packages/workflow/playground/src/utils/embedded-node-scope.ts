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

import { type StandardNodeType } from '@coze-workflow/base';
import { isEmbedded } from '@coze-arch/bot-http';

/**
 * 嵌入模式（宿主 iframe）下节点面板的兜底许可集。
 *
 * 为什么需要兜底：面板清单来自服务端 `node_template_list`（cate_list / template_list）与
 * `node_panel_search`，**BFF（fenix `workflow-v2` 的 node-scope.ts）是权威过滤方**，客户端绕不过；
 * 但 `getEnabledNodeTypes()`（workflow/adapter/base 的 get-enabled-node-types.ts）是一份本地静态节点清单，
 * 且 `WorkflowPlaygroundContext.getTemplateCategoryList()` 在服务端 cate_list 为空时会用它兜底成分类，
 * 这条路径不经过服务端过滤，故嵌入模式下按同一许可集再收窄一次。
 *
 * 这里是兜底，两处必须同步变更：许可集 = fenix 冻结文档 `2026-09-29-workflow-v2-interface-freeze.md` §5 的
 * `WORKFLOW_V2_NODE_WHITELIST` 默认值（数字字符串，接口只认数字字符串）。
 */
export const EMBEDDED_NODE_WHITELIST: ReadonlySet<string> = new Set([
  '1', // Start
  '2', // End
  '3', // LLM
  '5', // Code
  '8', // If
  '11', // Variable
  '13', // Output
  '15', // Text（文本处理）
  '18', // Question
  '20', // SetVariable
  '30', // Input
  '31', // Comment
  '45', // Http
  '58', // JsonStringify
]);

/**
 * 嵌入模式下收窄本地静态节点清单；非嵌入（Coze 独立部署）原样返回，行为不变。
 * 缺失类型一律滤除（fail-closed）：Coze 新增的节点类型不该自动出现在我们的画布上。
 */
export const filterEmbeddedNodeTypes = (
  nodeTypes: StandardNodeType[],
): StandardNodeType[] =>
  isEmbedded()
    ? nodeTypes.filter(nodeType => EMBEDDED_NODE_WHITELIST.has(nodeType))
    : nodeTypes;
