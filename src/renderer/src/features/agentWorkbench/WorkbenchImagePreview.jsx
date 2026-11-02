import { useEffect, useRef, useState } from 'react';
import { DialogFrame } from '../../ui/ConfirmDialog.jsx';

function fittedSize(image) {
  const tight = window.innerWidth <= 600 || window.innerHeight <= 640;
  const margin = tight ? 24 : 64;
  const maxWidth = Math.max(1, Math.min(1200, window.innerWidth - margin));
  const maxHeight = Math.max(1, window.innerHeight - margin);
  const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
  return { width: Math.max(1, Math.round(image.naturalWidth * scale)), height: Math.max(1, Math.round(image.naturalHeight * scale)) };
}

export default function WorkbenchImagePreview({ title, closeLabel, src, alt, onClose }) {
  const image = useRef(null);
  const [size, setSize] = useState(null);
  function fit() { if (image.current?.naturalWidth) setSize(fittedSize(image.current)); }
  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return <DialogFrame bare title={title} closeLabel={closeLabel} onClose={onClose} className="workbench-reference-dialog">
    <div className="workbench-reference-stage"><img ref={image} src={src} alt={alt} style={size || undefined} onLoad={fit} /></div>
  </DialogFrame>;
}
