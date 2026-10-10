/** Self-check for the cart store when several sales are open at once: each cart keeps its own
 * lines, customer and tender while another is on screen; closing picks the right neighbour; and
 * closing BY ID — what checkout does once the sale is saved — never touches the cart the cashier
 * switched to meanwhile. It also covers a product's up to three selling prices: picking another on a
 * cart line, and Precio 2 / 3 in the files that are imported and exported; and which columns of the
 * stock table fit a screen. It lives here because
 * this folder is where tsx and the node types are set up (like selfcheck.ts, it imports from
 * ../src):  npm run check:cart */
import assert from 'node:assert/strict'
import { MAX_CART_NAME, nextCartName, selectActiveCart, useCartStore } from '../src/store/useCartStore'
import { countItems } from '../src/features/pos/lib/cartCount'
import { priceOptions, samePrice, sellingPrices } from '../src/shared/lib/prices'
import { fitColumns } from '../src/shared/lib/fitColumns'
import { buildParsedRows, parseImportFile } from '../src/features/inventory/lib/importProducts'
import { importTemplateCsv, stockCsv } from '../src/features/inventory/lib/productFiles'
import type { Product } from '../src/types/product'

const store = () => useCartStore.getState()
const active = () => selectActiveCart(store())
const names = () => store().carts.map((c) => c.name)
const idOf = (name: string) => store().carts.find((c) => c.name === name)!.id
let n = 0
const ok = (label: string) => console.log(`  ok ${++n} — ${label}`)

/** Closing the only cart leaves a fresh empty one: the way back to a clean "Carrito 1". */
function reset() {
  while (store().carts.length > 1) store().closeCart(store().carts[0].id)
  store().closeCart(store().carts[0].id)
}

/** Looks at the whole store after every step: there is always a cart, and the active one exists. */
function invariant() {
  const { carts, activeId } = store()
  assert.ok(carts.length >= 1, 'siempre hay al menos un carrito')
  assert.ok(carts.some((c) => c.id === activeId), 'el carrito activo existe')
  assert.equal(new Set(carts.map((c) => c.id)).size, carts.length, 'los ids no se repiten')
}

const unit = (code: string, name: string, price: number) => ({ code, name, price, brand: '', unit: 'unidad', stock: 10 })
const milk = unit('L1', 'Leche', 3000)
const rice = unit('A1', 'Arroz', 2500)
const kg = (code: string, qty: number) => ({ code, name: code, price: 4000, qty, brand: '', unit: 'kg', isFree: false })

// --- arranca con un carrito
assert.deepEqual(names(), ['Carrito 1'])
assert.equal(active().items.length, 0)
ok('arranca con un solo carrito vacío, "Carrito 1"')

// --- cada carrito conserva lo suyo al cambiar de uno a otro
store().addUnitItem(milk, 2)
store().setCustomer('c-ana', 'Ana')
store().setManualDiscountPct(10)
const firstId = active().id
store().openCart()
invariant()
assert.deepEqual(names(), ['Carrito 1', 'Carrito 2'])
assert.equal(active().name, 'Carrito 2', 'el nuevo queda en pantalla')
assert.equal(active().items.length, 0)
assert.equal(active().customerId, null)
assert.equal(active().manualDiscountPct, 0)
assert.equal(active().payMethod, 'efectivo')
store().addUnitItem(rice, 1)
store().setPayMethod('fiado')
store().setFiadoName('Don Pepe')
store().setChargeOverride(2000)
store().setAmountReceived(5000)
store().setNotes('sin bolsa')
const secondId = active().id
store().selectCart(firstId)
assert.deepEqual(active().items.map((i) => [i.code, i.qty]), [['L1', 2]])
assert.equal(active().customerName, 'Ana')
assert.equal(active().manualDiscountPct, 10)
assert.equal(active().payMethod, 'efectivo')
assert.equal(active().chargeOverride, null)
assert.equal(active().amountReceived, 0)
assert.equal(active().notes, '')
store().selectCart(secondId)
assert.deepEqual(active().items.map((i) => [i.code, i.qty]), [['A1', 1]])
assert.equal(active().customerId, null)
assert.equal(active().payMethod, 'fiado')
assert.equal(active().fiadoName, 'Don Pepe')
assert.equal(active().chargeOverride, 2000)
assert.equal(active().amountReceived, 5000)
assert.equal(active().notes, 'sin bolsa')
ok('lo que se agrega a un carrito (productos, cliente, descuento, cobro) no se pierde ni se mezcla al cambiar de carrito')

// --- las líneas por peso y las cantidades también son por carrito
reset()
store().addWeightedItem(kg('Q1', 1.5), 10)
store().openCart()
store().addWeightedItem(kg('Q1', 2), 10)
assert.equal(active().items[0].qty, 2)
store().addUnitItem(milk, 3)
store().changeQty(1, -1)
store().selectCart(store().carts[0].id)
assert.deepEqual(active().items.map((i) => [i.code, i.qty]), [['Q1', 1.5]])
store().selectCart(store().carts[1].id)
assert.deepEqual(active().items.map((i) => [i.code, i.qty]), [['Q1', 2], ['L1', 2]])
store().removeItem(0)
assert.deepEqual(active().items.map((i) => i.code), ['L1'])
assert.equal(store().carts[0].items.length, 1, 'quitar una línea de un carrito no toca el otro')
ok('agregar, cambiar cantidad y quitar líneas solo afecta al carrito en pantalla')

// --- nombres
reset()
const only = active().id
store().renameCart(only, '  Doña Marta  ')
assert.deepEqual(names(), ['Doña Marta'])
store().renameCart(only, '   ')
assert.deepEqual(names(), ['Doña Marta'], 'un nombre en blanco se ignora')
store().renameCart(only, 'x'.repeat(MAX_CART_NAME + 15))
assert.equal(names()[0].length, MAX_CART_NAME)
store().renameCart('no-existe', 'Fantasma')
assert.deepEqual(names(), ['x'.repeat(MAX_CART_NAME)])
ok('cambiar el nombre recorta espacios y largo, ignora el vacío y los ids que no existen')

// --- el nombre por defecto reutiliza el número libre más bajo
reset()
store().openCart()
store().openCart()
assert.deepEqual(names(), ['Carrito 1', 'Carrito 2', 'Carrito 3'])
store().closeCart(idOf('Carrito 2'))
store().openCart()
assert.deepEqual(names(), ['Carrito 1', 'Carrito 3', 'Carrito 2'], 'vuelve el 2 en vez de seguir contando')
store().renameCart(idOf('Carrito 1'), 'Mesa')
assert.equal(nextCartName(store().carts), 'Carrito 1')
ok('al cerrar "Carrito 2" y abrir otro vuelve a llamarse "Carrito 2"; un carrito renombrado libera su número')

// --- al cerrar el carrito en pantalla se pasa al que ocupa su lugar
reset()
store().renameCart(active().id, 'A')
store().openCart()
store().renameCart(active().id, 'B')
store().openCart()
store().renameCart(active().id, 'C')
store().selectCart(idOf('B'))
store().closeCart(idOf('B'))
invariant()
assert.deepEqual(names(), ['A', 'C'])
assert.equal(active().name, 'C', 'el siguiente en la fila')
store().closeCart(idOf('C'))
assert.deepEqual(names(), ['A'])
assert.equal(active().name, 'A', 'si era el último, el anterior')
ok('cerrar el carrito en pantalla pasa al siguiente (o al anterior si era el último)')

// --- cerrar por id un carrito que NO está en pantalla (lo que hace el cobro) no mueve nada
reset()
store().renameCart(active().id, 'A')
store().addUnitItem(milk, 1)
store().openCart()
store().renameCart(active().id, 'B')
store().openCart()
store().renameCart(active().id, 'C')
store().addUnitItem(rice, 4)
const charged = idOf('A') // se estaba cobrando A, y mientras tanto la cajera pasó a C
store().selectCart(idOf('C'))
store().closeCart(charged)
invariant()
assert.deepEqual(names(), ['B', 'C'])
assert.equal(active().name, 'C', 'C sigue en pantalla')
assert.deepEqual(active().items.map((i) => [i.code, i.qty]), [['A1', 4]], 'y con sus productos intactos')
store().closeCart(charged)
assert.deepEqual(names(), ['B', 'C'], 'cerrar dos veces el mismo id no hace nada más')
ok('cerrar por id el carrito cobrado no toca el carrito al que se cambió mientras se cobraba')

// --- cerrar el único carrito deja uno nuevo y vacío
reset()
store().renameCart(active().id, 'Marta')
store().addUnitItem(milk, 2)
store().setCustomer('c-marta', 'Marta')
const before = active().id
store().closeCart(before)
invariant()
assert.deepEqual(names(), ['Carrito 1'], 'el nombre de la venta anterior no se hereda')
assert.equal(active().items.length, 0)
assert.equal(active().customerId, null)
assert.notEqual(active().id, before)
ok('cerrar el único carrito deja uno nuevo, vacío y sin el nombre ni el cliente anteriores')

// --- vaciar conserva la pestaña y su nombre
reset()
store().renameCart(active().id, 'A')
store().addUnitItem(milk, 1)
store().openCart()
store().renameCart(active().id, 'B')
store().addUnitItem(rice, 1)
store().setCustomer('c-ana', 'Ana')
store().setAmountReceived(9000)
store().clear()
assert.deepEqual(names(), ['A', 'B'])
assert.equal(active().name, 'B')
assert.equal(active().items.length, 0)
assert.equal(active().customerId, null)
assert.equal(active().amountReceived, 0)
assert.equal(store().carts[0].items.length, 1, 'el otro carrito sigue igual')
ok('"Vaciar carrito" deja el carrito en pantalla en blanco pero conserva su pestaña, su nombre y los demás carritos')

// --- ids desconocidos no cambian nada
const snapshot = store().carts
store().selectCart('no-existe')
store().closeCart('no-existe')
assert.equal(store().carts, snapshot)
assert.equal(active().name, 'B')
ok('seleccionar o cerrar un id que no existe no cambia nada')

// --- el contador de ítems cuenta una línea por peso como una sola
assert.equal(countItems([{ ...unit('X', 'X', 1), qty: 3, isFree: false }, kg('Q1', 16.5)]), 4)
ok('una línea por peso (16,5 kg) cuenta como 1 ítem, no como 16,5')

// --- los hasta tres precios de venta de un producto
assert.deepEqual(priceOptions({ price: 5000, price2: 4500, price3: 4000 }).map((o) => [o.slot, o.label, o.price]), [[1, 'Precio 1', 5000], [2, 'Precio 2', 4500], [3, 'Precio 3', 4000]])
assert.deepEqual(priceOptions({ price: 5000 }), [{ slot: 1, label: 'Precio 1', price: 5000 }], 'con un solo precio no hay nada que elegir')
assert.deepEqual(sellingPrices({ price: 5000, price3: 4000 }), [5000, 4000], 'un Precio 3 sin Precio 2 no deja hueco')
assert.deepEqual(sellingPrices({ price: 0 }), [0], 'el Precio 1 siempre está, aunque sea 0')
assert.deepEqual(sellingPrices({ price: 5000, price2: 0, price3: -1 }), [5000], 'un 0 o un negativo no es un precio')
assert.equal(samePrice(2700, 2700.004), true)
assert.equal(samePrice(2700, 2700.01), false, 'se comparan al centavo')
ok('Precio 1 siempre está; Precio 2 y 3 solo cuando tienen valor; los precios se comparan al centavo')

// --- elegir otro de los precios en la línea del carrito
reset()
store().addUnitItem(milk, 2)
store().addUnitItem(rice, 1)
store().setItemPrice(0, 2700) // el Precio 2 de la leche
assert.deepEqual(active().items.map((i) => [i.code, i.price, i.qty]), [['L1', 2700, 2], ['A1', 2500, 1]], 'cambia el precio de esa línea y solo de esa')
store().openCart()
store().addUnitItem(milk, 1)
assert.equal(active().items[0].price, 3000, 'en otro carrito la leche entra a su precio de siempre')
store().selectCart(store().carts[0].id)
store().addUnitItem(milk, 1)
assert.deepEqual(active().items.map((i) => [i.code, i.price, i.qty]), [['L1', 2700, 3], ['A1', 2500, 1]], 'sumar otra unidad conserva el precio elegido')
store().changeQty(0, -1)
assert.equal(active().items[0].price, 2700, 'restar también')
const settled = store().carts
store().setItemPrice(0, 2700.004)
store().setItemPrice(0, 2700)
store().setItemPrice(9, 1)
store().setItemPrice(0, -5)
store().setItemPrice(0, Number.NaN)
assert.equal(store().carts, settled, 'el mismo precio, una línea que no existe o un precio inválido no cambian nada')
store().addFreeItem('Bolsa', 300, 1)
store().setItemPrice(2, 1)
assert.equal(active().items[2].price, 300, 'una línea libre conserva el precio con que se escribió')
store().setItemPrice(0, 3000)
assert.equal(active().items[0].price, 3000, 'y se puede volver al Precio 1')
assert.equal(active().items.reduce((a, i) => a + i.price * i.qty, 0), 3000 * 2 + 2500 + 300, 'el subtotal sigue los precios elegidos')
ok('elegir otro precio cambia solo esa línea del carrito en pantalla, se conserva al sumar o restar, y no toca líneas libres ni acepta precios inválidos')

// --- Precio 2 y Precio 3 en los archivos que se importan, y lo que se exporta se puede volver a importar
const rows = buildParsedRows(
  [
    { código: 'P1', nombre: 'Arroz', 'precio 1': '10,5', 'precio 2': '9.5', 'precio 3': '9' },
    { codigo: 'P2', nombre: 'Sal', 'precio venta': '3', 'precio 2': '', 'precio 3': '' },
    { codigo: 'P3', nombre: 'Aceite', precio: '7', precio3: '6' },
  ],
  [],
).parsed
assert.deepEqual(rows.map((r) => [r.code, r.price, r.price2, r.price3]), [['P1', 10.5, 9.5, 9], ['P2', 3, 0, 0], ['P3', 7, 0, 6]], 'acepta "Precio 1" o el antiguo "Precio Venta", y los otros dos vacíos o ausentes')

const stock: Product[] = [
  { code: 'A', name: 'Arroz "premium"', price: 5000, price2: 4500, price3: 4000, cost: 3000, stock: 10, min: 2, cat: 'Granos', brand: 'X', unit: 'unidad', esPaquete: false },
  { code: 'B', name: 'Sal', price: 1000, cost: 600, stock: 5, min: 1, cat: 'Granos', brand: '', unit: 'unidad', esPaquete: false },
]
const exported = stockCsv(stock)
assert.match(exported, /Precio 1,Precio 2,Precio 3,Precio Compra/, 'el encabezado del CSV trae los tres precios')
const back = buildParsedRows(await parseImportFile(new File([exported], 'stock.csv')), []).parsed
assert.deepEqual(back.map((r) => [r.code, r.price, r.price2, r.price3, r.cost]), [['A', 5000, 4500, 4000, 3000], ['B', 1000, 0, 0, 600]], 'el CSV exportado se vuelve a importar igual')
const template = importTemplateCsv(stock, 'Tienda')
const fromTemplate = buildParsedRows(await parseImportFile(new File([template], 'plantilla.csv')), []).parsed
assert.deepEqual(fromTemplate.slice(0, 2).map((r) => [r.price, r.price2, r.price3]), [[5.5, 5, 4.5], [2, 1.8, 0]], 'la plantilla trae ejemplos con Precio 2 y 3 que se leen bien')
ok('la importación lee Precio 1/2/3 (y el antiguo "Precio Venta"); el CSV exportado y la plantilla se vuelven a importar con los mismos precios')

// --- las columnas de la tabla de stock que caben en la pantalla
const table = [{ min: 100 }, { min: 50, drop: 2 }, { min: 30, drop: 1 }, { min: 80 }] // suma 260
assert.equal(fitColumns(table, null), table, 'sin medir todavía, todas')
assert.equal(fitColumns(table, 260), table, 'si caben, todas (la misma lista)')
assert.deepEqual(fitColumns(table, 240).map((c) => c.min), [100, 50, 80], 'si falta poco, sale la de número más bajo')
assert.deepEqual(fitColumns(table, 190).map((c) => c.min), [100, 80], 'si falta más, sale también la siguiente')
assert.equal(fitColumns(table, 150), table, 'si ni sin ellas cabe (un celular), se queda con todas y la tabla se desplaza')
ok('la tabla deja fuera las columnas menos importantes solo si con eso cabe en la pantalla; si no, conserva todas')

console.log(`\nTodo en orden: ${n} comprobaciones de los carritos pasaron.`)
