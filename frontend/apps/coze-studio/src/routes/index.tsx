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

import { createBrowserRouter, Navigate } from 'react-router-dom';

import { SpaceSubModuleEnum } from '@coze-foundation/space-ui-adapter';
import { GlobalError } from '@coze-foundation/layout';
import { BaseEnum } from '@coze-arch/web-context';

import { Layout } from '../layout';
import {
  LoginPage,
  SpaceLayout,
  SpaceIdLayout,
  Develop,
  AgentIDELayout,
  AgentIDE,
  AgentPublishPage,
  Redirect,
  spaceSubMenu,
  exploreSubMenu,
  WorkflowPage,
  SearchPage,
  ProjectIDE,
  ProjectIDEPublish,
  Library,
  PluginLayout,
  PluginToolPage,
  PluginPage,
  KnowledgePreview,
  KnowledgeUpload,
  DatabaseDetail,
  ExplorePluginPage,
  ExploreTemplatePage,
  OAuthConsentConfirmPage,
} from './async-components';

/**
 * 构建期常量，由 rsbuild `source.define` 注入（见 apps/coze-studio/rsbuild.config.ts 的 WORKFLOW_CANVAS_BASE）。
 * 必须以裸标识符引用才会在打包时被替换；`typeof` 守卫用于未被替换的环境（单测、非打包运行），避免 ReferenceError。
 */
declare const ROUTER_BASENAME: string | undefined;

/** 路由 basename 与资源前缀同源：子路径挂载时二者不一致会白屏（见 rsbuild.config.ts）。 */
const routerBasename =
  typeof ROUTER_BASENAME === 'undefined' ? '/' : ROUTER_BASENAME;

/** 宿主下发的握手参数名，与 `@coze-arch/bot-http/src/host-bridge.ts` 的 `API_BASE_URL_PARAM` 同值（改名需两侧同步）。 */
const HOST_HANDSHAKE_PARAM = 'apiBase';

/**
 * 画布是否运行在 fenix 宿主 iframe 内。嵌入时认证由宿主票据承担（画布请求经 host-bridge 换票后走 BFF），
 * 画布内没有 Coze 会话，保留登录闸门会把画布重定向到登录页。
 *
 * 判据是「在 iframe 内」+「宿主已按冻结协议下发握手参数」两者同时成立：
 * - 只看 iframe 会让「任意页面把画布套进 iframe」也失去登录保护，故要求一个只有宿主才会带上的信号；
 * - `apiBase` 是宿主页拼在 iframe URL 上的固定参数（`2026-09-29-workflow-v2-interface-freeze.md` §7 的
 *   iframe URL 参数），也是 bot-http 决定 API 基址、首屏请求直达 BFF 的前提，属启动期可得的握手证据。
 *
 * 缺该参数时按「非嵌入」fail-closed：画布保留登录闸门（此时首屏请求也到不了 BFF，属宿主页未按协议接线）。
 * 跨域 / sandbox 下读 `window.top` 会抛错，同样按「非嵌入」处理，保证 Coze 独立运行时始终保留登录保护。
 *
 * 与 `@coze-arch/bot-http` 的 `isEmbedded()` 相比多一层参数校验：本应用未声明 `@coze-arch/bot-http` 依赖
 * （node_modules 里没有软链，phantom import 在 pnpm 下解析不到），故就地实现最小判据，不复用其 `isEmbedded()`。
 */
const isEmbeddedCanvas = (): boolean => {
  try {
    if (window.self === window.top) {
      return false;
    }
  } catch {
    return false;
  }
  const handshake = new URLSearchParams(window.location.search).get(
    HOST_HANDSHAKE_PARAM,
  );
  return Boolean(handshake);
};

export const router: ReturnType<typeof createBrowserRouter> =
  // 路由表体量大，重排缩进会产生与 basename 注入无关的整表 diff，故固定原格式，仅在调用末尾追加 basename 参数。
  // prettier-ignore
  createBrowserRouter([
    // Document routing
    {
      path: '/open/docs/*',
      Component: Redirect,
      loader: () => ({
        hasSider: false,
        requireAuth: false,
      }),
    },
    {
      path: '/docs/*',
      Component: Redirect,
      loader: () => ({
        hasSider: false,
        requireAuth: false,
      }),
    },
    {
      path: '/information/auth/success',
      Component: Redirect,
      loader: () => ({
        hasSider: false,
        requireAuth: false,
      }),
    },
    // main application route
    {
      path: '/',
      Component: Layout,
      errorElement: <GlobalError />,
      children: [
        {
          index: true,
          element: <Navigate to="/space" replace />,
        },
        // login page routing
        {
          path: 'sign',
          Component: LoginPage,
          errorElement: <GlobalError />,
          loader: () => ({
            hasSider: false,
            requireAuth: false,
          }),
        },

        // OAuth consent confirm page
        {
          path: 'oauth/confirm',
          Component: OAuthConsentConfirmPage,
          errorElement: <GlobalError />,
          loader: () => ({
            hasSider: false,
            requireAuth: false,
          }),
        },

        // Workspace Routing
        {
          path: 'space',
          Component: SpaceLayout,
          loader: () => ({
            hasSider: true,
            requireAuth: true,
            subMenu: spaceSubMenu,
            menuKey: BaseEnum.Space,
          }),
          children: [
            {
              path: ':space_id',
              Component: SpaceIdLayout,
              children: [
                {
                  index: true,
                  element: <Navigate to="develop" replace />,
                },

                // Project Development
                {
                  path: 'develop',
                  Component: Develop,
                  loader: () => ({
                    subMenuKey: SpaceSubModuleEnum.DEVELOP,
                  }),
                },

                // Agent IDE
                {
                  path: 'bot/:bot_id',
                  Component: AgentIDELayout,
                  children: [
                    {
                      index: true,
                      Component: AgentIDE,
                    },
                    {
                      path: 'publish',
                      children: [
                        {
                          index: true,
                          Component: AgentPublishPage,
                          loader: () => ({
                            hasSider: false,
                            requireBotEditorInit: false,
                            pageName: 'publish',
                          }),
                        },
                      ],
                    },
                  ],
                  loader: () => ({
                    hasSider: false,
                    showMobileTips: true,
                    requireBotEditorInit: true,
                    pageName: 'bot',
                  }),
                },

                // Project IDE
                {
                  path: 'project-ide/:project_id/publish',
                  loader: () => ({
                    hasSider: false,
                  }),
                  Component: ProjectIDEPublish,
                },
                {
                  path: 'project-ide/:project_id/*',
                  Component: ProjectIDE,
                  loader: () => ({
                    hasSider: false,
                  }),
                },

                // resource library
                {
                  path: 'library',
                  Component: Library,
                  loader: () => ({
                    subMenuKey: SpaceSubModuleEnum.LIBRARY,
                  }),
                },

                // Knowledge Base Resources
                {
                  path: 'knowledge',
                  children: [
                    {
                      path: ':dataset_id',
                      element: <KnowledgePreview />,
                    },
                    {
                      path: ':dataset_id/upload',
                      element: <KnowledgeUpload />,
                    },
                  ],
                  loader: () => ({
                    pageModeByQuery: true,
                  }),
                },

                // database resources
                {
                  path: 'database',
                  children: [
                    {
                      path: ':table_id',
                      element: <DatabaseDetail />,
                    },
                  ],
                  loader: () => ({
                    showMobileTips: true,
                    pageModeByQuery: true,
                  }),
                },

                // plugin resources
                {
                  path: 'plugin/:plugin_id',
                  Component: PluginLayout,
                  children: [
                    {
                      index: true,
                      Component: PluginPage,
                    },
                    {
                      path: 'tool/:tool_id',
                      children: [
                        {
                          index: true,
                          Component: PluginToolPage,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },

        // workflow routing
        {
          path: 'work_flow',
          Component: WorkflowPage,
          loader: () => ({
            hasSider: false,
            // 嵌入宿主 iframe 时无 Coze 会话（认证走宿主票据），保留登录闸门会把画布重定向到登录页；
            // 独立运行时仍为 true，登录保护不变。
            requireAuth: !isEmbeddedCanvas(),
          }),
        },

        // search
        {
          path: 'search/:word',
          Component: SearchPage,
          loader: () => ({
            hasSider: true,
            requireAuth: true,
          }),
        },

        // explore
        {
          path: 'explore',
          Component: null,
          loader: () => ({
            hasSider: true,
            requireAuth: true,
            subMenu: exploreSubMenu,
            menuKey: BaseEnum.Explore,
          }),
          children: [
            {
              index: true,
              element: <Navigate to="plugin" replace />,
            },
            // plugin store
            {
              path: 'plugin',
              element: <ExplorePluginPage />,
              loader: () => ({
                type: 'plugin',
              }),
            },
            // template
            {
              path: 'template',
              element: <ExploreTemplatePage />,
              loader: () => ({
                type: 'template',
              }),
            },
          ],
        },
      ],
    },
  ], { basename: routerBasename });
