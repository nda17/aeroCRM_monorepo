'use client'
import { useEffect } from 'react'
import toast from 'react-hot-toast'

const OFFLINE_TOAST_ID = 'network-offline'

const useNetworkStatus = () => {
	useEffect(() => {
		const handleOffline = () => {
			toast.error('Нет подключения к сети', {
				id: OFFLINE_TOAST_ID,
				duration: Infinity
			})
		}

		const handleOnline = () => {
			toast.dismiss(OFFLINE_TOAST_ID)
			toast.success('Подключение восстановлено', { duration: 3000 })
		}

		window.addEventListener('offline', handleOffline)
		window.addEventListener('online', handleOnline)

		return () => {
			window.removeEventListener('offline', handleOffline)
			window.removeEventListener('online', handleOnline)
		}
	}, [])
}

export default useNetworkStatus
