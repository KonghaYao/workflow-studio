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

package service

import (
	"context"

	"github.com/coze-dev/coze-studio/backend/domain/workflow"
	"github.com/coze-dev/coze-studio/backend/domain/workflow/entity"
	"github.com/coze-dev/coze-studio/backend/domain/workflow/entity/vo"
	"github.com/coze-dev/coze-studio/backend/pkg/errorx"
	"github.com/coze-dev/coze-studio/backend/types/errno"
)

type historyQueryImpl struct {
	repo workflow.Repository
}

// ListRootExecutions returns the root executions of a workflow matching the filter.
// Sub workflow executions are excluded, see repo.ListRootExecutions.
func (i *historyQueryImpl) ListRootExecutions(ctx context.Context, filter *vo.ListExecutionFilter) (
	[]*entity.WorkflowExecution, error,
) {
	if filter == nil {
		return nil, vo.NewError(errno.ErrInvalidParameter, errorx.KV("msg", "list execution filter is required"))
	}

	if filter.WorkflowID <= 0 {
		return nil, vo.NewError(errno.ErrInvalidParameter, errorx.KV("msg", "workflow_id is required"))
	}

	return i.repo.ListRootExecutions(ctx, filter)
}
