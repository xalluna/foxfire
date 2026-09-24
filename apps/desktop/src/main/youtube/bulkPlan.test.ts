import { describe, expect, it } from 'vitest'
import { describeSkip, planBulkUpload, type BulkCandidate } from './bulkPlan'

function candidate(recordingId: number, over: Partial<BulkCandidate> = {}): BulkCandidate {
  return {
    recordingId,
    startedAt: 1_700_000_000_000 + recordingId * 60_000,
    hasFile: true,
    onYouTube: false,
    uploadPending: false,
    ...over
  }
}

function candidates(...list: BulkCandidate[]): Map<number, BulkCandidate> {
  return new Map(list.map((item) => [item.recordingId, item]))
}

describe('planBulkUpload', () => {
  it('queues the oldest game first, whatever order they were picked in', () => {
    const plan = planBulkUpload(
      [3, 1, 2],
      candidates(candidate(1, { startedAt: 300 }), candidate(2, { startedAt: 100 }), candidate(3, { startedAt: 200 }))
    )
    expect(plan.queue).toEqual([2, 3, 1])
    expect(plan.skipped).toEqual([])
  })

  it('leaves out what cannot go, and says why for each', () => {
    const plan = planBulkUpload(
      [1, 2, 3, 4, 5],
      candidates(
        candidate(1),
        candidate(2, { hasFile: false }),
        candidate(3, { onYouTube: true }),
        candidate(4, { uploadPending: true })
      )
    )
    expect(plan.queue).toEqual([1])
    expect(plan.skipped).toEqual([
      { recordingId: 2, reason: 'no_file' },
      { recordingId: 3, reason: 'on_youtube' },
      { recordingId: 4, reason: 'pending' },
      { recordingId: 5, reason: 'missing' }
    ])
  })

  it('queues a recording once however many times it was picked', () => {
    expect(planBulkUpload([1, 1, 1], candidates(candidate(1))).queue).toEqual([1])
  })

  it('keeps a stable order for two games that started in the same second', () => {
    const plan = planBulkUpload([9, 4], candidates(candidate(9, { startedAt: 5 }), candidate(4, { startedAt: 5 })))
    expect(plan.queue).toEqual([4, 9])
  })

  it('has a sentence for every reason', () => {
    for (const reason of ['missing', 'no_file', 'on_youtube', 'pending'] as const) {
      expect(describeSkip(reason)).toMatch(/\.$/)
    }
  })
})
