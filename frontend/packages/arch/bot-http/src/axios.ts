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

import axios, {
  type AxiosError,
  type AxiosResponse,
  isAxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';
import { redirect } from '@coze-arch/web-context';
import { logger } from '@coze-arch/logger';

import {
  getApiBaseUrl,
  getTicket,
  isEmbedded,
  reportHostError,
  requestTicketRefresh,
  TICKET_HEADER_NAME,
} from './host-bridge';
import { emitAPIErrorEvent, APIErrorEvent } from './eventbus';
import { ApiError, reportHttpError, ReportEventNames } from './api-error';

interface UnauthorizedResponse {
  data: {
    redirect_uri: string;
  };
  code: number;
  msg: string;
}

export enum ErrorCodes {
  NOT_LOGIN = 700012006,
  COUNTRY_RESTRICTED = 700012015,
  COZE_TOKEN_INSUFFICIENT = 702082020,
  COZE_TOKEN_INSUFFICIENT_WORKFLOW = 702095072,
}

export const axiosInstance = axios.create();

const HTTP_STATUS_COE_UNAUTHORIZED = 401;

type ResponseInterceptorOnFulfilled = (res: AxiosResponse) => AxiosResponse;
const customInterceptors = {
  response: new Set<ResponseInterceptorOnFulfilled>(),
};

/** 兼容 axios 的两种 headers 形态（AxiosHeaders 实例 / 普通对象）写入请求头。 */
const setConfigHeader = (
  config: InternalAxiosRequestConfig,
  key: string,
  value: string,
) => {
  if (typeof config.headers.set === 'function') {
    config.headers.set(key, value);
  } else {
    config.headers[key] = value;
  }
};

/**
 * 成功响应处理：日志、业务错误码（`code !== 0`）转 ApiError、自定义响应拦截器。
 * 正常链路与 401 换票后的重放链路共用，保证两条链路的解包与报错语义一致。
 */
const processResponse: ResponseInterceptorOnFulfilled = response => {
  logger.info({
    namespace: 'api',
    scope: 'response',
    message: '----',
    meta: { response },
  });
  const { data = {} } = response;

  // Added interface return message field
  const { code, msg, message } = data;

  if (code !== 0) {
    const apiError = new ApiError(String(code), message ?? msg, response);

    switch (code) {
      case ErrorCodes.NOT_LOGIN: {
        // @ts-expect-error type safe
        apiError.config.__disableErrorToast = true;
        emitAPIErrorEvent(APIErrorEvent.UNAUTHORIZED, apiError);
        break;
      }
      case ErrorCodes.COUNTRY_RESTRICTED: {
        // @ts-expect-error type safe
        apiError.config.__disableErrorToast = true;
        emitAPIErrorEvent(APIErrorEvent.COUNTRY_RESTRICTED, apiError);
        break;
      }
      case ErrorCodes.COZE_TOKEN_INSUFFICIENT: {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        apiError.config.__disableErrorToast = true;
        emitAPIErrorEvent(APIErrorEvent.COZE_TOKEN_INSUFFICIENT, apiError);
        break;
      }
      case ErrorCodes.COZE_TOKEN_INSUFFICIENT_WORKFLOW: {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        apiError.config.__disableErrorToast = true;
        emitAPIErrorEvent(APIErrorEvent.COZE_TOKEN_INSUFFICIENT, apiError);
        break;
      }
      default: {
        break;
      }
    }

    reportHttpError(ReportEventNames.ApiError, apiError);
    // 抛错而非返回 rejected Promise：本函数同时用作 axios onFulfilled 与重放链路的响应处理，
    // 抛错在两条链路上的语义都是"当前响应失败"，且保持返回类型为 AxiosResponse
    throw apiError;
  }
  let res = response;
  for (const interceptor of customInterceptors.response) {
    res = interceptor(res);
  }

  return res;
};

/**
 * 非嵌入场景（Coze 独立运行）保持既有行为：带 redirect_uri 的 401 整页跳转登录页。
 * 嵌入场景由宿主接管会话，见 handleUnauthorized。
 */
const redirectToLogin = (error: AxiosError) => {
  if (typeof error.response?.data === 'object') {
    const unauthorizedData = error.response.data as UnauthorizedResponse;
    const redirectUri = unauthorizedData?.data?.redirect_uri;
    if (redirectUri) {
      redirect(redirectUri);
    }
  }
};

/** 上报 401 无法自愈，由宿主展示降级页；只带上状态码，不回传 URL / 参数等可能含敏感信息的字段。 */
const reportUnauthorizedToHost = (error: unknown, retryable: boolean) => {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  reportHostError({
    code: status ? `http_${status}` : 'request_failed',
    message: status
      ? `canvas request failed with status ${status}`
      : 'canvas request failed',
    retryable,
  });
};

/**
 * 重放 401 前的请求（宿主换票成功后调用一次）。
 *
 * 走无拦截器的独立实例：`config` 已经过 axiosInstance 的请求拦截器（headers / CSRF / params 就绪），
 * 而重放结果不能再进 axiosInstance 的响应拦截器链——链上还有下游拦截器（如 bot-api 的
 * `response => response.data`）只接受 AxiosResponse，把已解包的结果再喂一次会二次解包。
 */
const replayAxiosInstance = axios.create();

const replayWithFreshTicket = (
  config: InternalAxiosRequestConfig,
): Promise<AxiosResponse> => {
  const replayConfig: InternalAxiosRequestConfig = { ...config };
  const freshTicket = getTicket();
  if (freshTicket) {
    setConfigHeader(replayConfig, TICKET_HEADER_NAME, freshTicket);
  }
  const baseURL = getApiBaseUrl();
  if (baseURL) {
    replayConfig.baseURL = baseURL;
  }
  return replayAxiosInstance.request(replayConfig);
};

/**
 * 401 处理：
 * - 非嵌入：整页跳转（保持原行为）；
 * - 嵌入：向宿主换票后重放一次原请求；换票或重放失败则上报宿主并抛出原始 401。
 */
const handleUnauthorized = (error: AxiosError): Promise<AxiosResponse> => {
  if (!isEmbedded()) {
    redirectToLogin(error);
    return Promise.reject(error);
  }
  const { config } = error;
  if (!config) {
    reportUnauthorizedToHost(error, false);
    return Promise.reject(error);
  }
  return requestTicketRefresh().then(refreshed => {
    if (!refreshed) {
      reportUnauthorizedToHost(error, false);
      return Promise.reject(error);
    }
    return replayWithFreshTicket(config).then(
      response => processResponse(response),
      replayError => {
        if (isAxiosError(replayError)) {
          reportHttpError(ReportEventNames.NetworkError, replayError);
        }
        reportUnauthorizedToHost(replayError, true);
        // 调用方拿到原始 401（票据已失效），由宿主展示降级与重新登录入口
        return Promise.reject(error);
      },
    );
  });
};

axiosInstance.interceptors.response.use(processResponse, error => {
  if (isAxiosError(error)) {
    reportHttpError(ReportEventNames.NetworkError, error);
    if (error.response?.status === HTTP_STATUS_COE_UNAUTHORIZED) {
      // 401 Identity Expired & No Identity
      return handleUnauthorized(error);
    }
  }

  return Promise.reject(error);
});

axiosInstance.interceptors.request.use(config => {
  const setHeader = (key: string, value: string) => {
    setConfigHeader(config, key, value);
  };
  const getHeader = (key: string) => {
    if (typeof config.headers.get === 'function') {
      return config.headers.get(key);
    }
    return config.headers[key];
  };
  setHeader('x-requested-with', 'XMLHttpRequest');
  if (
    ['post', 'get'].includes(config.method?.toLowerCase() ?? '') &&
    !getHeader('content-type')
  ) {
    // The new CSRF protection requires all post/get requests to have this header.
    setHeader('content-type', 'application/json');
    if (!config.data) {
      // Axios will automatically clear the content-type when the data is empty, so you need to set an empty object
      config.data = {};
    }
  }

  // 宿主嵌入场景（fenix iframe）：请求前缀切到宿主下发的 BFF 基址并携带短期票据；
  // 无宿主上下文时 getApiBaseUrl / getTicket 都返回 undefined，行为与改造前完全一致。
  const apiBaseUrl = getApiBaseUrl();
  if (apiBaseUrl) {
    config.baseURL = apiBaseUrl;
  }
  const ticket = getTicket();
  if (ticket) {
    setHeader(TICKET_HEADER_NAME, ticket);
  }

  return config;
});

type AddRequestInterceptorShape = typeof axiosInstance.interceptors.request.use;
/**
 * Add an interceptor handler for global axios to easily extend axios behavior on top.
 * Please note that this interface will affect all requests under bot-http. Please ensure the stability of the behavior
 */
export const addGlobalRequestInterceptor: AddRequestInterceptorShape = (
  onFulfilled,
  onRejected?,
) => {
  // PS: It is not expected to directly expose the axios instance to the upper layer, because it is not known how it will be modified and used
  // Therefore, several methods need to be exposed to keep behavior and side effects under control
  const id = axiosInstance.interceptors.request.use(onFulfilled, onRejected);
  return id;
};

type RemoveRequestInterceptorShape =
  typeof axiosInstance.interceptors.request.eject;
/**
 * Removes the interceptor handler of the global axios where the id parameter is the value returned by the calling addGlobalRequestInterceptor
 */
export const removeGlobalRequestInterceptor: RemoveRequestInterceptorShape = (
  id: number,
) => {
  axiosInstance.interceptors.request.eject(id);
};

export const addGlobalResponseInterceptor = (
  onFulfilled: ResponseInterceptorOnFulfilled,
) => {
  customInterceptors.response.add(onFulfilled);
  return () => {
    customInterceptors.response.delete(onFulfilled);
  };
};
