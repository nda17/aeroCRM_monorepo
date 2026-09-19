import { IUserEditInput } from '@/entities/user'
import { ADMIN_PAGES } from '@/shared/config/pages/admin.config'
import { userService as UserService } from '@/entities/user'
import { useAuthStore } from '@/entities/user'
import { errorCatch } from '@/shared/api'
import {
	useMutation,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import axios from 'axios'
import { useZoneRouter as useRouter } from '@/shared/lib/navigation/useZoneRouter'
import { useEffect } from 'react'
import { SubmitHandler } from 'react-hook-form'
import toast from 'react-hot-toast'

const AUTO_RENEWAL_QUERY_KEY = 'get-user-auto-renewal'

export type AdminAutoRenewalAction =
	| 'pause'
	| 'resume'
	| 'revoke'
	| 'reconcile'
	| 'resumeTechnical'

export type AdminAutoRenewalActionInput =
	| {
			action: 'pause' | 'resume' | 'revoke' | 'resumeTechnical'
			reason: string
	  }
	| {
			action: 'reconcile'
	  }

const AUTO_RENEWAL_ACTION_COPY: Record<
	AdminAutoRenewalAction,
	{
		loading: string
		fallbackSuccess: string
		fallbackError: string
		toastId: string
	}
> = {
	pause: {
		loading: 'Приостанавливаем автопродление...',
		fallbackSuccess: 'Автопродление приостановлено',
		fallbackError: 'Не удалось приостановить автопродление',
		toastId: 'admin-user-auto-renewal-pause'
	},
	resume: {
		loading: 'Возобновляем автопродление...',
		fallbackSuccess: 'Автопродление возобновлено',
		fallbackError: 'Не удалось возобновить автопродление',
		toastId: 'admin-user-auto-renewal-resume'
	},
	revoke: {
		loading: 'Фиксируем отзыв согласия...',
		fallbackSuccess: 'Отзыв согласия зафиксирован',
		fallbackError: 'Не удалось зафиксировать отзыв согласия',
		toastId: 'admin-user-auto-renewal-revoke'
	},
	reconcile: {
		loading: 'Сверяем состояние автопродления...',
		fallbackSuccess: 'Состояние автопродления сверено',
		fallbackError: 'Не удалось сверить состояние автопродления',
		toastId: 'dev-user-auto-renewal-reconcile'
	},
	resumeTechnical: {
		loading: 'Снимаем техническую паузу...',
		fallbackSuccess: 'Техническая пауза снята',
		fallbackError: 'Не удалось снять техническую паузу',
		toastId: 'dev-user-auto-renewal-resume-technical'
	}
}

export const useUserEdit = (params: { id: string }) => {
	const auth = useAuthStore(state => state.auth)
	const router = useRouter()
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
		queryFn: () => UserService.fetchUserOverview(userId),
		select: ({ data }) => data,
		enabled: auth && !!userId && Boolean(data)
	})

	const {
		data: autoRenewal,
		isLoading: isAutoRenewalLoading,
		isError: isAutoRenewalError
	} = useQuery({
		queryKey: [AUTO_RENEWAL_QUERY_KEY, userId],
		queryFn: () => UserService.fetchAdminUserAutoRenewal(userId),
		select: ({ data }) => data,
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
			router.push(ADMIN_PAGES.USER_LIST)
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

	const { mutateAsync: uploadAvatarAsync } = useMutation({
		mutationKey: ['upload-user-avatar', userId],
		mutationFn: (file: File) =>
			UserService.uploadAdminUserAvatar(userId, file)
	})

	const { mutateAsync: deleteAvatarAsync } = useMutation({
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

	const {
		isPending: isAutoRenewalUpdating,
		variables: autoRenewalActionInput,
		mutateAsync: manageAutoRenewalAsync
	} = useMutation({
		mutationKey: ['manage-user-auto-renewal', userId],
		mutationFn: (input: AdminAutoRenewalActionInput) => {
			switch (input.action) {
				case 'pause':
					return UserService.pauseAdminUserAutoRenewal(
						userId,
						input.reason
					)
				case 'resume':
					return UserService.resumeAdminUserAutoRenewal(
						userId,
						input.reason
					)
				case 'revoke':
					return UserService.revokeAdminUserAutoRenewal(
						userId,
						input.reason
					)
				case 'reconcile':
					return UserService.reconcileAdminUserAutoRenewal(userId)
				case 'resumeTechnical':
					return UserService.resumeTechnicalAdminUserAutoRenewal(
						userId,
						input.reason
					)
			}
		},
		onMutate(input) {
			const copy = AUTO_RENEWAL_ACTION_COPY[input.action]
			toast.loading(copy.loading, { id: copy.toastId })

			return { toastId: copy.toastId }
		},
		onSuccess({ data: response }, input, context) {
			const copy = AUTO_RENEWAL_ACTION_COPY[input.action]
			toast.success(response.message || copy.fallbackSuccess, {
				id: context.toastId
			})
			void queryClient.invalidateQueries({
				queryKey: [AUTO_RENEWAL_QUERY_KEY, userId]
			})
			void queryClient.invalidateQueries({
				queryKey: ['get-user-overview', userId]
			})
			void queryClient.invalidateQueries({
				queryKey: ['admin-event-log']
			})
		},
		onError(error, input, context) {
			const copy = AUTO_RENEWAL_ACTION_COPY[input.action]
			toast.error(errorCatch(error) || copy.fallbackError, {
				id: context?.toastId ?? copy.toastId
			})
		}
	})

	const onSubmit: SubmitHandler<IUserEditInput> = async data => {
		await mutateAsync(data)
	}

	return {
		onSubmit,
		isLoading,
		data,
		overview,
		isOverviewLoading,
		autoRenewal,
		isAutoRenewalLoading,
		isAutoRenewalError,
		isAutoRenewalUpdating,
		autoRenewalUpdatingAction: autoRenewalActionInput?.action,
		manageAutoRenewal: manageAutoRenewalAsync,
		isSaving: isPending,
		isActivationUpdating,
		toggleActivation: toggleActivationAsync,
		uploadAvatar,
		deleteAvatar
	}
}
