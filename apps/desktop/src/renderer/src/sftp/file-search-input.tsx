import { Search } from 'lucide-react';

type FileSearchInputProps = {
  label: string;
  query: string;
  onQueryChange: (query: string) => void;
};

export function FileSearchInput({
  label,
  query,
  onQueryChange
}: FileSearchInputProps): React.JSX.Element {
  return (
    <label className="sftp-search">
      <Search size={14} aria-hidden="true" />
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onQueryChange('');
          }
        }}
        placeholder={label}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}
