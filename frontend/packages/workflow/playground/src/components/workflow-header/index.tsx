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

import React from 'react';

import { IconCozArrowLeft } from '@coze-arch/coze-design/icons';
import { IconButton, CozAvatar } from '@coze-arch/coze-design';
import { isEmbedded } from '@coze-arch/bot-http';

import { WorkflowInfo } from '../workflow-header-info';
import { useGlobalState } from '../../hooks';
import { getWorkflowHeaderTestId } from './utils';
import { PublishButton } from './components/publish-button-v2';
import {
  CollaboratorsButton,
  SubmitButton,
  DuplicateButton,
  HistoryButton,
  CreditButton,
  ReferenceButton,
} from './components';

import styles from './index.module.less';

const WorkFlowHeader: React.FC = () => {
  const globalState = useGlobalState();
  const { readonly, info, playgroundProps, workflowId } = globalState;

  /**
   * 嵌入模式（宿主 iframe）下导航与空间归属都由宿主承担：返回会跳到 Coze 站内的空间资源库 / bot 详情页，
   * 复制会弹 Coze 的空间选择并在新窗口打开 Coze 链接，在嵌入时点了都是错的，故不渲染这两处入口。
   */
  const embedded = isEmbedded();

  return (
    <div className={styles.container}>
      <div
        className={styles.left}
        data-testid={getWorkflowHeaderTestId('info')}
      >
        {embedded ? null : (
          <IconButton
            icon={<IconCozArrowLeft />}
            color="secondary"
            data-testid={getWorkflowHeaderTestId('back')}
            onClick={() => {
              playgroundProps.onBackClick?.(globalState);
            }}
          />
        )}

        <CozAvatar src={info.url || ''} type="platform" alt="Avatar" />

        <WorkflowInfo />
      </div>

      <div className={styles.right}>
        {/* will support soon */}
        {IS_OPEN_SOURCE ? null : <ReferenceButton workflowId={workflowId} />}

        {IS_OPEN_SOURCE ? null : (
          <>
            {!readonly && <CreditButton />}

            <HistoryButton />

            <CollaboratorsButton />

            <SubmitButton />
          </>
        )}

        <PublishButton />

        {/* 复制到空间：跨空间归属与跳转由宿主负责，嵌入模式下不提供该入口（同上） */}
        {embedded ? null : (
          <DuplicateButton mode={readonly ? 'button' : 'icon'} />
        )}
      </div>
    </div>
  );
};

export default React.memo(WorkFlowHeader);
