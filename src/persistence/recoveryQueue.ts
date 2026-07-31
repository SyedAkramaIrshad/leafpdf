import type { EditorDocument } from '../model/editor'
import { deleteSession, saveSession } from './localStore'

type SaveOperation<T> = (key: string, value: T) => Promise<void>
type DeleteOperation = (key: string) => Promise<void>

/**
 * Serializes recovery writes and deletions. Clearing increments the generation
 * immediately, so any save that was queued from an older render is skipped before
 * it can recreate a record that the user deliberately removed.
 */
export class RecoveryQueue<T = EditorDocument> {
  private tail: Promise<void> = Promise.resolve()
  private generation = 0

  constructor(
    private readonly saveOperation: SaveOperation<T> = saveSession as SaveOperation<T>,
    private readonly deleteOperation: DeleteOperation = deleteSession,
  ) {}

  save(key: string, value: T): Promise<void> {
    const generation = this.generation
    return this.enqueue(async () => {
      if (generation !== this.generation) return
      await this.saveOperation(key, value)
    })
  }

  clear(key: string): Promise<void> {
    this.generation += 1
    return this.enqueue(() => this.deleteOperation(key))
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.tail.then(operation, operation)
    this.tail = next.catch(() => undefined)
    return next
  }
}
