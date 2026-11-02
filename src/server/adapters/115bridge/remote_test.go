package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/SheltonZhu/115driver/pkg/driver"
)

func TestTaskEntryFallback(t *testing.T) {
	var primary, fallback int
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("page") != "3" || r.URL.Query().Get("_") == "" {
			t.Error("missing page or cache buster")
		}
		if r.URL.Path == "/primary" {
			primary++
			if r.Method != "GET" {
				t.Error("primary must use GET")
			}
			w.WriteHeader(405)
			w.Write([]byte("<html>gateway denied, sensitive upstream content</html>"))
			return
		}
		fallback++
		if r.Method != "POST" {
			t.Error("fallback must use POST")
		}
		w.Write([]byte(`{"state":true,"page":3,"page_count":4,"tasks":[{"info_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":2,"file_id":"123"}]}`))
	}))
	defer s.Close()
	r, err := listTasksAt(driver.New(), 3, s.URL+"/primary", s.URL+"/fallback")
	if err != nil || primary != 1 || fallback != 1 || r.PageCount != 4 || len(r.Tasks) != 1 || r.Tasks[0].FileId != "123" {
		t.Fatalf("fallback failed: %v, %d/%d", err, primary, fallback)
	}
}

func TestRemoteFailuresStayDistinctAndPrivate(t *testing.T) {
	for _, tc := range []struct {
		name       string
		status     int
		body, code string
		fallback   int
	}{
		{"both blocked", 405, `<html>secret-cookie</html>`, "REMOTE_BLOCKED", 1},
		{"rate limited", 429, `<html>secret-cookie</html>`, "REMOTE_BLOCKED", 1},
		{"login message without errno", 200, `{"state":false,"error":"请先登录,后操作！"}`, "AUTH_REQUIRED", 0},
		{"login code", 200, `{"state":false,"errno":"99"}`, "AUTH_REQUIRED", 0},
		{"invalid html", 200, `<html>secret-cookie</html>`, "REMOTE_RESPONSE_INVALID", 0},
		{"missing state", 200, `{"tasks":[]}`, "REMOTE_RESPONSE_INVALID", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fallback := 0
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/fallback" {
					fallback++
				}
				w.WriteHeader(tc.status)
				w.Write([]byte(tc.body))
			}))
			defer s.Close()
			_, err := listTasksAt(driver.New(), 1, s.URL+"/primary", s.URL+"/fallback")
			var safe *remoteError
			if !errors.As(err, &safe) || safe.code != tc.code || err.Error() != tc.code || fallback != tc.fallback {
				t.Fatalf("unexpected safe failure: %v; fallback=%d", err, fallback)
			}
		})
	}
}
