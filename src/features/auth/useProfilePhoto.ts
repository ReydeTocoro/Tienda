import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import { OWNER_ID, type Operator } from '../../store/useSessionStore'

/** The picture of whoever is working: the owner's (in the settings) or their user's — both synced to
 * every device with the rest of the data. */
export function useProfilePhoto(operator: Operator | null): string | undefined {
  return useLiveQuery(async () => {
    if (!operator) return undefined
    if (operator.id === OWNER_ID) return (await db.settings.get('main'))?.owner?.photo
    return (await db.usuarios.get(operator.id))?.photo
  }, [operator?.id])
}
