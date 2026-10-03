import bill1000 from '../../../assets/bills/1000.jpg'
import bill2000 from '../../../assets/bills/2000.jpg'
import bill5000 from '../../../assets/bills/5000.jpg'
import bill10000 from '../../../assets/bills/10000.jpg'
import bill20000 from '../../../assets/bills/20000.jpg'
import bill50000 from '../../../assets/bills/50000.jpg'
import bill100000 from '../../../assets/bills/100000.jpg'

/** Colombian banknotes, smallest first: the quick "efectivo recibido" buttons of the checkout sheet.
 * The photos are shrunk copies of the originals kept outside the repo (MIOS/bills). */
export const BILLS = [
  { value: 1000, img: bill1000 },
  { value: 2000, img: bill2000 },
  { value: 5000, img: bill5000 },
  { value: 10000, img: bill10000 },
  { value: 20000, img: bill20000 },
  { value: 50000, img: bill50000 },
  { value: 100000, img: bill100000 },
]
