package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestBridgeHelper(t *testing.T) {
	if os.Getenv("JIVA_ZIP_TEST_HELPER") == "1" {
		main()
		os.Exit(0)
	}
}
func TestZipBoundaries(t *testing.T) {
	cases := []struct {
		name, entry, body string
		limit             int64
		link              bool
		want              string
	}{
		{"normal", "Album/a.txt", "ok", 20, false, "\"ok\":true"},
		{"traversal", "../escape.txt", "x", 20, false, "ZIP_PATH_INVALID"},
		{"backslash", "..\\escape.txt", "x", 20, false, "ZIP_PATH_INVALID"},
		{"absolute", "/escape.txt", "x", 20, false, "ZIP_PATH_INVALID"},
		{"drive", "C:/escape.txt", "x", 20, false, "ZIP_PATH_INVALID"},
		{"symlink", "link", "../x", 20, true, "ZIP_PATH_INVALID"},
		{"device", "NUL.txt", "x", 20, false, "ZIP_PATH_INVALID"},
		{"bytes", "large.txt", "too large", 2, false, "ZIP_BYTE_LIMIT"},
		{"nested", "nested.zip", "x", 20, false, "嵌套压缩包"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			archive := filepath.Join(dir, "input.zip")
			var contents bytes.Buffer
			writer := zip.NewWriter(&contents)
			header := &zip.FileHeader{Name: tc.entry, Method: zip.Deflate}
			if tc.link {
				header.SetMode(os.ModeSymlink | 0777)
			}
			file, e := writer.CreateHeader(header)
			if e != nil {
				t.Fatal(e)
			}
			file.Write([]byte(tc.body))
			writer.Close()
			os.WriteFile(archive, contents.Bytes(), 0600)
			request, _ := json.Marshal(input{Action: "extract", Root: filepath.Join(dir, "out"), Target: archive, Limit: tc.limit, MaxFiles: 10})
			cmd := exec.Command(os.Args[0], "-test.run=TestBridgeHelper")
			cmd.Env = append(os.Environ(), "JIVA_ZIP_TEST_HELPER=1")
			cmd.Stdin = bytes.NewReader(request)
			output, _ := cmd.CombinedOutput()
			if !strings.Contains(string(output), tc.want) {
				t.Fatalf("got %s, want %s", output, tc.want)
			}
			if _, e := os.Stat(filepath.Join(dir, "escape.txt")); !os.IsNotExist(e) {
				t.Fatal("archive escaped extraction root")
			}
		})
	}
}
