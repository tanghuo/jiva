import { request } from "./api.js";

// The queue belongs to the application, independently of dialogs and navigation.
export function createAlbumImportQueue(send = request) {
  let jobs = [], nextId = 1, running = false;
  let snapshot = { jobs: [], revision: 0 };
  const listeners = new Set();
  function publish(changed = false) {
    snapshot = { jobs: jobs.map(({ albums, ...job }) => ({ ...job })), revision: snapshot.revision + Number(changed) };
    listeners.forEach((listener) => listener());
  }
  async function run() {
    if (running) return;
    running = true;
    try {
      let job;
      while ((job = jobs.find((entry) => entry.status === "queued"))) {
        job.status = "running"; publish();
        try {
          while (job.albumIndex < job.albums.length) {
            const album = job.albums[job.albumIndex];
            job.title = album.title; publish();
            // Both query and header are pinned: request() otherwise uses the current space.
            const scope = `?spaceId=${encodeURIComponent(job.spaceId)}`;
            const headers = { "x-jiva-space-id": String(job.spaceId) };
            if (!job.albumId) {
              const shell = await send(`/api/albums${scope}`, {
                method: "POST", headers,
                body: JSON.stringify({ title: album.title, tags: album.tags, createdFromPath: album.dir || "", spaceId: job.spaceId }),
              });
              job.albumId = shell.id;
            }
            while (job.fileIndex < album.files.length) {
              const item = album.files[job.fileIndex];
              await send(`/api/images${scope}`, {
                method: "POST",
                headers: { ...headers, "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(item.fileName || item.file.name), "x-album-id": String(job.albumId), "x-image-tags": "" },
                body: item.file,
              });
              // Release uploaded blobs; a retry retains only the unfinished files.
              album.files[job.fileIndex] = null;
              job.fileIndex++; job.completed++; publish();
            }
            job.albumIndex++; job.fileIndex = 0; job.albumId = null; publish(true);
          }
          job.status = "done"; job.albums = []; publish();
        } catch (failure) {
          job.status = "failed"; job.error = failure.message || "导入失败"; publish(true);
        }
      }
    } finally { running = false; }
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    enqueue(albums, spaceId) {
      if (!spaceId) throw new Error("空间尚未就绪，请稍后再导入");
      const id = nextId++;
      jobs.push({ id, albums: albums.map((album) => ({ ...album, files: [...album.files] })), spaceId, title: albums[0]?.title,
        albumIndex: 0, albumId: null, fileIndex: 0, completed: 0, total: albums.reduce((sum, album) => sum + album.files.length, 0), status: "queued", error: "" });
      publish(); void run(); return id;
    },
    retry(id) {
      const job = jobs.find((entry) => entry.id === id);
      if (job?.status !== "failed") return;
      job.status = "queued"; job.error = ""; publish(); void run();
    },
    dismiss(id) {
      jobs = jobs.filter((job) => job.id !== id || ["running", "queued"].includes(job.status)); publish();
    },
  };
}

export const albumImportQueue = createAlbumImportQueue();
