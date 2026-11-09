import { useId, useState } from 'react';

function SuggestInput({ field, value, onChange }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const text = String(value || '').trim().toLocaleLowerCase();
  const matches = (field.suggestions || []).filter(item => !text || item.toLocaleLowerCase().includes(text)).slice(0, 50);
  const shown = open && matches.length > 0;
  return <div className="settlement-suggest">
    <input type="search" role="combobox" aria-expanded={shown} aria-controls={listId} aria-autocomplete="list" autoComplete="off" placeholder={field.placeholder} value={value}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={() => setOpen(false)}
      onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}
      onChange={event => { setOpen(true); onChange(event.target.value); }} />
    {shown && <ul id={listId} role="listbox" className="settlement-suggest-list">{matches.map(item => <li key={item} role="option" aria-selected={item === value}
      onMouseDown={event => { event.preventDefault(); onChange(item); setOpen(false); }}>{item}</li>)}</ul>}
  </div>;
}

export default function SearchFilters({ label, fields, value, onChange, onReset }) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  return <div className="settlement-search" role="search" aria-label={label}>
    {fields.map(field => <label key={field.key}>{field.label}{field.options
      ? <select value={value[field.key]} onChange={event => set(field.key, event.target.value)}>{field.options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>
      : field.suggestions
        ? <SuggestInput field={field} value={value[field.key]} onChange={next => set(field.key, next)} />
        : <input type="search" placeholder={field.placeholder} value={value[field.key]} onChange={event => set(field.key, event.target.value)} />}</label>)}
    <button type="button" className="settlement-tool" onClick={onReset}>검색 초기화</button>
  </div>;
}
