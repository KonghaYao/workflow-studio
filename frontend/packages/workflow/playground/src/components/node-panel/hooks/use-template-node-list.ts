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

import {
  type WorkflowNodeEntity,
  type WorkflowNodeMeta,
  useService,
} from '@flowgram-adapter/free-layout-editor';
import {
  getEnabledNodeTypes,
  useSupportImageflowNodesQuery,
} from '@coze-workflow/base-adapter';
import { StandardNodeType } from '@coze-workflow/base';

import { WorkflowPlaygroundContext } from '@/workflow-playground-context';
import { filterEmbeddedNodeTypes } from '@/utils/embedded-node-scope';
import { type NodeCategory } from '@/typing';
import { useGetWorkflowMode, useGlobalState } from '@/hooks';

const getLoopSelected = (containerNode?: WorkflowNodeEntity) => {
  if (!containerNode) {
    return false;
  }
  const containerSubCanvas = containerNode
    .getNodeMeta<WorkflowNodeMeta>()
    .subCanvas?.(containerNode);
  if (
    containerSubCanvas?.isCanvas &&
    containerSubCanvas.parentNode.flowNodeType === StandardNodeType.Loop
  ) {
    return true;
  }
  return false;
};

export const useTemplateNodeList = (
  containerNode?: WorkflowNodeEntity,
): NodeCategory[] => {
  const loopSelected = getLoopSelected(containerNode);

  const context = useService<WorkflowPlaygroundContext>(
    WorkflowPlaygroundContext,
  );

  const { isSceneFlow } = useGetWorkflowMode();
  const { projectId, isBindDouyin } = useGlobalState();
  const { isSupportImageflowNodes } = useSupportImageflowNodesQuery();

  const nodeCategoryList = context.getTemplateCategoryList(
    // 嵌入模式下按兜底许可集收窄本地静态清单（服务端 cate_list 为空时的兜底分类会用这份清单）；非嵌入不受影响
    filterEmbeddedNodeTypes(
      getEnabledNodeTypes({
        loopSelected,
        isSceneFlow,
        isProject: Boolean(projectId),
        isSupportImageflowNodes,
        isBindDouyin: Boolean(isBindDouyin),
      }),
    ),
    isSupportImageflowNodes,
  );

  return nodeCategoryList;
};
