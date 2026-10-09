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

package workflow

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/coze-dev/coze-studio/backend/api/model/workflow"
	crossuser "github.com/coze-dev/coze-studio/backend/crossdomain/user"
	userentity "github.com/coze-dev/coze-studio/backend/domain/user/entity"
	"github.com/coze-dev/coze-studio/backend/domain/workflow/entity"
	"github.com/coze-dev/coze-studio/backend/domain/workflow/entity/vo"
	mockCrossUser "github.com/coze-dev/coze-studio/backend/internal/mock/crossdomain/crossuser"
	mockWorkflow "github.com/coze-dev/coze-studio/backend/internal/mock/domain/workflow"
	"github.com/coze-dev/coze-studio/backend/pkg/ctxcache"
	"github.com/coze-dev/coze-studio/backend/pkg/lang/ptr"
	"github.com/coze-dev/coze-studio/backend/types/consts"
)

const (
	listRootSpansTestWorkflowID = int64(1)
	listRootSpansTestSpaceID    = int64(123)
	// listRootSpansTestEndAt is a fixed end_at, so that the default time window can be asserted exactly.
	listRootSpansTestEndAt = int64(1700000000000)
)

func listRootSpansTestCtx() context.Context {
	ctx := ctxcache.Init(context.Background())
	ctxcache.Store(ctx, consts.SessionDataKeyInCtx, &userentity.Session{UserID: listRootSpansTestSpaceID})
	return ctx
}

// TestListRootSpansFilterDefaults asserts the execution filter that the application layer pushes
// down to the domain service. These values are not observable from the response body, so the
// domain service is mocked and the filter is captured instead.
func TestListRootSpansFilterDefaults(t *testing.T) {
	ctrl := gomock.NewController(t)
	mockDomainSVC := mockWorkflow.NewMockService(ctrl)
	mockUser := mockCrossUser.NewMockUser(ctrl)

	previousDomainSVC := SVC.DomainSVC
	previousUserSVC := crossuser.DefaultSVC()
	SVC.DomainSVC = mockDomainSVC
	crossuser.SetDefaultSVC(mockUser)
	defer func() {
		SVC.DomainSVC = previousDomainSVC
		crossuser.SetDefaultSVC(previousUserSVC)
	}()

	mockUser.EXPECT().GetUserSpaceList(gomock.Any(), listRootSpansTestSpaceID).
		Return([]*crossuser.EntitySpace{{ID: listRootSpansTestSpaceID}}, nil).AnyTimes()

	mockDomainSVC.EXPECT().Get(gomock.Any(), gomock.Any()).
		Return(&entity.Workflow{
			ID:   listRootSpansTestWorkflowID,
			Meta: &vo.Meta{Name: "list_spans_filter_wf", SpaceID: listRootSpansTestSpaceID},
		}, nil).AnyTimes()

	var got *vo.ListExecutionFilter
	mockDomainSVC.EXPECT().ListRootExecutions(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, filter *vo.ListExecutionFilter) ([]*entity.WorkflowExecution, error) {
			got = filter
			return nil, nil
		}).AnyTimes()

	list := func(t *testing.T, req *workflow.ListRootSpansRequest) *vo.ListExecutionFilter {
		t.Helper()
		got = nil
		req.WorkflowID = "1"
		req.EndAt = listRootSpansTestEndAt

		resp, err := SVC.ListRootSpans(listRootSpansTestCtx(), req)
		require.NoError(t, err)
		require.NotNil(t, resp)
		require.NotNil(t, got)

		return got
	}

	t.Run("limit defaults to 20 when it is not set or not positive", func(t *testing.T) {
		assert.Equal(t, int32(20), list(t, &workflow.ListRootSpansRequest{}).Limit)
		assert.Equal(t, int32(20), list(t, &workflow.ListRootSpansRequest{Limit: ptr.Of(int16(0))}).Limit)
	})

	t.Run("limit is clamped to 50 when it exceeds the maximum", func(t *testing.T) {
		assert.Equal(t, int32(50), list(t, &workflow.ListRootSpansRequest{Limit: ptr.Of(int16(51))}).Limit)
		// the maximum itself is kept
		assert.Equal(t, int32(50), list(t, &workflow.ListRootSpansRequest{Limit: ptr.Of(int16(50))}).Limit)
		// a positive limit below the maximum is kept
		assert.Equal(t, int32(7), list(t, &workflow.ListRootSpansRequest{Limit: ptr.Of(int16(7))}).Limit)
	})

	t.Run("start_at defaults to end_at - 7d", func(t *testing.T) {
		filter := list(t, &workflow.ListRootSpansRequest{})
		assert.Equal(t, listRootSpansTestEndAt, filter.EndAt)
		assert.Equal(t, listRootSpansTestEndAt-7*24*60*60*1000, filter.StartAt)
		assert.Equal(t, int64(1699395200000), filter.StartAt)

		// an explicit start_at is kept as is
		filter = list(t, &workflow.ListRootSpansRequest{StartAt: listRootSpansTestEndAt - 1000})
		assert.Equal(t, listRootSpansTestEndAt-1000, filter.StartAt)
	})

	t.Run("offset and order defaults", func(t *testing.T) {
		filter := list(t, &workflow.ListRootSpansRequest{Offset: ptr.Of(int32(-5))})
		assert.Equal(t, int32(0), filter.Offset)

		// desc_by_start_time is not set, so the default descending order applies
		assert.True(t, filter.DescByStartTime)

		filter = list(t, &workflow.ListRootSpansRequest{DescByStartTime: ptr.Of(false)})
		assert.False(t, filter.DescByStartTime)
	})
}
