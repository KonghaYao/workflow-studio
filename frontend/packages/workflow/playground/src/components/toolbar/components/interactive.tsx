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

import { useEffect, useState } from 'react';

import { usePlaygroundTools } from '@flowgram-adapter/free-layout-editor';
import { type InteractiveType as IdeInteractiveType } from '@flowgram-adapter/free-layout-editor';
import {
  GuidingPopover,
  InteractiveType,
  MousePadSelector,
  getPreferInteractiveType,
  setPreferInteractiveType,
} from '@coze-common/mouse-pad-selector';
import { I18n } from '@coze-arch/i18n';
import { Tooltip } from '@coze-arch/coze-design';
import { isEmbedded } from '@coze-arch/bot-http';

export const Interactive = () => {
  const tools = usePlaygroundTools();

  const [interactiveType, setInteractiveType] = useState<InteractiveType>(
    () => getPreferInteractiveType() as InteractiveType,
  );

  const [showInteractivePanel, setShowInteractivePanel] = useState(false);

  const mousePadTooltip = I18n.t(
    interactiveType === InteractiveType.Mouse
      ? 'workflow_mouse_friendly'
      : 'workflow_pad_friendly',
  );

  useEffect(() => {
    tools.setMouseScrollDelta(zoom => zoom / 20);

    // Read interactive mode from cache, application takes effect
    const preferInteractiveType = getPreferInteractiveType();
    tools.setInteractiveType(preferInteractiveType as IdeInteractiveType);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init
  }, []);

  const interactiveSelector = (
    <Tooltip
      content={mousePadTooltip}
      style={{ display: showInteractivePanel ? 'none' : 'block' }}
    >
      <div
        className="workflow-toolbar-interactive"
        data-testid="workflow.detail.toolbar.interactive"
      >
        <MousePadSelector
          value={interactiveType}
          onChange={value => {
            setInteractiveType(value);
            setPreferInteractiveType(value);
            tools.setInteractiveType(value as unknown as IdeInteractiveType);
          }}
          onPopupVisibleChange={setShowInteractivePanel}
          containerStyle={{
            border: 'none',
            height: '24px',
            width: '38px',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '2px',
            padding: '4px',
            paddingTop: '1px',
            borderRadius: 'var(--small, 6px)',
          }}
          iconStyle={{
            margin: '0',
            width: '16px',
            height: '16px',
          }}
          arrowStyle={{
            width: '12px',
            height: '12px',
          }}
        />
      </div>
    </Tooltip>
  );

  // 嵌入态（宿主 iframe）不挂一次性交互引导浮层 `GuidingPopover`：它弹在画布中央，会盖住节点并吃掉
  // 真实点击（点击被浮层内部接住，「点击外部关闭」不触发，用户只能点浮层里的「Got it」才能继续）。
  // 该引导面向上游独立站的首次访问者，嵌入态的引导由宿主页面承担；非嵌入态行为不变。
  if (isEmbedded()) {
    return interactiveSelector;
  }

  return <GuidingPopover>{interactiveSelector}</GuidingPopover>;
};
