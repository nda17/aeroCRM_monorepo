import { errorCatch } from '@/shared/api'
import { validName } from '@/shared/regex'
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
		onMutate: () => toast.loading('Пожалуйста, подождите'),
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
		const name = data.name?.trim().normalize('NFC')
		if (name && (name.length > 120 || !validName.test(name))) {
			toast.error(
				'Имя должно начинаться с буквы и содержать не более 120 символов. Можно использовать буквы, цифры, пробелы, дефис, апостроф и точку.'
			)
			return false
		}
		try {
			await mutateAsync({
				name: name || undefined,
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
