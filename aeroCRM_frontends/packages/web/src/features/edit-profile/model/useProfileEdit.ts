import { errorCatch } from '@/shared/api'
import { userService, IProfileEditInput } from '@/entities/user'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { SubmitHandler } from 'react-hook-form'
import toast from 'react-hot-toast'

export const useProfileEdit = () => {
	const queryClient = useQueryClient()

	const { mutateAsync, isPending } = useMutation({
		mutationKey: ['update-profile'],
		mutationFn: (data: IProfileEditInput) =>
			userService.updateProfile(data),
		onMutate: () =>
			toast.loading('Сохраняем профиль, пожалуйста подождите...'),
		onSuccess(_, __, toastId) {
			toast.success('Изменения профиля сохранены', { id: toastId })
			queryClient.invalidateQueries({ queryKey: ['get-profile'] })
		},
		onError(error, _, toastId) {
			toast.error(`Изменение данных профиля: ${errorCatch(error)}`, {
				id: toastId
			})
		}
	})

	const onSubmit: SubmitHandler<IProfileEditInput> = async data => {
		try {
			await mutateAsync({
				name: data.name || undefined,
				password: data.password || undefined
			})

			return true
		} catch {
			// Error toast is handled in the mutation.
			return false
		}
	}

	return {
		onSubmit,
		isLoading: isPending
	}
}
