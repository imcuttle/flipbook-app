import { useEffect, useRef, useState } from 'react';
import styles from '../styles/ClickComposer.module.css';
import { Icon } from './Icon';
import { useLang, t } from '../lib/i18n';
import { selectionFromClipboard, selectionFromFileList, revokeSelection, type ImageSelection } from '../lib/imageUpload';

type Props = {
  // Click point in image-relative xy (0..1).
  xy: [number, number];
  // Where the popover should anchor in stage-relative xy. If your renderer
  // already converts image→stage for the bubble, pass that converted xy.
  stageXY: [number, number];
  onSubmit: (label: string, image: ImageSelection | null) => void;
  onCancel: () => void;
};

// Floating panel anchored at the click point. Captures an optional label
// override + an optional image attachment, then fires onSubmit. Enter to
// submit, Escape to cancel.
export function ClickComposer({ xy: _xy, stageXY, onSubmit, onCancel }: Props) {
  const [label, setLabel] = useState('');
  const [attachment, setAttachment] = useState<ImageSelection | null>(null);
  const [lang] = useLang();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Auto-focus on mount so paste-into-input works immediately.
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    // Revoke object URLs on cleanup.
    return () => { revokeSelection(attachment); };
  }, [attachment]);

  const submit = () => {
    onSubmit(label.trim(), attachment);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };

  // Paste-to-attach scoped to the input itself.
  const onInputPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const sel = selectionFromClipboard(e);
    if (sel) {
      e.preventDefault();
      // Replace any previous attachment + revoke its URL.
      revokeSelection(attachment);
      setAttachment(sel);
    }
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sel = selectionFromFileList(e.target.files);
    if (sel) {
      revokeSelection(attachment);
      setAttachment(sel);
    }
    e.target.value = '';
  };

  // Position the panel near the click. Clamp to keep it visible at edges.
  const left = Math.min(0.86, Math.max(0.04, stageXY[0]));
  const top = Math.min(0.78, Math.max(0.04, stageXY[1] + 0.04));

  return (
    <div
      className={styles.panel}
      style={{
        left: `${(left * 100).toFixed(2)}%`,
        top: `${(top * 100).toFixed(2)}%`,
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        className={styles.input}
        placeholder={t('composer.placeholder', lang)}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={onKey}
        onPaste={onInputPaste}
      />
      {attachment && (
        <span className={styles.thumbWrap}>
          <img src={attachment.previewUrl} alt="" className={styles.thumb} />
          <button
            type="button"
            className={styles.thumbRemove}
            aria-label={t('topbar.attach.remove', lang)}
            onClick={() => { revokeSelection(attachment); setAttachment(null); }}
          ><Icon name="close" size={10} strokeWidth={2.5} /></button>
        </span>
      )}
      <button
        type="button"
        className={styles.iconBtn}
        title={t('topbar.attach', lang)}
        aria-label={t('topbar.attach', lang)}
        onClick={() => fileRef.current?.click()}
      ><Icon name="attach" size={14} /></button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onFilePicked}
      />
      <button
        type="button"
        className={styles.submitBtn}
        title={t('composer.submit', lang)}
        aria-label={t('composer.submit', lang)}
        onClick={submit}
      ><Icon name="submit" size={14} /></button>
      <button
        type="button"
        className={styles.iconBtn}
        title={t('composer.cancel', lang)}
        aria-label={t('composer.cancel', lang)}
        onClick={onCancel}
      ><Icon name="close" size={14} /></button>
    </div>
  );
}
