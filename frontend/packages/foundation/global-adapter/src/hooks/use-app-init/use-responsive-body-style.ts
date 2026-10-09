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

import { useEffect } from 'react';

import {
  isEmbeddedDocument,
  setMobileBody,
  setPCBody,
} from '@coze-arch/bot-utils';
import { useIsResponsiveByRouteConfig } from '@coze-arch/bot-hooks';

export const useSetResponsiveBodyStyle = () => {
  const isResponsive = useIsResponsiveByRouteConfig();
  useEffect(() => {
    // 嵌入宿主 iframe 时文档尺寸归宿主容器管（宿主窗口可能窄于 1200px，画布必须随容器收缩），
    // 故与移动端一样不施加 PC 端的 1200×600 下限；独立部署仍走 setPCBody，行为不变。
    if (isResponsive || isEmbeddedDocument()) {
      setMobileBody();
    } else {
      setPCBody();
    }
  }, [isResponsive]);
};
