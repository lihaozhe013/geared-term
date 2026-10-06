import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { rankFuzzyItems } from '../fuzzy-search';
import type { Translate } from './sections';

type FontPickerProps = {
  value: string;
  fonts: string[];
  label: string;
  t: Translate;
  includeSystemDefault?: boolean;
  loading?: boolean;
  loadError?: boolean;
  onRetry?: () => void;
  onCommit: (font: string) => void;
};

export function FontPicker({
  value,
  fonts,
  label,
  t,
  includeSystemDefault = false,
  loading = false,
  loadError = false,
  onRetry,
  onCommit
}: FontPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => rankFuzzyItems(fonts, query, (font) => font), [fonts, query]);
  const showSystemDefault = includeSystemDefault && !query.trim();
  const exactMatch = fonts.some(
    (font) => font.toLocaleLowerCase() === query.trim().toLocaleLowerCase()
  );
  const showCustomName = query.trim().length > 0 && !exactMatch;
  const optionCount = matches.length + (showSystemDefault ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => setActiveIndex(0), [query]);

  const commit = (font: string): void => {
    onCommit(font);
    setOpen(false);
    setQuery('');
  };

  const displayValue = value || (includeSystemDefault ? t('systemDefaultFont') : '');

  return (
    <div className="font-picker" ref={rootRef}>
      <button
        type="button"
        className="settings-input font-picker-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{displayValue}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="font-picker-popover">
          <input
            ref={inputRef}
            className="settings-input font-picker-search"
            role="combobox"
            aria-label={t('searchFonts')}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listboxId}
            value={query}
            onChange={(event) => setQuery(event.target.value.slice(0, 256))}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
                setQuery('');
              } else if (event.key === 'ArrowDown' && optionCount > 0) {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % optionCount);
              } else if (event.key === 'ArrowUp' && optionCount > 0) {
                event.preventDefault();
                setActiveIndex((index) => (index - 1 + optionCount) % optionCount);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (optionCount > 0) {
                  const fontIndex = showSystemDefault ? activeIndex - 1 : activeIndex;
                  commit(
                    showSystemDefault && activeIndex === 0 ? '' : (matches[fontIndex] ?? value)
                  );
                } else if (showCustomName) {
                  commit(query.trim());
                }
              }
            }}
            placeholder={t('searchFonts')}
            spellCheck={false}
          />
          <div id={listboxId} className="font-picker-options" role="listbox">
            {showSystemDefault ? (
              <button
                type="button"
                role="option"
                aria-selected={!value}
                className={`font-picker-option ${activeIndex === 0 ? 'active' : ''}`}
                onMouseEnter={() => setActiveIndex(0)}
                onClick={() => commit('')}
              >
                {t('systemDefaultFont')}
              </button>
            ) : null}
            {matches.map((font, index) => {
              const optionIndex = index + (showSystemDefault ? 1 : 0);
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={font === value}
                  className={`font-picker-option ${activeIndex === optionIndex ? 'active' : ''}`}
                  key={font}
                  onMouseEnter={() => setActiveIndex(optionIndex)}
                  onClick={() => commit(font)}
                >
                  {font}
                </button>
              );
            })}
            {!loading && matches.length === 0 && !loadError ? (
              <p className="font-picker-message">{t('fontScanEmpty')}</p>
            ) : null}
            {loading ? <p className="font-picker-message">{t('fontScanLoading')}</p> : null}
            {loadError ? (
              <div className="font-picker-error">
                <p className="font-picker-message">{t('fontScanFailed')}</p>
                {onRetry ? (
                  <button type="button" className="toolbar-button" onClick={onRetry}>
                    {t('autoUnlockRetry')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {showCustomName ? (
            <button
              type="button"
              className="font-picker-custom"
              onClick={() => commit(query.trim())}
            >
              {t('useCustomFont').replace('{name}', query.trim())}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
