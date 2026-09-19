'use client'
import useNetworkStatus from '@/features/network-status/model/useNetworkStatus'

const NetworkStatusProvider = () => {
	useNetworkStatus()
	return null
}

export default NetworkStatusProvider
