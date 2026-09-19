'use client'

import { useEffect } from 'react'
import { startThemeSynchronization } from './theme'

export const ThemeRuntime = () => {
	useEffect(startThemeSynchronization, [])
	return null
}
