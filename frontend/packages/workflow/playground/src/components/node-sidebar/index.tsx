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

import { forwardRef, useCallback, type MouseEvent } from 'react';

import { get } from 'lodash-es';
import { useService } from '@flowgram-adapter/free-layout-editor';
import { StandardNodeType } from '@coze-workflow/base';
import { isEmbedded } from '@coze-arch/bot-http';

import { type AddNodeRef, type UnionNodeTemplate } from '@/typing';
import { WorkflowEditService } from '@/services';

import { NodePanelContextProvider } from '../node-panel/hooks/node-panel-context';
import { useTemplateNodeList } from '../node-panel/hooks';
import { AtomCategoryList } from '../node-panel/components/atom-category-list';

import styles from './index.module.less';

/**
 * 嵌入态（fenix 宿主 iframe）专用的常驻左侧节点面板。
 *
 * 为什么需要：上游把节点入口收敛到顶部工具栏 + 弹层
 * （`hooks/use-workflow-preset.tsx` 的 `createFreeNodePanelPlugin({ renderer: NodePanel })`），
 * 而宿主侧要保留「左侧常驻节点 block、可直接拖拽」的既有交互，故在嵌入态恢复一栏；与弹层**共存**，
 * 两条入口都指向同一份节点清单与同一套添加链路。
 *
 * 数据源与条目形态与弹层一致：
 * - 数据源复用 `useTemplateNodeList()`（与 `NodeList` 同一条链），含嵌入态白名单过滤
 *   （`utils/embedded-node-scope.ts` 的 `filterEmbeddedNodeTypes`，未放宽）；
 * - 条目复用 `AtomCategoryList`（`NodeCategoryPanel` + `CustomDragCard` + `NodeCard`），拖拽走 react-dnd，
 *   数据 key 与画布 `useDrop` 的 accept 一致（`constants` 的 `DND_ACCEPT_KEY`），落到画布后由
 *   `AddNodeModalProvider` 承接添加（`components/workflow-container/index.tsx:233`），链路与弹层一致。
 *
 * 非嵌入态（Coze 独立部署 / 顶层窗口直连）：`isEmbedded()` 为 false 时整栏不渲染，上游形态不变。
 * gate 放在组件内而不是调用方（`adapter/playground/src/page.tsx`）：该包未声明 `@coze-arch/bot-http`
 * 依赖，pnpm 严格解析下 phantom import 拿不到（同仓先例：`apps/coze-studio/src/routes/index.tsx:76-78`），
 * 而 playground 包已依赖 bot-http，判据与 `utils/embedded-node-scope.ts:18` 同源。
 *
 * 不写 `addNodeRef`、不实现 `useImperativeHandle`：容器把同一个 ref 同时挂在 `<Sidebar>` 与
 * `<AddNodeModalProvider>` 上（`components/workflow-container/index.tsx:105,232-233`），画布 drop 依赖
 * provider 写出的 `handleAddNode`；本组件渲染序在前、若也写 ref 会与 provider 争用同一个 ref，
 * 有覆盖掉 provider 值的风险，因此这里只渲染列表。
 */

/**
 * 点击添加需要弹层的节点类型（见 `handleSelect` 的缺口说明）。
 * 常量提到模块级，避免每次渲染重建 Set。
 */
const MODAL_NODE_TYPES: ReadonlySet<StandardNodeType> = new Set([
  StandardNodeType.Api,
  StandardNodeType.SubWorkflow,
  StandardNodeType.Imageflow,
]);

const NodeSidebarContent = () => {
  const editService = useService<WorkflowEditService>(WorkflowEditService);
  // 不带 containerNode：侧栏是画布级入口，取全局分类清单（含嵌入白名单过滤）。
  const nodeCategoryList = useTemplateNodeList();

  const handleSelect = useCallback(
    ({
      event,
      nodeTemplate,
    }: {
      event: MouseEvent<HTMLElement>;
      nodeTemplate: UnionNodeTemplate;
    }) => {
      const nodeType = nodeTemplate?.type as StandardNodeType;

      // 已知缺口（最小实现）：Api / SubWorkflow / Imageflow 的**点击**添加在上游走弹层
      // （`components/node-panel/components/panel.tsx:164-219` 的 openPlugin / openWorkflow /
      // openImageflow），依赖 `AddNodeModalProvider` 提供的 context；侧栏与 provider 是兄弟节点
      // （`components/workflow-container/index.tsx:232-233`），拿不到该 context，故这三类节点
      // 在这里不做点击添加（点按无响应，不是静默失败）。
      // 影响范围：仅嵌入态侧栏的点击入口。这三类节点同时在嵌入白名单之外
      // （`utils/embedded-node-scope.ts` 的 `EMBEDDED_NODE_WHITELIST` 不含 4/9/14），
      // 正常数据链路下不可达；拖拽入口不受影响（拖拽经画布 drop → provider，链路完整）。
      // 移除条件：把侧栏移进 `AddNodeModalProvider` 子树（或把 provider 提升到 `workflow-content`
      // 一层）后，按 panel.tsx 的分支补齐弹层调用。
      if (MODAL_NODE_TYPES.has(nodeType)) {
        return;
      }

      // 普通节点：与拖拽落点同语义，用鼠标位置（client 坐标）交给画布编辑服务，
      // 内部完成画布坐标换算与防重叠（`services/workflow-edit-service.ts` 的 addNode）。
      void editService.addNode(
        nodeType,
        get(nodeTemplate, 'nodeJSON'),
        { clientX: event.clientX, clientY: event.clientY },
        false,
      );
    },
    [editService],
  );

  return (
    <div
      className={styles['node-sidebar']}
      data-testid="workflow.detail.node-sidebar"
    >
      <NodePanelContextProvider
        value={{ onSelect: handleSelect, enableDrag: true, keyword: '' }}
      >
        <div
          className={styles['node-sidebar-list']}
          data-testid="workflow.detail.node-sidebar.list"
        >
          <AtomCategoryList data={nodeCategoryList} />
        </div>
      </NodePanelContextProvider>
    </div>
  );
};

export const NodeSidebar = forwardRef<AddNodeRef, unknown>((_props, _ref) => {
  if (!isEmbedded()) {
    return null;
  }
  return <NodeSidebarContent />;
});

NodeSidebar.displayName = 'NodeSidebar';
