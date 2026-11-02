package main

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/SheltonZhu/115driver/pkg/driver"
)

// Only fixed codes cross the process boundary; upstream bodies can contain secrets.
type remoteError struct{ code string }

func (e *remoteError) Error() string { return e.code }

func readRemote(c *driver.Pan115Client, method, endpoint string, page int64, result any) error {
	req := c.NewRequest().SetQueryParam("_", strconv.FormatInt(time.Now().UnixMilli(), 10))
	if page > 0 {
		req.SetQueryParam("page", strconv.FormatInt(page, 10))
	}
	resp, err := req.Execute(method, endpoint)
	if err != nil {
		return &remoteError{"REMOTE_NETWORK_FAILED"}
	}
	if resp.StatusCode() == 405 || resp.StatusCode() == 429 || resp.StatusCode() == 403 {
		return &remoteError{"REMOTE_BLOCKED"}
	}
	if resp.StatusCode() != 200 {
		return &remoteError{"REMOTE_HTTP_FAILED"}
	}
	var envelope struct {
		State    *bool            `json:"state"`
		Errno    driver.StringInt `json:"errno"`
		Errcode  driver.StringInt `json:"errcode"`
		Error    json.RawMessage  `json:"error"`
		ErrorMsg string           `json:"error_msg"`
		Message  string           `json:"msg"`
	}
	if json.Unmarshal(resp.Body(), &envelope) != nil || envelope.State == nil {
		return &remoteError{"REMOTE_RESPONSE_INVALID"}
	}
	if !*envelope.State {
		message := string(envelope.Error) + envelope.ErrorMsg + envelope.Message
		if envelope.Errno == 99 || envelope.Errno == 990001 || envelope.Errcode == 99 || strings.Contains(message, "登录") || strings.Contains(message, "login") {
			return &remoteError{"AUTH_REQUIRED"}
		}
		return &remoteError{"REMOTE_API_FAILED"}
	}
	if json.Unmarshal(resp.Body(), result) != nil {
		return &remoteError{"REMOTE_RESPONSE_INVALID"}
	}
	return nil
}

func listTasks(c *driver.Pan115Client, page int64) (driver.OfflineTaskResp, error) {
	return listTasksAt(c, page, "https://115.com/web/lixian/?ct=lixian&ac=task_lists", driver.ApiListOfflineUrl)
}

func listTasksAt(c *driver.Pan115Client, page int64, primary, fallback string) (driver.OfflineTaskResp, error) {
	var result driver.OfflineTaskResp
	err := readRemote(c, "GET", primary, page, &result)
	var safe *remoteError
	// A second read-only entry point is safe; never retry a remote submission here.
	if errors.As(err, &safe) && safe.code == "REMOTE_BLOCKED" {
		err = readRemote(c, "POST", fallback, page, &result)
	}
	return result, err
}
