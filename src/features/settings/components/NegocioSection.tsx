import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, updateSettings } from '../../../db/repositories/settings'
import { businessLines, DEFAULT_RECEIPT_FOOTER, receiptFooter } from '../../../shared/lib/business'
import { formatMoney } from '../../../shared/lib/currency'
import type { Settings } from '../../../types/settings'
import { toast } from '../../../store/useToastStore'
import { Card, Row, SectionHeader, primaryButton, secondaryButton } from './ui'
import logo from '../../../assets/logo.png'

interface Form {
  storeName: string
  nit: string
  phone: string
  address: string
  receiptFooter: string
}

const fromSettings = (s: Settings): Form => ({
  storeName: s.storeName ?? '',
  nit: s.business?.nit ?? '',
  phone: s.business?.phone ?? '',
  address: s.business?.address ?? '',
  receiptFooter: s.business?.receiptFooter ?? '',
})

const FIELDS: Array<{ key: keyof Form; label: string; hint: string; placeholder: string; max: number; inputMode?: 'tel' }> = [
  { key: 'storeName', label: 'Nombre de la tienda', hint: 'Sale en los recibos, el Reporte X y los archivos que exportas. En la barra de arriba se ve el logo.', placeholder: 'Mi tienda', max: 60 },
  { key: 'nit', label: 'NIT o cédula', hint: 'Opcional. Sale debajo del nombre en el recibo.', placeholder: '900.123.456-7', max: 30 },
  { key: 'phone', label: 'Teléfono', hint: 'Opcional. Para que los clientes te encuentren.', placeholder: '321 000 0000', max: 30, inputMode: 'tel' },
  { key: 'address', label: 'Dirección', hint: 'Opcional.', placeholder: 'Calle 10 # 5-20, Centro', max: 80 },
  { key: 'receiptFooter', label: 'Mensaje al final del recibo', hint: 'Lo que lee el cliente al final del recibo.', placeholder: DEFAULT_RECEIPT_FOOTER, max: 80 },
]

/** Store name and the details printed on every receipt, with a live preview of the slip. */
export function NegocioSection() {
  const settings = useLiveQuery(() => getSettings())
  return settings ? <NegocioForm settings={settings} /> : null
}

/** Starts from the settings as they were when the section opened; "Descartar" goes back to the saved ones. */
function NegocioForm({ settings }: { settings: Settings }) {
  const [form, setForm] = useState<Form>(() => fromSettings(settings))
  const [busy, setBusy] = useState(false)
  const saved = fromSettings(settings)
  const dirty = (Object.keys(form) as Array<keyof Form>).some((k) => form[k].trim() !== saved[k].trim())

  async function save() {
    const storeName = form.storeName.trim()
    if (!storeName) {
      toast('Escribe el nombre de la tienda', 'orange')
      return
    }
    setBusy(true)
    try {
      await updateSettings({
        storeName,
        business: { nit: form.nit.trim(), phone: form.phone.trim(), address: form.address.trim(), receiptFooter: form.receiptFooter.trim() },
      })
      setForm({ storeName, nit: form.nit.trim(), phone: form.phone.trim(), address: form.address.trim(), receiptFooter: form.receiptFooter.trim() })
      toast('Datos del negocio guardados', 'green')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    } finally {
      setBusy(false)
    }
  }

  const business = { nit: form.nit, phone: form.phone, address: form.address, receiptFooter: form.receiptFooter }

  return (
    <>
      <SectionHeader title="Negocio" description="Cómo se llama tu tienda y qué datos salen en los recibos que entregas." />
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start xl:gap-4">
        <Card
          title="Datos del negocio"
          footer={
            <>
              {dirty && <span className="mr-auto text-[12px] text-muted">Cambios sin guardar</span>}
              <button type="button" className={secondaryButton} disabled={!dirty || busy} onClick={() => setForm(saved)}>
                Descartar
              </button>
              <button type="button" className={primaryButton} disabled={!dirty || busy} onClick={save}>
                {busy ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </>
          }
        >
          {FIELDS.map((f) => (
            <Row key={f.key} label={f.label} hint={f.hint} htmlFor={`biz-${f.key}`}>
              <input
                id={`biz-${f.key}`}
                className="input w-full sm:w-72"
                value={form[f.key]}
                maxLength={f.max}
                inputMode={f.inputMode}
                placeholder={f.placeholder}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && dirty && save()}
              />
            </Row>
          ))}
        </Card>

        <div className="mb-4 rounded-2xl border border-br bg-s2 p-4">
          <p className="mb-3 field-label">Así se ve en el recibo</p>
          <div className="mx-auto max-w-[240px] rounded-md border border-dashed border-br2 bg-s1 px-4 py-3 text-center font-mono text-[11px] leading-[1.7] text-txt shadow-xs">
            <img src={logo} alt="" className="mx-auto mb-1 h-9 w-auto object-contain" />
            <div className="text-[12px] font-bold">{form.storeName.trim() || 'Mi tienda'}</div>
            {businessLines(business).map((l) => (
              <div key={l} className="text-muted">
                {l}
              </div>
            ))}
            <div className="my-1.5 border-t border-dashed border-br2" />
            <div className="flex justify-between">
              <span>Producto ×2</span>
              <span>{formatMoney(9000)}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>TOTAL</span>
              <span>{formatMoney(9000)}</span>
            </div>
            <div className="my-1.5 border-t border-dashed border-br2" />
            <div>{receiptFooter(business)}</div>
          </div>
        </div>
      </div>
    </>
  )
}
