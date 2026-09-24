import { create } from 'zustand'

/**
 * Which recording the upload form is open for, if any.
 *
 * A store rather than state in one component because three places open it —
 * the Recordings tab, a match row's menu and the recording window's header —
 * and each window mounts one host that draws it.
 */
interface UploadDialogState {
  recordingId: number | null
  open: (recordingId: number) => void
  close: () => void
}

export const useUploadDialog = create<UploadDialogState>((set) => ({
  recordingId: null,
  open: (recordingId) => set({ recordingId }),
  close: () => set({ recordingId: null })
}))

export function openUploadDialog(recordingId: number): void {
  useUploadDialog.getState().open(recordingId)
}
