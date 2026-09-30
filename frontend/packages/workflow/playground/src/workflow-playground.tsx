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

import 'reflect-metadata';

import { HTML5Backend } from 'react-dnd-html5-backend';
import { DndProvider } from 'react-dnd';
import { forwardRef, useEffect, type PropsWithChildren } from 'react';

import { useShallow } from 'zustand/react/shallow';
import { QueryClientProvider } from '@tanstack/react-query';
import { WorkflowRenderProvider } from '@coze-workflow/render';
import { WorkflowNodesContainerModule } from '@coze-workflow/nodes';
import { WorkflowHistoryContainerModule } from '@coze-workflow/history';
import { PUBLIC_SPACE_ID } from '@coze-workflow/base/constants';
import { workflowQueryClient } from '@coze-workflow/base/api';
import { GlobalError } from '@coze-foundation/layout';
import { ErrorBoundary, logger } from '@coze-arch/logger';
import { useSpaceStore } from '@coze-arch/bot-studio-store';
import { isEmbedded } from '@coze-arch/bot-http';

import { seedEmbeddedSpace, watchEmbeddedSpace } from './utils/embedded-space';
import {
  type WorkflowPlaygroundProps,
  type WorkflowPlaygroundRef,
} from './typing';
import { useWorkflowPreset } from './hooks';
import { WorkflowPageContainerModule } from './container/workflow-page-container-module';
import WorkflowContainer from './components/workflow-container';

const loggerWithScope = logger.createLoggerWith({
  ctx: {
    namespace: 'workflow-error',
  },
});

const PlayGroundErrorBoundary = (props: PropsWithChildren) => {
  // Use your own ErrorBoundary to display errors under the operation and maintenance platform, which can display more detailed errors.
  // At the same time, avoid white screen errors under the operation and maintenance platform.
  if (IS_BOT_OP) {
    return <>{props.children}</>;
  }

  return (
    <ErrorBoundary
      FallbackComponent={() => (IS_BOT_OP ? null : <GlobalError />)}
      errorBoundaryName="workflow-error-boundary"
      logger={loggerWithScope}
    >
      {props.children}
    </ErrorBoundary>
  );
};

export const WorkflowPlayground = forwardRef<
  WorkflowPlaygroundRef,
  WorkflowPlaygroundProps
>(({ spaceId = PUBLIC_SPACE_ID, parentContainer, ...props }, ref) => {
  const { spaceList, setSpace, fetchSpaces, checkSpaceID, inited } =
    useSpaceStore(
      useShallow(store => ({
        spaceList: store.spaceList,
        setSpace: store.setSpace,
        fetchSpaces: store.fetchSpaces,
        checkSpaceID: store.checkSpaceID,
        inited: store.inited,
      })),
    );
  useEffect(() => {
    let isActive = true;
    // 宿主 iframe 内没有 Coze 会话：跳过 GetSpaceListV2，按 URL 下发的 space id 直接注桩（见 utils/embedded-space）。
    // 路由层用同一事实决定是否放行画布（apps/coze-studio 的 requireAuth 分支），独立部署下此分支不生效。
    const embedded = isEmbedded();
    if (embedded) {
      seedEmbeddedSpace(spaceId);
    }
    const initSpace = async () => {
      if (!embedded && !inited) {
        await fetchSpaces(true);
      }
      if (!isActive) {
        return;
      }

      checkSpaceID(spaceId);
      if (spaceId !== PUBLIC_SPACE_ID) {
        setSpace(spaceId);
      }
    };

    initSpace();

    // 注桩会被壳层的「登出清理」reset 掉（嵌入模式恒无 Coze 会话），而本 effect 依赖不变不会重跑，故订阅自愈
    const unwatchEmbeddedSpace = embedded
      ? watchEmbeddedSpace(spaceId)
      : undefined;

    return () => {
      isActive = false;
      unwatchEmbeddedSpace?.();
    };
  }, [spaceId, fetchSpaces, setSpace, checkSpaceID]);

  const preset = useWorkflowPreset(props);

  if (!inited) {
    return null;
  }

  return (
    <DndProvider backend={HTML5Backend} context={window}>
      <QueryClientProvider client={workflowQueryClient}>
        <WorkflowRenderProvider
          parentContainer={parentContainer}
          containerModules={[
            WorkflowNodesContainerModule,
            WorkflowPageContainerModule,
            WorkflowHistoryContainerModule,
          ]}
          preset={preset}
        >
          <PlayGroundErrorBoundary>
            <WorkflowContainer
              ref={ref}
              {...props}
              spaceId={spaceId}
              spaceList={spaceList}
            />
          </PlayGroundErrorBoundary>
        </WorkflowRenderProvider>
      </QueryClientProvider>
    </DndProvider>
  );
});
