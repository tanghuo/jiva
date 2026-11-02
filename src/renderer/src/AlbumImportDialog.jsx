import { useState } from "react";
import { Save } from "lucide-react";
import { DialogFrame } from "./ui/ConfirmDialog.jsx";
import { Button } from "./ui/Button.jsx";
import TagInput, { readTagInput } from "./TagInput.jsx";
import { albumImportQueue } from "./albumImportQueue.js";
import { elementTags } from "../../shared/domain/elements.js";

export default function AlbumImportDialog({ plan, spaceId, onClose }) {
  const [albums, setAlbums] = useState(() => plan.albums.map((album) => ({
    ...album,
    applyParentTag: Boolean(album.parentTag),
    extraTags: { tags: [], draft: "" },
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updateAlbum(key, patch) {
    setAlbums((current) => current.map((album) => album.key === key ? { ...album, ...patch } : album));
  }

  function submit(event) {
    event.preventDefault();
    if (busy || !albums.length) return;
    setError("");
    setBusy(true);
    try {
      const prepared = albums.map((album) => {
        const tags = [];
        if (album.applyParentTag && album.parentTag) tags.push(album.parentTag);
        tags.push(...readTagInput(album.extraTags));
        return { title: album.title.trim() || "图集", tags: elementTags(tags), dir: album.dir, files: album.files };
      });
      albumImportQueue.enqueue(prepared, spaceId);
      onClose();
    } catch (failure) {
      setError(failure.message || "导入失败");
    } finally {
      setBusy(false);
    }
  }

  return <DialogFrame bare title="导入图集" description="确认标题和标签后将在后台导入，可继续浏览。成员图不会出现在库列表里。"
    className="wiki-dialog wiki-album-import" closeLabel="关闭导入图集" busy={busy} onClose={() => !busy && onClose()} onSubmit={submit}
    footer={<>
      <button type="button" disabled={busy} onClick={onClose}>取消</button>
      <Button variant="primary" type="submit" disabled={busy || !albums.length}>
        <Save size={16} />{`导入 ${albums.length} 个图集`}
      </Button>
    </>}>
    <div className="wiki-form-fields">
      {(plan.skipped > 0 || plan.videos > 0) && <p className="wiki-muted">已跳过 {plan.skipped} 个文件{plan.videos ? `（含 ${plan.videos} 个视频）` : ""}。</p>}
      <ul className="wiki-album-import-list">
        {albums.map((album) => <li key={album.key}>
          <label>标题<input value={album.title} disabled={busy} onChange={(e) => updateAlbum(album.key, { title: e.target.value })} /></label>
          <p className="wiki-muted">{album.files.length} 张 · {album.dir || "（根目录）"}</p>
          {album.parentTag && <label className="wiki-material-filter">
            <input type="checkbox" checked={album.applyParentTag} disabled={busy}
              onChange={(e) => updateAlbum(album.key, { applyParentTag: e.target.checked })} />
            使用父文件夹名「{album.parentTag}」作为标签
          </label>}
          <TagInput label="更多标签" value={album.extraTags} disabled={busy}
            onChange={(extraTags) => updateAlbum(album.key, { extraTags })} />
        </li>)}
      </ul>
      {error && <p className="wiki-error" role="alert">{error}</p>}
    </div>
  </DialogFrame>;
}
