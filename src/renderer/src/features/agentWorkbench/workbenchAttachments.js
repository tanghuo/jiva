export { attachmentKind, attachmentError, maxWorkbenchAttachments } from '../../../../shared/domain/agentWorkbench/attachments.js';

export function transferFiles(transfer) {
  if (!transfer) return [];
  const files = Array.from(transfer.files || []);
  return files.length ? files : Array.from(transfer.items || []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
}

export function attachmentEvents(addFiles) {
  function receive(event, transfer) {
    const files = transferFiles(transfer);
    if (!files.length) return;
    event.preventDefault(); event.stopPropagation();
    void addFiles(files);
  }
  return {
    onPaste: event => receive(event, event.clipboardData),
    onDragOver(event) {
      if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy';
    },
    onDrop: event => receive(event, event.dataTransfer),
  };
}

export const attachmentHeaders = file => ({ 'content-type': file.type || 'application/octet-stream', 'x-attachment-name': encodeURIComponent(file.name || 'attachment') });
