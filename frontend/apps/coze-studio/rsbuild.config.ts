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

import path from 'path';

import { defineConfig } from '@coze-arch/rsbuild-config';
import { GLOBAL_ENVS } from '@coze-arch/bot-env';

const API_PROXY_TARGET = `http://localhost:${
  process.env.WEB_SERVER_PORT || 8888
}/`;

/**
 * 开发态 dev server 端口。共享配置（config/rsbuild-config）把 server.port 与 dev.client.port
 * 固定为 8080；本机 8080 常被其它服务占用，改用环境变量统一覆盖两者，否则 HMR websocket
 * 会连到与 API 端口不一致的地址（默认值 8080 与改造前一致）。
 */
const devServerPort = Number(process.env.DEV_SERVER_PORT) || 8080;

/** 归一化为「前导斜杠 + 结尾斜杠」的路径前缀；未设置或为 '/' 时返回 '/'。 */
const normalizeWorkflowCanvasBase = (raw: string | undefined): string => {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
};

/**
 * 画布子路径挂载：整包 SPA 由宿主以 iframe 形式挂在同源的 /workflow-canvas 下。
 * 资源前缀（output.assetPrefix）与路由 basename（source.define 的 ROUTER_BASENAME）必须取同一值，
 * 只改其一都会白屏；默认 '/' 时两者都等同于改造前行为，Coze 独立部署不受影响。
 * 依据：fenix 仓 docs/design/2026-09-29-workflow-v2-coze-frontend-changes.md §4。
 */
const workflowCanvasBase = normalizeWorkflowCanvasBase(
  process.env.WORKFLOW_CANVAS_BASE,
);
/** react-router basename 不带结尾斜杠（'/' 除外）。 */
const routerBasename =
  workflowCanvasBase === '/' ? '/' : workflowCanvasBase.slice(0, -1);

/** 开发态把画布 BFF 请求转给 fenix 侧 workflow-v2；路径与生产一致，不做 rewrite。 */
const WORKFLOW_BFF_PROXY_TARGET =
  process.env.WORKFLOW_CANVAS_BFF_PROXY_TARGET || 'http://127.0.0.1:8888';

const mergedConfig = defineConfig({
  server: {
    port: devServerPort,
    strictPort: true,
    proxy: [
      {
        context: ['/api'],
        target: API_PROXY_TARGET,
        secure: false,
        changeOrigin: true,
      },
      {
        context: ['/v1'],
        target: API_PROXY_TARGET,
        secure: false,
        changeOrigin: true,
      },
      {
        // 画布内请求统一走宿主同源 BFF（票据兑换 + workflow 透传），本地联调转发到 fenix。
        context: ['/workflow-canvas/bff'],
        target: WORKFLOW_BFF_PROXY_TARGET,
        secure: false,
        changeOrigin: true,
      },
    ],
  },
  html: {
    title: '扣子 Studio',
    favicon: './assets/favicon.png',
    template: './index.html',
    crossorigin: 'anonymous',
  },
  output: {
    // 子路径挂载时静态资源（含 favicon、动态 chunk）必须带同一前缀，否则 404 白屏。
    assetPrefix: workflowCanvasBase,
  },
  dev: {
    // rsbuild 开发态默认不启用资源前缀（`dev.assetPrefix` 默认 false），此时 HTML 里的资源 URL
    // 是根相对路径，浏览器按不带前缀的地址回程请求，宿主只反代 /workflow-canvas/* 时必然 404。
    // 注意：此处只接受布尔值或字符串——boolean true 表示「dev server 的绝对 URL」，
    // 传字符串才是「原样作为 publicPath」；宿主反代场景需要后者，故直接传 workflowCanvasBase。
    // 根路径挂载时保持 false，dev 行为与改造前一致。
    assetPrefix: workflowCanvasBase === '/' ? false : workflowCanvasBase,
    client: {
      // 共享配置把 dev.client.port 固定为 8080（HMR websocket），与本 app 的 server.port 同源覆盖。
      port: devServerPort,
    },
  },
  tools: {
    postcss: (opts, { addPlugins }) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      addPlugins([require('tailwindcss')('./tailwind.config.ts')]);
    },
    rspack(config, { appendPlugins, addRules, mergeConfig }) {
      addRules([
        {
          test: /\.(css|less|jsx|tsx|ts|js)/,
          exclude: [
            new RegExp('apps/coze-studio/src/index.css'),
            /node_modules/,
            new RegExp('packages/arch/i18n'),
          ],
          use: '@coze-arch/import-watch-loader',
        },
      ]);

      return mergeConfig(config, {
        module: {
          parser: {
            javascript: {
              exportsPresence: false,
            },
          },
        },
        resolve: {
          fallback: {
            path: require.resolve('path-browserify'),
          },
        },
        watchOptions: {
          poll: true,
        },
        ignoreWarnings: [
          /Critical dependency: the request of a dependency is an expression/,
          warning => true,
        ],
      });
    },
  },
  source: {
    define: {
      'process.env.IS_REACT18': JSON.stringify(true),
      // Arcosite editor sdk internal use
      'process.env.ARCOSITE_SDK_REGION': JSON.stringify(
        GLOBAL_ENVS.IS_OVERSEA ? 'VA' : 'CN',
      ),
      'process.env.ARCOSITE_SDK_SCOPE': JSON.stringify(
        GLOBAL_ENVS.IS_RELEASE_VERSION ? 'PUBLIC' : 'INSIDE',
      ),
      'process.env.TARO_PLATFORM': JSON.stringify('web'),
      'process.env.SUPPORT_TARO_POLYFILL': JSON.stringify('disabled'),
      'process.env.RUNTIME_ENTRY': JSON.stringify('@coze-dev/runtime'),
      'process.env.TARO_ENV': JSON.stringify('h5'),
      ENABLE_COVERAGE: JSON.stringify(false),
      // 路由 basename，与 output.assetPrefix 同值（见 workflowCanvasBase 注释）。
      ROUTER_BASENAME: JSON.stringify(routerBasename),
    },
    include: [
      path.resolve(__dirname, '../../packages'),
      path.resolve(__dirname, '../../infra/flags-devtool'),
      // The following packages contain undegraded ES 2022 syntax (private methods) that need to be packaged
      /\/node_modules\/(marked|@dagrejs|@tanstack)\//,
    ],
    alias: {
      '@coze-arch/foundation-sdk': require.resolve(
        '@coze-foundation/foundation-sdk',
      ),
      'react-router-dom': require.resolve('react-router-dom'),
    },
    /**
     * support inversify @injectable() and @inject decorators
     */
    decorators: {
      version: 'legacy',
    },
  },
  performance: {
    chunkSplit: {
      strategy: 'split-by-size',
      minSize: 3_000_000,
      maxSize: 6_000_000,
    },
  },
});

export default mergedConfig;
