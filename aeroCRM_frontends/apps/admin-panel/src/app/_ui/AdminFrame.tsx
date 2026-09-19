'use client'

import Header from '@/app/_ui/layout/header/Header'
import styles from '@/app/_ui/layout/Layout.module.scss'
import { useVeilBackgroundStore } from '@/shared/lib/veil-background'
import VeilBackground from '@/shared/ui/veil-background/VeilBackground'
import type { PropsWithChildren } from 'react'

export default function AdminFrame({ children }: PropsWithChildren) {
	const visible = useVeilBackgroundStore(state => state.visible)
	return (
		<div className={styles.layout}>
			<Header isAbsolute={false} />
			{visible && <VeilBackground />}
			<main className={styles.main}>{children}</main>
		</div>
	)
}
