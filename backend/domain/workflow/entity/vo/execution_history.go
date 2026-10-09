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

package vo

// ListExecutionFilter filters the root executions of a workflow for the run history list API.
// StartAt and EndAt are in milliseconds and bound workflow_execution.created_at inclusively.
type ListExecutionFilter struct {
	// WorkflowID is the workflow whose root executions are queried.
	WorkflowID int64
	// StartAt and EndAt are the inclusive bounds of the execution created time, in milliseconds.
	StartAt int64
	EndAt   int64
	// Statuses are raw workflow_execution.status values, e.g. 1=running 2=success 3=fail.
	// No status filter is applied when it is empty.
	Statuses []int32
	// Mode is the raw workflow_execution.mode value: 1=debug run 2=release run 3=node debug.
	// No mode filter is applied when it is nil.
	Mode *int32
	// Input, when not empty, matches the recorded input as a substring.
	Input string
	// Limit is the max number of executions to return.
	Limit int32
	// Offset is the number of executions to skip.
	Offset int32
	// DescByStartTime orders the result by created time descending when true, ascending when false.
	// The execution id is always used as the tie breaker, so that executions created in the same
	// millisecond keep a stable order.
	DescByStartTime bool
}
