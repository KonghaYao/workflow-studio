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

package repo

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	workflowModel "github.com/coze-dev/coze-studio/backend/crossdomain/workflow/model"
	"github.com/coze-dev/coze-studio/backend/domain/workflow/entity"
	"github.com/coze-dev/coze-studio/backend/domain/workflow/entity/vo"
	"github.com/coze-dev/coze-studio/backend/domain/workflow/internal/repo/dal/query"
	"github.com/coze-dev/coze-studio/backend/pkg/lang/ptr"
)

const (
	listRootExecutionsColumns = "SELECT `workflow_execution`.`id`,`workflow_execution`.`workflow_id`," +
		"`workflow_execution`.`version`,`workflow_execution`.`space_id`,`workflow_execution`.`mode`," +
		"`workflow_execution`.`created_at`,`workflow_execution`.`log_id`,`workflow_execution`.`status`," +
		"`workflow_execution`.`duration`,`workflow_execution`.`error_code`,`workflow_execution`.`node_count`," +
		"`workflow_execution`.`parent_node_id` FROM `workflow_execution`"

	rootOnlyCondition = "(`workflow_execution`.`parent_node_id` = ? OR `workflow_execution`.`parent_node_id` IS NULL)"
)

type ExecuteHistoryListSuite struct {
	suite.Suite
	db    *gorm.DB
	mock  sqlmock.Sqlmock
	store *executeHistoryStoreImpl
}

func (s *ExecuteHistoryListSuite) SetupTest() {
	mockDB, mock, err := sqlmock.New()
	assert.NoError(s.T(), err)
	s.mock = mock

	dialector := mysql.New(mysql.Config{
		Conn:                      mockDB,
		SkipInitializeWithVersion: true,
	})
	s.db, err = gorm.Open(dialector, &gorm.Config{})
	assert.NoError(s.T(), err)

	s.store = &executeHistoryStoreImpl{
		query: query.Use(s.db),
	}
}

// TestListRootExecutions_AllFilters covers the combination of every filter: workflow id, time
// range, statuses, mode, input substring, descending order, limit and offset.
func (s *ExecuteHistoryListSuite) TestListRootExecutions_AllFilters() {
	ctx := context.Background()

	rows := sqlmock.NewRows([]string{
		"id", "workflow_id", "version", "space_id", "mode", "created_at", "log_id",
		"status", "duration", "error_code", "node_count", "parent_node_id",
	}).
		AddRow(1001, 123, "v1.0.0", 456, 2, 1700000000000, "log-1", 2, 1500, "", 7, "").
		AddRow(1000, 123, "", 456, 1, 1699999999000, "", 3, 20, "600003001", 5, "")

	s.mock.ExpectQuery(regexp.QuoteMeta(
		listRootExecutionsColumns+
			" WHERE `workflow_execution`.`workflow_id` = ? AND `workflow_execution`.`created_at` >= ?"+
			" AND `workflow_execution`.`created_at` <= ? AND "+rootOnlyCondition+
			" AND `workflow_execution`.`status` IN (?,?) AND `workflow_execution`.`mode` = ?"+
			" AND `workflow_execution`.`input` LIKE ?"+
			" ORDER BY `workflow_execution`.`created_at` DESC,`workflow_execution`.`id` DESC"+
			" LIMIT ? OFFSET ?")).
		WithArgs(int64(123), int64(1699999999000), int64(1700000000000), "", int32(2), int32(3), int32(2),
			`%a\%b\_c\\d%`, int32(20), int32(40)).
		WillReturnRows(rows)

	filter := &vo.ListExecutionFilter{
		WorkflowID:      123,
		StartAt:         1699999999000,
		EndAt:           1700000000000,
		Statuses:        []int32{int32(entity.WorkflowSuccess), int32(entity.WorkflowFailed)},
		Mode:            ptr.Of(int32(2)),
		Input:           `a%b_c\d`,
		Limit:           20,
		Offset:          40,
		DescByStartTime: true,
	}

	executions, err := s.store.ListRootExecutions(ctx, filter)
	assert.NoError(s.T(), err)
	assert.NoError(s.T(), s.mock.ExpectationsWereMet())
	assert.Len(s.T(), executions, 2)

	first := executions[0]
	assert.Equal(s.T(), int64(1001), first.ID)
	assert.Equal(s.T(), int64(123), first.WorkflowID)
	assert.Equal(s.T(), "v1.0.0", first.Version)
	assert.Equal(s.T(), int64(456), first.SpaceID)
	assert.Equal(s.T(), workflowModel.ExecuteModeRelease, first.Mode)
	assert.Equal(s.T(), int64(1700000000000), first.CreatedAt.UnixMilli())
	assert.Equal(s.T(), "log-1", first.LogID)
	assert.Equal(s.T(), entity.WorkflowSuccess, first.Status)
	assert.Equal(s.T(), int64(1500), first.Duration.Milliseconds())
	assert.Equal(s.T(), int32(7), first.NodeCount)
	assert.Equal(s.T(), "", ptr.FromOrDefault(first.ParentNodeID, "nil"))
	assert.Equal(s.T(), "", ptr.FromOrDefault(first.ErrorCode, ""))

	// input/output/fail_reason are not selected, the mapping must not expose them
	assert.Nil(s.T(), executions[0].Input)
	assert.Nil(s.T(), executions[0].Output)
	assert.Nil(s.T(), executions[0].FailReason)

	second := executions[1]
	assert.Equal(s.T(), int64(1000), second.ID)
	assert.Equal(s.T(), workflowModel.ExecuteModeDebug, second.Mode)
	assert.Equal(s.T(), entity.WorkflowFailed, second.Status)
	assert.Equal(s.T(), "600003001", ptr.FromOrDefault(second.ErrorCode, ""))
	assert.Equal(s.T(), int64(20), second.Duration.Milliseconds())
}

// TestListRootExecutions_RootOnlyAscending covers the default filter set: only root executions
// are returned and the result is ordered ascending when desc_by_start_time is false.
func (s *ExecuteHistoryListSuite) TestListRootExecutions_RootOnlyAscending() {
	ctx := context.Background()

	rows := sqlmock.NewRows([]string{
		"id", "workflow_id", "version", "space_id", "mode", "created_at", "log_id",
		"status", "duration", "error_code", "node_count", "parent_node_id",
	}).AddRow(2000, 123, "", 456, 3, 1700000000000, "log-2", 1, 0, "", 3, "")

	s.mock.ExpectQuery(regexp.QuoteMeta(
		listRootExecutionsColumns+
			" WHERE `workflow_execution`.`workflow_id` = ? AND `workflow_execution`.`created_at` >= ?"+
			" AND `workflow_execution`.`created_at` <= ? AND "+rootOnlyCondition+
			" ORDER BY `workflow_execution`.`created_at` ASC,`workflow_execution`.`id` ASC"+
			" LIMIT ?")).
		WithArgs(int64(123), int64(1699999999000), int64(1700000000000), "", int32(20)).
		WillReturnRows(rows)

	executions, err := s.store.ListRootExecutions(ctx, &vo.ListExecutionFilter{
		WorkflowID:      123,
		StartAt:         1699999999000,
		EndAt:           1700000000000,
		Limit:           20,
		DescByStartTime: false,
	})
	assert.NoError(s.T(), err)
	assert.NoError(s.T(), s.mock.ExpectationsWereMet())
	assert.Len(s.T(), executions, 1)
	assert.Equal(s.T(), workflowModel.ExecuteModeNodeDebug, executions[0].Mode)
	assert.Equal(s.T(), entity.WorkflowRunning, executions[0].Status)
}

// TestListRootExecutions_LimitOffset covers the page size boundary: the limit is passed to the
// database verbatim, the maximum page size + 1 (51) is not trimmed by the store, and only the
// executions selected by the database are returned.
func (s *ExecuteHistoryListSuite) TestListRootExecutions_LimitOffset() {
	ctx := context.Background()

	rows := sqlmock.NewRows([]string{
		"id", "workflow_id", "version", "space_id", "mode", "created_at", "log_id",
		"status", "duration", "error_code", "node_count", "parent_node_id",
	})
	for i := 0; i < 51; i++ {
		rows.AddRow(3000-i, 123, "", 456, 1, 1700000000000-int64(i), "log", 2, 1, "", 1, "")
	}

	s.mock.ExpectQuery(regexp.QuoteMeta(
		listRootExecutionsColumns+
			" WHERE `workflow_execution`.`workflow_id` = ? AND `workflow_execution`.`created_at` >= ?"+
			" AND `workflow_execution`.`created_at` <= ? AND "+rootOnlyCondition+
			" ORDER BY `workflow_execution`.`created_at` DESC,`workflow_execution`.`id` DESC"+
			" LIMIT ? OFFSET ?")).
		WithArgs(int64(123), int64(1699999999000), int64(1700000000000), "", int32(51), int32(50)).
		WillReturnRows(rows)

	executions, err := s.store.ListRootExecutions(ctx, &vo.ListExecutionFilter{
		WorkflowID:      123,
		StartAt:         1699999999000,
		EndAt:           1700000000000,
		Limit:           51,
		Offset:          50,
		DescByStartTime: true,
	})
	assert.NoError(s.T(), err)
	assert.NoError(s.T(), s.mock.ExpectationsWereMet())
	assert.Len(s.T(), executions, 51)
}

// TestListRootExecutions_Empty covers a workflow without any execution in the time range.
func (s *ExecuteHistoryListSuite) TestListRootExecutions_Empty() {
	ctx := context.Background()

	s.mock.ExpectQuery(regexp.QuoteMeta(
		listRootExecutionsColumns+
			" WHERE `workflow_execution`.`workflow_id` = ? AND `workflow_execution`.`created_at` >= ?"+
			" AND `workflow_execution`.`created_at` <= ? AND "+rootOnlyCondition+
			" ORDER BY `workflow_execution`.`created_at` DESC,`workflow_execution`.`id` DESC"+
			" LIMIT ?")).
		WithArgs(int64(123), int64(1), int64(2), "", int32(20)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "workflow_id", "version", "space_id", "mode", "created_at", "log_id",
			"status", "duration", "error_code", "node_count", "parent_node_id",
		}))

	executions, err := s.store.ListRootExecutions(ctx, &vo.ListExecutionFilter{
		WorkflowID:      123,
		StartAt:         1,
		EndAt:           2,
		Limit:           20,
		DescByStartTime: true,
	})
	assert.NoError(s.T(), err)
	assert.NoError(s.T(), s.mock.ExpectationsWereMet())
	assert.NotNil(s.T(), executions)
	assert.Empty(s.T(), executions)
}

// TestListRootExecutions_Error covers a failing query.
func (s *ExecuteHistoryListSuite) TestListRootExecutions_Error() {
	ctx := context.Background()

	s.mock.ExpectQuery("SELECT (.+) FROM `workflow_execution`").
		WillReturnError(errors.New("db is down"))

	executions, err := s.store.ListRootExecutions(ctx, &vo.ListExecutionFilter{
		WorkflowID:      123,
		Limit:           20,
		DescByStartTime: true,
	})
	assert.Error(s.T(), err)
	assert.Nil(s.T(), executions)
}

func (s *ExecuteHistoryListSuite) TestListRootExecutions_NilFilter() {
	executions, err := s.store.ListRootExecutions(context.Background(), nil)
	assert.Error(s.T(), err)
	assert.Nil(s.T(), executions)
}

func TestEscapeLikePattern(t *testing.T) {
	for _, tt := range []struct {
		input    string
		expected string
	}{
		{input: "plain text", expected: "plain text"},
		{input: "100%", expected: `100\%`},
		{input: "a_b", expected: `a\_b`},
		{input: `C:\path`, expected: `C:\\path`},
		{input: `%_\`, expected: `\%\_\\`},
	} {
		assert.Equal(t, tt.expected, escapeLikePattern(tt.input))
	}
}

func TestExecuteHistoryListStore(t *testing.T) {
	suite.Run(t, new(ExecuteHistoryListSuite))
}
