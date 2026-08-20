import { create } from 'zustand'

// Immersive mode hides all app chrome (top bar, sidebar, bottom player, mobile
// nav) so full-screen experiences — portrait video playback and full-screen
// reading — can use the entire viewport. Cross-cutting, so both the video
// player and the novel reader toggle the same flag that Layout reads.
export type ImmersiveReason = 'video' | 'reader'

interface ImmersiveState {
  active: boolean
  reason: ImmersiveReason | null
  setActive: (active: boolean, reason?: ImmersiveReason | null) => void
}

export const useImmersiveStore = create<ImmersiveState>((set) => ({
  active: false,
  reason: null,
  setActive: (active, reason = null) =>
    set({ active, reason: active ? reason : null }),
}))
