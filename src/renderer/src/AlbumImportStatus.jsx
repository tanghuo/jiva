import { useEffect, useSyncExternalStore } from "react";
import { albumImportQueue } from "./albumImportQueue.js";

export default function AlbumImportStatus({ onChanged }) {
  const { jobs, revision } = useSyncExternalStore(albumImportQueue.subscribe, albumImportQueue.getSnapshot);
  const pending = jobs.some((job) => job.status !== "done");
  useEffect(() => { if (revision) onChanged(); }, [revision, onChanged]);
  useEffect(() => {
    if (!pending) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);
  if (!jobs.length) return null;
  return <aside className="wiki-album-import-status" aria-label="图集后台导入">
    <strong>图集导入</strong>
    {jobs.map((job) => <div key={job.id}>
      <p className="wiki-album-import-title" title={job.title}>{job.title}</p>
      <p role="status">{job.status === "done" ? "导入完成" : job.status === "failed" ? "导入暂停" : job.status === "queued" ? "等待导入" : "后台导入中"} · {job.completed}/{job.total} 张</p>
      <progress aria-label={`${job.title}导入进度`} max={job.total || 1} value={job.completed} />
      {job.status === "failed" && <><p className="wiki-error" role="alert">{job.error}。已导入的图片已保留。</p><button onClick={() => albumImportQueue.retry(job.id)}>继续导入</button></>}
      {["done", "failed"].includes(job.status) && <button className="text-button" onClick={() => albumImportQueue.dismiss(job.id)}>{job.status === "done" ? "收起" : "结束任务"}</button>}
    </div>)}
    {pending && <small>可以继续使用其他功能，请保持应用打开。</small>}
  </aside>;
}
