import { useEffect, useState } from 'react';
import { DialogFrame } from '../../ui/ConfirmDialog.jsx';

const previewLimit = 1024 * 1024;

export default function WorkbenchFilePreview({ file, onClose }) {
  const [body, setBody] = useState(file.pdf ? null : { status: 'loading' });
  useEffect(() => {
    if (file.pdf) return undefined;
    const controller = new AbortController();
    setBody({ status: 'loading' });
    fetch(file.href, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('附件读取失败');
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > previewLimit) {
        setBody({ status: 'large' });
        return;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > previewLimit || bytes.includes(0)) {
        setBody({ status: bytes.byteLength > previewLimit ? 'large' : 'binary' });
        return;
      }
      setBody({ status: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) });
    }).catch(error => {
      if (error.name === 'AbortError') return;
      setBody({ status: 'error' });
    });
    return () => controller.abort();
  }, [file]);
  return <DialogFrame title={file.filename} label="附件预览" closeLabel="关闭附件预览" onClose={onClose} className="workbench-file-preview-dialog" size="wide" footer={<a className="button text-button" href={file.href} download={file.filename}>下载</a>}>
    {file.pdf ? <iframe className="workbench-file-preview-frame" title={file.filename} src={file.href} /> : body?.status === 'loading' ? <p>正在读取附件…</p> : body?.status === 'text' ? <pre className="workbench-file-preview" aria-label="附件内容">{body.text}</pre> : body?.status === 'large' ? <p>这个附件太大，不在对话里展开。</p> : body?.status === 'binary' ? <p>这个附件不是文本，不在对话里展开。</p> : <p role="alert">附件读取失败</p>}
  </DialogFrame>;
}
