'use client'

import {
	createContext,
	useCallback,
	useContext,
	useState,
	type PropsWithChildren
} from 'react'
import { createPortal } from 'react-dom'
import { Toaster } from 'react-hot-toast'
import styles from './ToastProvider.module.scss'

type RegisterToastHost = (host: HTMLElement) => () => void
const noHost: RegisterToastHost = () => () => undefined
const ToastHostContext = createContext<RegisterToastHost>(noHost)

/** Called after showModal, never during render. Cleanup releases this registration only. */
export const useModalToastHost = () => useContext(ToastHostContext)

export const ToastProvider = ({ children }: PropsWithChildren) => {
	const [hosts, setHosts] = useState<{ element: HTMLElement }[]>([])
	const register = useCallback<RegisterToastHost>(element => {
		const registration = { element }
		setHosts(current => [...current, registration])
		return () => {
			setHosts(current => current.filter(item => item !== registration))
		}
	}, [])
	const host = hosts.at(-1)?.element
	const toaster = (
		<Toaster
			position="top-center"
			toastOptions={{
				className: styles.toast,
				success: {
					iconTheme: {
						primary: 'rgb(var(--crm-success))',
						secondary: 'rgb(var(--crm-surface))'
					}
				},
				error: {
					iconTheme: {
						primary: 'rgb(var(--crm-danger))',
						secondary: 'rgb(var(--crm-surface))'
					}
				}
			}}
			containerClassName={host ? styles.modalViewport : undefined}
		/>
	)
	return (
		<ToastHostContext.Provider value={register}>
			{children}
			{host ? createPortal(toaster, host) : toaster}
		</ToastHostContext.Provider>
	)
}
