import userService from '@/entities/user/api/user.api'
import { useAuthStore } from '@/entities/user/model/auth-store'
import { transformUserToState } from '@/entities/user/model/transform-user-to-state'
import { useQuery } from '@tanstack/react-query'

const useUser = () => {
	const auth = useAuthStore(state => state.auth)
	const isAuthResolved = useAuthStore(state => state.isAuthResolved)

	const { data, isLoading } = useQuery({
		queryKey: ['get-profile', auth],
		queryFn: () => userService.fetchProfile(),
		refetchInterval: 1800000,
		enabled: auth
	})

	const profile = data?.data
	const userState = profile ? transformUserToState(profile) : null

	return {
		isLoading: !isAuthResolved || isLoading,
		user: {
			...profile,
			...userState
		}
	}
}

export default useUser
