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

/**
 * 是否运行在 iframe（宿主）中，即嵌入态；结果按文档生命周期不变。
 *
 * 语义与 `@coze-arch/bot-http` 的 `isEmbedded()` 相同，但本包不声明该依赖（同款就地实现见
 * `packages/arch/tea/src/index.ts`），故各自维护。跨域 / sandbox 下读 `window.top` 可能抛错，
 * 按「非嵌入」保守处理，不改变独立部署的行为。
 */
export const isEmbeddedDocument = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
    // eslint-disable-next-line @coze-arch/use-error-in-catch -- 抛错本身就是信号（跨域 / sandbox 拿不到 window.top），无需读取异常对象
  } catch {
    return false;
  }
};

export const setMobileBody = () => {
  const bodyStyle = document?.body?.style;
  const htmlStyle = document?.getElementsByTagName('html')?.[0]?.style;
  if (bodyStyle && htmlStyle) {
    bodyStyle.minHeight = '0';
    htmlStyle.minHeight = '0';
    bodyStyle.minWidth = '0';
    htmlStyle.minWidth = '0';
  }
};

export const setPCBody = () => {
  const bodyStyle = document?.body?.style;
  const htmlStyle = document?.getElementsByTagName('html')?.[0]?.style;
  if (bodyStyle && htmlStyle) {
    bodyStyle.minHeight = '600px';
    htmlStyle.minHeight = '600px';
    bodyStyle.minWidth = '1200px';
    htmlStyle.minWidth = '1200px';
  }
};
