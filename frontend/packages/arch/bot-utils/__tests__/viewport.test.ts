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

import { isEmbeddedDocument, setMobileBody, setPCBody } from '../src/viewport';

describe('viewport', () => {
  it('#setMobileBody', () => {
    setMobileBody();
    const bodyStyle = document?.body?.style;
    const htmlStyle = document?.getElementsByTagName('html')?.[0]?.style;
    expect(bodyStyle.minWidth).toEqual('0');
    expect(bodyStyle.minHeight).toEqual('0');
    expect(htmlStyle.minWidth).toEqual('0');
    expect(htmlStyle.minHeight).toEqual('0');
  });

  it('#setPCBody', () => {
    setPCBody();
    const bodyStyle = document?.body?.style;
    const htmlStyle = document?.getElementsByTagName('html')?.[0]?.style;
    expect(bodyStyle.minWidth).toEqual('1200px');
    expect(bodyStyle.minHeight).toEqual('600px');
    expect(htmlStyle.minWidth).toEqual('1200px');
    expect(htmlStyle.minHeight).toEqual('600px');
  });

  // 顶层窗口（独立部署 / 宿主页面自身）不算嵌入态，PC 下限照旧
  it('#isEmbeddedDocument 在顶层窗口为 false', () => {
    expect(isEmbeddedDocument()).toBe(false);
  });

  // iframe 内（宿主嵌入画布）为 true：调用方据此不写文档宽高下限，把尺寸让给宿主容器
  it('#isEmbeddedDocument 在 iframe 内为 true', () => {
    vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window);
    expect(isEmbeddedDocument()).toBe(true);
    vi.restoreAllMocks();
  });

  // 读 window.top 抛错（跨域 / sandbox）时保守按非嵌入处理，不改变独立部署行为
  it('#isEmbeddedDocument 读取抛错时按非嵌入处理', () => {
    vi.spyOn(window, 'top', 'get').mockImplementation(() => {
      throw new Error('cross-origin');
    });
    expect(isEmbeddedDocument()).toBe(false);
    vi.restoreAllMocks();
  });
});
