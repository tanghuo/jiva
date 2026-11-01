export const maxWorkbenchAttachments = 8;
export const maxAttachmentBytes = 25 * 1024 * 1024;

export function attachmentKind({ name = '', type = '' } = {}) {
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg|avif|heic)$/i.test(name)) return 'image';
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  return 'text';
}

export function attachmentError(files, existing = 0) {
  if (existing + files.length > maxWorkbenchAttachments) return `附件最多 ${maxWorkbenchAttachments} 个`;
  for (const file of files) {
    const kind = attachmentKind(file);
    if (kind === 'image' && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name || '')) return '图片仅支持 PNG、JPEG、WebP';
    if (file.size > maxAttachmentBytes) return '每个附件必须在 25 MiB 以内';
  }
  return '';
}
