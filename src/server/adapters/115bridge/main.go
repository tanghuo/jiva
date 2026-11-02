// Credentials arrive exclusively on stdin. Never print upstream errors/headers.
package main

import (
	"archive/zip"
	"crypto/sha1"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/SheltonZhu/115driver/pkg/driver"
)

type input struct {
	Credential driver.Credential `json:"credential"`
	Action     string            `json:"action"`
	ID         string            `json:"id"`
	Magnet     string            `json:"magnet"`
	Root       string            `json:"root"`
	Target     string            `json:"target"`
	Limit      int64             `json:"limit"`
	MaxFiles   int               `json:"maxFiles"`
}

func fail(code string) { fmt.Printf("{\"ok\":false,\"code\":%q}\n", code); os.Exit(1) }
func remoteFail(err error, fallback string) {
	for _, auth := range []error{driver.ErrNotLogin, driver.ErrBadCookie, driver.ErrCredentialInvalid, driver.ErrSessionExited, driver.ErrDoesLoggedOut} {
		if errors.Is(err, auth) {
			fail("AUTH_REQUIRED")
		}
	}
	if errors.Is(err, driver.ErrOfflineNoTimes) {
		fail("QUOTA_EXHAUSTED")
	}
	if errors.Is(err, driver.ErrOfflineInvalidLink) {
		fail("REMOTE_LINK_INVALID")
	}
	fail(fallback)
}
func main() {
	var in input
	if json.NewDecoder(io.LimitReader(os.Stdin, 65536)).Decode(&in) != nil {
		fail("INPUT_INVALID")
	}
	if in.Action == "extract" {
		extract(in)
		return
	}
	if in.Credential.UID == "" || in.Credential.CID == "" || in.Credential.SEID == "" {
		fail("AUTH_REQUIRED")
	}
	c := driver.New(driver.UA(driver.UA115Browser)).ImportCredential(&in.Credential)
	c.Client.SetTimeout(30 * time.Second).SetRetryCount(0)
	user, err := c.GetUser()
	if err != nil {
		remoteFail(err, "IDENTITY_CHECK_FAILED")
	}
	var result any
	switch in.Action {
	case "identity":
		result = map[string]any{"authenticated": true, "accountId": user.UserID}
	case "tasks":
		tasks := []*driver.OfflineTask{}
		for page := int64(1); ; page++ {
			if page > 100 {
				fail("TASK_PAGE_LIMIT")
			}
			r, e := c.ListOfflineTask(page)
			if e != nil {
				fail("TASK_LIST_FAILED")
			}
			tasks = append(tasks, r.Tasks...)
			if page >= r.PageCount {
				break
			}
		}
		result = tasks
	case "submit":
		// Caller must journal submit intent and reconcile by info hash before retry.
		if len(in.Magnet) < 20 || len(in.Magnet) > 16000 || in.Magnet[:8] != "magnet:?" {
			fail("MAGNET_INVALID")
		}
		hashes, e := c.AddOfflineTaskURIs([]string{in.Magnet}, "0")
		if e != nil {
			remoteFail(e, "SUBMISSION_UNKNOWN_RECONCILE_FIRST")
		}
		result = hashes
	case "stat":
		f, e := c.GetFile(in.ID)
		if e != nil {
			fail("FILE_STAT_FAILED")
		}
		result = f
	case "list":
		files, e := c.List(in.ID, driver.WithApiURLs(driver.ApiFileList))
		if e != nil {
			fail("FILE_LIST_FAILED")
		}
		result = files
	case "download":
		f, e := c.GetFile(in.ID)
		if e != nil || f.IsDirectory {
			fail("FILE_STAT_FAILED")
		}
		limit := in.Limit
		if limit <= 0 || limit > 8*1024*1024*1024 {
			fail("LIMIT_INVALID")
		}
		if f.Size <= 0 || f.Size > limit {
			fail("DOWNLOAD_SIZE_LIMIT")
		}
		info, e := c.Download(f.PickCode)
		if e != nil {
			fail("DOWNLOAD_URL_FAILED")
		}
		req, e := http.NewRequest("GET", info.Url.Url, nil)
		if e != nil {
			fail("DOWNLOAD_URL_FAILED")
		}
		req.Header = info.Header.Clone()
		client := &http.Client{Timeout: 30 * time.Minute}
		resp, e := client.Do(req)
		if e != nil {
			fail("DOWNLOAD_FAILED")
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			fail("DOWNLOAD_HTTP_FAILED")
		}
		// The application supplies a verified task cache directory and an ID-based name.
		root := in.Root
		if root == "" {
			fail("CACHE_REQUIRED")
		}
		if os.MkdirAll(root, 0700) != nil {
			fail("CACHE_CREATE_FAILED")
		}
		out, e := os.CreateTemp(root, "download-*.part")
		if e != nil {
			fail("CACHE_CREATE_FAILED")
		}
		temp := out.Name()
		digest := sha1.New()
		n, copyErr := io.Copy(io.MultiWriter(out, digest), io.LimitReader(resp.Body, limit+1))
		closeErr := out.Close()
		if copyErr != nil || closeErr != nil || n != f.Size || n > limit {
			os.Remove(temp)
			fail("DOWNLOAD_INCOMPLETE")
		}
		if f.Sha1 != "" && !strings.EqualFold(fmt.Sprintf("%x", digest.Sum(nil)), f.Sha1) {
			os.Remove(temp)
			fail("DOWNLOAD_HASH_MISMATCH")
		}
		if filepath.Base(in.Target) != in.Target || in.Target == "" {
			os.Remove(temp)
			fail("TARGET_INVALID")
		}
		target := filepath.Join(root, in.Target)
		if os.Rename(temp, target) != nil {
			os.Remove(temp)
			fail("CACHE_PUBLISH_FAILED")
		}
		result = map[string]any{"fileId": f.FileID, "bytes": n, "cacheFile": filepath.Base(target)}
	default:
		fail("ACTION_INVALID")
	}
	if json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "data": result}) != nil {
		os.Exit(1)
	}
}

func extract(in input) {
	if in.Limit <= 0 || in.Limit > 8*1024*1024*1024 || in.MaxFiles < 1 || in.MaxFiles > 20000 {
		fail("LIMIT_INVALID")
	}
	r, e := zip.OpenReader(in.Target)
	if e != nil {
		fail("ZIP_INVALID")
	}
	defer r.Close()
	if len(r.File) > in.MaxFiles {
		fail("ZIP_FILE_LIMIT")
	}
	if os.MkdirAll(in.Root, 0700) != nil {
		fail("CACHE_CREATE_FAILED")
	}
	seen := map[string]bool{}
	skipped := []map[string]string{}
	total := int64(0)
	for _, f := range r.File {
		name := strings.ReplaceAll(f.Name, "\\", "/")
		if strings.HasPrefix(name, "/") || strings.Contains(name, ":") || strings.ContainsRune(name, 0) || f.Mode()&os.ModeSymlink != 0 {
			fail("ZIP_PATH_INVALID")
		}
		for _, part := range strings.Split(name, "/") {
			stem := strings.ToUpper(strings.Split(part, ".")[0])
			if part == ".." || strings.TrimRight(part, " .") != part || stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" || (len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && stem[3] >= '1' && stem[3] <= '9') {
				fail("ZIP_PATH_INVALID")
			}
		}
		clean := filepath.Clean(filepath.FromSlash(name))
		target := filepath.Join(in.Root, clean)
		rel, e := filepath.Rel(in.Root, target)
		if e != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
			fail("ZIP_PATH_INVALID")
		}
		if f.FileInfo().IsDir() {
			continue
		}
		lower := strings.ToLower(clean)
		if seen[lower] {
			fail("ZIP_DUPLICATE_PATH")
		}
		seen[lower] = true
		ext := strings.ToLower(filepath.Ext(clean))
		if f.Flags&1 != 0 || f.Method != zip.Store && f.Method != zip.Deflate || ext == ".zip" || ext == ".7z" || ext == ".rar" {
			skipped = append(skipped, map[string]string{"path": name, "reason": "加密、不支持或嵌套压缩包"})
			continue
		}
		if f.UncompressedSize64 > uint64(in.Limit-total) {
			fail("ZIP_BYTE_LIMIT")
		}
		if os.MkdirAll(filepath.Dir(target), 0700) != nil {
			fail("CACHE_CREATE_FAILED")
		}
		source, e := f.Open()
		if e != nil {
			fail("ZIP_ENTRY_INVALID")
		}
		out, e := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			source.Close()
			fail("ZIP_PATH_EXISTS")
		}
		n, copyErr := io.Copy(out, io.LimitReader(source, in.Limit-total+1))
		source.Close()
		closeErr := out.Close()
		total += n
		if copyErr != nil || closeErr != nil || total > in.Limit {
			fail("ZIP_ENTRY_INVALID_OR_LIMIT")
		}
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "data": map[string]any{"skipped": skipped, "bytes": total}})
}
