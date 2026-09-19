import { useDebounce } from '@/shared/lib/hooks/useDebounce'
import {
	userService as UserService,
	IAdminUserListFilters
} from '@/entities/user'
import { useAuthStore } from '@/entities/user'
import { errorCatch } from '@/shared/api'
import {
	useMutation,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import { ChangeEvent, MouseEvent, useState } from 'react'
import toast from 'react-hot-toast'

const USER_SOFT_DELETE_TOAST_ID = 'admin-user-soft-delete'
const USER_RESTORE_TOAST_ID = 'admin-user-restore'

const useUserList = (
	page: number,
	limit: number,
	filters?: IAdminUserListFilters,
	enabled = true,
	searchTermOverride?: string
) => {
	const auth = useAuthStore(state => state.auth)
	const [searchTerm, setSearchTerm] = useState('')
	const queryClient = useQueryClient()
	const debouncedSearch = useDebounce(searchTerm, 500)
	const querySearchTerm = searchTermOverride ?? debouncedSearch

	const { data, isLoading } = useQuery({
		queryKey: ['get-user-list', querySearchTerm, page, limit, filters],
		queryFn: () =>
			UserService.fetchUserList(querySearchTerm, page, limit, filters),
		select: ({ data }) => data,
		enabled: auth && enabled
	})

	const { mutate: deleteUser, isPending: isDeleting } = useMutation({
		mutationKey: ['soft-delete-user'],
		mutationFn: (userId: string) => UserService.deleteUser(userId),
		onMutate() {
			toast.loading('Удаляем пользователя...', {
				id: USER_SOFT_DELETE_TOAST_ID
			})
		},
		onSuccess() {
			toast.success('Пользователь помечен как удалённый', {
				id: USER_SOFT_DELETE_TOAST_ID
			})
			void queryClient.invalidateQueries({
				queryKey: ['get-user-list']
			})
		},
		onError(error) {
			toast.error(errorCatch(error) || 'Не удалось удалить пользователя', {
				id: USER_SOFT_DELETE_TOAST_ID
			})
		}
	})

	const { mutate: restoreUser, isPending: isRestoring } = useMutation({
		mutationKey: ['restore-user'],
		mutationFn: (userId: string) => UserService.restoreUser(userId),
		onMutate() {
			toast.loading('Восстанавливаем пользователя...', {
				id: USER_RESTORE_TOAST_ID
			})
		},
		onSuccess() {
			toast.success('Пользователь восстановлен', {
				id: USER_RESTORE_TOAST_ID
			})
			void queryClient.invalidateQueries({
				queryKey: ['get-user-list']
			})
		},
		onError(error) {
			toast.error(
				errorCatch(error) || 'Не удалось восстановить пользователя',
				{ id: USER_RESTORE_TOAST_ID }
			)
		}
	})

	const handleSearch = (e: ChangeEvent<HTMLInputElement>) => {
		setSearchTerm(e.target.value)
	}

	const handleClear = (e: MouseEvent<HTMLSpanElement>) => {
		setSearchTerm('')
	}

	return {
		data,
		isLoading,
		searchTerm,
		debouncedSearch,
		handleClear,
		handleSearch,
		deleteUser,
		isDeleting,
		restoreUser,
		isRestoring
	}
}

export default useUserList
