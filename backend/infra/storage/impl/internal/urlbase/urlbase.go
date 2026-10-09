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

// Package urlbase 把对象存储签名后的绝对 URL 换成客户端可达的基址。
package urlbase

import (
	"net/url"
	"os"
	"strings"

	"github.com/coze-dev/coze-studio/backend/types/consts"
)

// ClientBase 返回签发给客户端的 URL 基址（STORAGE_CLIENT_URL_BASE），未配置时返回空串。
func ClientBase() string {
	return strings.TrimSpace(os.Getenv(consts.StorageClientURLBase))
}

// Apply 按 STORAGE_CLIENT_URL_BASE 改写签名后的绝对 URL；未配置或基址不可用时原样返回。
//
// 为什么需要：MINIO_ENDPOINT 是服务端访问对象存储的地址，通常只在集群内可解析（minio:9000、
// workflow-storage 之类），直接签发给浏览器会 DNS 失败或打到错误的网关。上游 docker/nginx 靠
// sub_filter 改写响应体绕开这点；配置本项后后端直接签发客户端可达地址，部署侧不必再改写响应体。
//
// 两种基址形式：
//   - 绝对基址：https://cdn.example.com、https://example.com/local_storage
//   - 根相对基址：/local_storage（由前置代理把该前缀反代到对象存储，天然同源，无跨域与混合内容问题）
//
// 只替换 scheme://host 与可选路径前缀，path 与 query 原样透传——SigV4 把 host、path、query 都纳入
// 签名，因此代理转发到对象存储时必须以签名时的 host（即 MINIO_ENDPOINT）作为 Host 头，否则对象
// 存储会返回 403。
func Apply(signed string) string {
	base := ClientBase()
	if base == "" {
		return signed
	}

	u, err := url.Parse(signed)
	if err != nil {
		return signed
	}
	// EscapedPath 与 RawQuery 原样拼接，避免二次编码破坏签名。
	rest := u.EscapedPath()
	if u.RawQuery != "" {
		rest += "?" + u.RawQuery
	}

	if strings.HasPrefix(base, "/") {
		// 根相对基址；值恰为 "/" 时退化为不带前缀的根相对地址。
		return strings.TrimRight(base, "/") + rest
	}

	bu, err := url.Parse(base)
	if err != nil || bu.Host == "" {
		// 既不是绝对地址也不是根相对前缀（例如漏了 scheme 的 example.com:9000），不猜，保持原样。
		return signed
	}

	return bu.Scheme + "://" + bu.Host + strings.TrimRight(bu.EscapedPath(), "/") + rest
}
