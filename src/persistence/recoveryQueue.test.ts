import { describe, expect, it, vi } from 'vitest'
import { RecoveryQueue } from './recoveryQueue'

describe('RecoveryQueue', () => {
  it('invalidates a queued stale save before deleting recovery', async () => {
    const save = vi.fn(async () => undefined)
    const remove = vi.fn(async () => undefined)
    const queue = new RecoveryQueue<{ version: number }>(save, remove)

    const staleSave = queue.save('document', { version: 1 })
    const deletion = queue.clear('document')
    await Promise.all([staleSave, deletion])

    expect(remove).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
  })

  it('allows a newer edit to save after an earlier clear', async () => {
    const order: string[] = []
    const queue = new RecoveryQueue<{ version: number }>(
      async (_key, value: { version: number }) => { order.push(`save-${value.version}`) },
      async () => { order.push('clear') },
    )

    const deletion = queue.clear('document')
    const currentSave = queue.save('document', { version: 2 })
    await Promise.all([deletion, currentSave])

    expect(order).toEqual(['clear', 'save-2'])
  })
})
