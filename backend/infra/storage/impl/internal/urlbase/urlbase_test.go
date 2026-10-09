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

package urlbase

import (
	"testing"

	"github.com/coze-dev/coze-studio/backend/types/consts"
)

// 取自真实部署的签发结果：host 是仅集群内可解析的 MINIO_ENDPOINT。
const signedURL = "http://workflow-storage/opencoze/default_icon/workflow_icon/icon-llm.jpg" +
	"?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=ce3c76eb"

const signedQuery = "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=ce3c76eb"

func TestApply(t *testing.T) {
	cases := []struct {
		name string
		base string
		want string
	}{
		{
			name: "未配置时保持原样",
			base: "",
			want: signedURL,
		},
		{
			name: "仅空白字符时保持原样",
			base: "   ",
			want: signedURL,
		},
		{
			name: "根相对前缀（画布嵌入态：同源，无跨域与混合内容）",
			base: "/local_storage",
			want: "/local_storage/opencoze/default_icon/workflow_icon/icon-llm.jpg" + signedQuery,
		},
		{
			name: "根相对前缀带尾斜杠",
			base: "/local_storage/",
			want: "/local_storage/opencoze/default_icon/workflow_icon/icon-llm.jpg" + signedQuery,
		},
		{
			name: "根相对无前缀",
			base: "/",
			want: "/opencoze/default_icon/workflow_icon/icon-llm.jpg" + signedQuery,
		},
		{
			name: "绝对基址",
			base: "https://cdn.example.com",
			want: "https://cdn.example.com/opencoze/default_icon/workflow_icon/icon-llm.jpg" + signedQuery,
		},
		{
			name: "绝对基址带路径前缀",
			base: "https://example.com/local_storage/",
			want: "https://example.com/local_storage/opencoze/default_icon/workflow_icon/icon-llm.jpg" + signedQuery,
		},
		{
			name: "漏写 scheme 的基址不生效（不猜测，避免签发出错误地址）",
			base: "example.com:9000",
			want: signedURL,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv(consts.StorageClientURLBase, c.base)

			if got := Apply(signedURL); got != c.want {
				t.Fatalf("Apply() = %q, want %q", got, c.want)
			}
		})
	}
}

// 签名覆盖 path 与 query，改写必须逐字节保留它们（含转义）。
func TestApplyKeepsPathAndQueryEscaping(t *testing.T) {
	t.Setenv(consts.StorageClientURLBase, "/local_storage")

	signed := "http://workflow-storage/opencoze/a%20b%2Fc.jpg" +
		"?X-Amz-Credential=fenix%2F20261009%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=abc"
	want := "/local_storage/opencoze/a%20b%2Fc.jpg" +
		"?X-Amz-Credential=fenix%2F20261009%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=abc"

	if got := Apply(signed); got != want {
		t.Fatalf("Apply() = %q, want %q", got, want)
	}
}
