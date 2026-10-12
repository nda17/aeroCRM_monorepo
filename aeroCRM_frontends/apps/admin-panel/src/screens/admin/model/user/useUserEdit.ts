import { IUserEditInput } from '@/entities/user'
import { userService as UserService } from '@/entities/user'
import { useAuthStore } from '@/entities/user'
import { adminUserOverviewService } from './user-overview-admin.api'
import {
	useMutation,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import axios from 'axios'
import { useEffect } from 'react'
import { SubmitHandler } from 'react-hook-form'
import toast from 'react-hot-toast'

export const useUserEdit = (params: { id: string }) => {
	const auth = useAuthStore(state => state.auth)
	const userId = params.id
	const queryClient = useQueryClient()
	const setAvatarDetailCache = (avatarPath: string | null) =>
		queryClient.setQueryData<
			Awaited<ReturnType<typeof UserService.fetchUserById>>
		>(['get-user-by-id', userId], cached =>
			cached
				? {
						...cached,
						data: { ...cached.data, avatarPath }
					}
				: cached
		)
	const invalidateAvatarQueries = () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: ['get-user-overview', userId]
			}),
			queryClient.invalidateQueries({ queryKey: ['get-user-list'] }),
			queryClient.invalidateQueries({ queryKey: ['get-profile'] }),
			queryClient.invalidateQueries({ queryKey: ['admin-event-log'] })
		])

	const { data, error, isLoading, isError } = useQuery({
		queryKey: ['get-user-by-id', userId],
		queryFn: () => UserService.fetchUserById(userId),
		select: ({ data }) => data,
		enabled: auth && !!userId
	})

	const { data: overview, isLoading: isOverviewLoading } = useQuery({
		queryKey: ['get-user-overview', userId],
		queryFn: () => adminUserOverviewService.get(userId),
		enabled: auth && !!userId && Boolean(data)
	})

	useEffect(() => {
		if (!isError) return

		if (axios.isAxiosError(error)) {
			toast.error(
				error.response?.data?.message ||
					'Произошла ошибка, попробуйте позже'
			)
			return
		}

		toast.error('Произошла ошибка, попробуйте позже')
	}, [error, isError])

	const { isPending, mutateAsync } = useMutation({
		mutationKey: ['update-user', userId],
		mutationFn: (data: IUserEditInput) =>
			UserService.updateUser(userId, data),
		onSuccess() {
			toast.success('Изменения данных пользователя сохранены')
			void queryClient.invalidateQueries({
				queryKey: ['get-user-by-id', userId]
			})
			void queryClient.invalidateQueries({
				queryKey: ['get-user-overview', userId]
			})
			void queryClient.invalidateQueries({ queryKey: ['get-user-list'] })
		},
		onError(error) {
			if (axios.isAxiosError(error)) {
				toast.error(
					error.response?.data?.message ||
						'Не удалось сохранить изменения пользователя'
				)
				return
			}

			toast.error('Не удалось сохранить изменения пользователя')
		}
	})

	const {
		isPending: isActivationUpdating,
		mutateAsync: toggleActivationAsync
	} = useMutation({
		mutationKey: ['toggle-user-activation', userId],
		mutationFn: () => UserService.toggleUserActivation(userId),
		onSuccess({ data }) {
			toast.success(
				data.status === 'DEACTIVATED'
					? 'Пользователь деактивирован'
					: 'Пользователь активирован'
			)
			void queryClient.invalidateQueries({
				queryKey: ['get-user-by-id', userId]
			})
			void queryClient.invalidateQueries({
				queryKey: ['get-user-overview', userId]
			})
			void queryClient.invalidateQueries({ queryKey: ['get-user-list'] })
		},
		onError(error) {
			if (axios.isAxiosError(error)) {
				toast.error(
					error.response?.data?.message ||
						'Не удалось изменить статус пользователя'
				)
				return
			}

			toast.error('Не удалось изменить статус пользователя')
		}
	})

	const { mutateAsync: uploadAvatarAsync, isPending: isAvatarUploading } =
		useMutation({
			mutationKey: ['upload-user-avatar', userId],
			mutationFn: (file: File) =>
				UserService.uploadAdminUserAvatar(userId, file)
		})

	const { mutateAsync: deleteAvatarAsync, isPending: isAvatarDeleting } =
		useMutation({
			mutationKey: ['delete-user-avatar', userId],
			mutationFn: () => UserService.deleteAdminUserAvatar(userId)
		})

	const uploadAvatar = async (file: File) => {
		const avatarPath = await uploadAvatarAsync(file)
		setAvatarDetailCache(avatarPath)
		await invalidateAvatarQueries()
		return avatarPath
	}

	const deleteAvatar = async () => {
		await deleteAvatarAsync()
		setAvatarDetailCache(null)
		await invalidateAvatarQueries()
	}

	const onSubmit: SubmitHandler<IUserEditInput> = async data => {
		await mutateAsync(data)
	}

	return {
		isAvatarUpdating: isAvatarUploading || isAvatarDeleting,
		onSubmit,
		isLoading,
		data,
		overview,
		isOverviewLoading,
		isSaving: isPending,
		isActivationUpdating,
		toggleActivation: toggleActivationAsync,
		uploadAvatar,
		deleteAvatar
	}
}
