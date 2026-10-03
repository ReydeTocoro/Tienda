import { Search } from 'lucide-react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
}

/** Search box of the spreadsheet-style pages' toolbars (Stock, Clientes, Facturas). */
export function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  return (
    <div className="relative min-w-[200px] flex-1">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input className="input py-2 pl-9" aria-label="Buscar" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
