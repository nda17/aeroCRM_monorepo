import { IVeilBackgroundStore } from './veil-background-store.types'
import { create } from 'zustand'

export const useVeilBackgroundStore = create<IVeilBackgroundStore>(
	set => ({
		visible: false,
		setVisible: (value?) =>
			set(state => ({
				visible: value !== undefined ? value : !state.visible
			}))
	})
)
