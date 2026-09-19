import LogoutButton from '@/app/_ui/layout/nav-menu/mobile/menu/logout-button/LogoutButton'
import MenuItem from '@/app/_ui/layout/nav-menu/mobile/menu/menu-item/MenuItem'
import { ADMIN_PAGES } from '@/shared/config/pages/admin.config'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import { useUser } from '@/entities/user'
import { useAuthStore } from '@/entities/user'
import { NextPage } from 'next'

const AuthItems: NextPage = () => {
	const { user, isLoading } = useUser()
	const auth = useAuthStore(state => state.auth)
	const isAuthResolved = useAuthStore(state => state.isAuthResolved)

	const isPending = !isAuthResolved || (auth && isLoading)

	if (isPending) {
		return null
	}

	return (
		<>
			{auth && (
				<MenuItem
					item={{
						icon: 'dashboard',
						link: PUBLIC_PAGES.CABINET,
						title: 'Личный кабинет'
					}}
				/>
			)}

			{auth && (
				<MenuItem
					item={{
						icon: 'payment',
						link: PUBLIC_PAGES.PAYMENT,
						title: 'Оплата'
					}}
				/>
			)}

			{user?.isAdmin && (
				<MenuItem
					item={{
						icon: 'lock',
						link: ADMIN_PAGES.HOME,
						title: 'Админ панель'
					}}
				/>
			)}

			{!auth && (
				<MenuItem
					item={{
						icon: 'login',
						link: PUBLIC_PAGES.LOGIN,
						title: 'Войти'
					}}
				/>
			)}

			{!auth && (
				<MenuItem
					item={{
						icon: 'person-add',
						link: PUBLIC_PAGES.REGISTER,
						title: 'Регистрация'
					}}
				/>
			)}

			{auth && <LogoutButton />}
		</>
	)
}

export default AuthItems
