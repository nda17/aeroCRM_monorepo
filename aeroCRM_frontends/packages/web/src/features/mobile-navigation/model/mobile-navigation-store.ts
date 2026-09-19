import { IHamburgerStore } from '@/features/mobile-navigation/model/mobile-navigation-store.types'
import { create } from 'zustand'

export const useHamburgerStore = create<IHamburgerStore>(set => ({
	visible: false,
	setVisible: (value?) =>
		set(state => ({
			visible: value !== undefined ? value : !state.visible
		}))
}))
