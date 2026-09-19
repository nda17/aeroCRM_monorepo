'use client'
import styles from '@/screens/admin/ui/user-list/UserList.module.scss'
import AdminActions from '@/screens/admin/ui/common/admin-actions/AdminActions'
import AdminHeader from '@/screens/admin/ui/common/admin-header/AdminHeader'
import AdminNavigation from '@/screens/admin/ui/common/admin-navigation/AdminNavigation'
import AdminSectionHeading from '@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading'
import AdminTooltip from '@/screens/admin/ui/common/admin-tooltip/AdminTooltip'
import ConfirmDialog from '@/shared/ui/confirm-dialog/ConfirmDialog'
import Heading from '@/shared/ui/heading/Heading'
import Pagination from '@/shared/ui/pagination/Pagination'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import { ADMIN_PAGES } from '@/shared/config/pages/admin.config'
import { useUserList } from '@/features/manage-users'
import {
	IAdminUserListFilters,
	IUser,
	UserLoginMethod,
	UserRole,
	useUser
} from '@/entities/user'
import clsx from 'clsx'
import { NextPage } from 'next'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'

type UserRoleFilter = IAdminUserListFilters['role'] | 'ALL'
type UserSubscriptionFilter = IAdminUserListFilters['subscription'] | 'ALL'

interface UserFilterDraft {
	role: UserRoleFilter
	subscription: UserSubscriptionFilter
	registeredFrom: string
	registeredTo: string
}

const DEFAULT_USER_FILTERS: UserFilterDraft = {
	role: 'ALL',
	subscription: 'ALL',
	registeredFrom: '',
	registeredTo: ''
}

const ROLE_FILTER_OPTIONS: Array<{
	value: UserRoleFilter
	label: string
}> = [
	{ value: 'ALL', label: 'Все роли' },
	{ value: 'USER', label: 'USER' },
	{ value: 'ADMIN', label: 'ADMIN' },
	{ value: 'DEV', label: 'DEV' }
]

const SUBSCRIPTION_FILTER_OPTIONS: Array<{
	value: UserSubscriptionFilter
	label: string
}> = [
	{ value: 'ALL', label: 'Все пользователи' },
	{ value: 'HAS', label: 'Есть подписка' },
	{ value: 'NONE', label: 'Нет подписки' }
]

const normalizeUserFilters = (
	draft: UserFilterDraft
): IAdminUserListFilters => ({
	role: draft.role === 'ALL' ? undefined : draft.role,
	subscription:
		draft.subscription === 'ALL' ? undefined : draft.subscription,
	registeredFrom: draft.registeredFrom || undefined,
	registeredTo: draft.registeredTo || undefined
})

const formatDeletedAt = (value: string) =>
	new Intl.DateTimeFormat('ru-RU', {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(new Date(value))

const UserList: NextPage = () => {
	const [currentPage, setCurrentPage] = useState(1)
	const [deletedCurrentPage, setDeletedCurrentPage] = useState(1)
	const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
	const [restoreTargetId, setRestoreTargetId] = useState<string | null>(
		null
	)
	const [filterDraft, setFilterDraft] = useState(DEFAULT_USER_FILTERS)
	const [filters, setFilters] = useState<IAdminUserListFilters>({})
	const { user: currentUser, isLoading: isCurrentUserLoading } = useUser()
	const isDev = Boolean(currentUser?.rights?.includes(UserRole.DEV))
	const deletedRequestFilters = useMemo<IAdminUserListFilters>(
		() => ({
			...filters,
			deletedOnly: true
		}),
		[filters]
	)
	const itemQuantity = 10
	const {
		data,
		isLoading: isUserListLoading,
		handleSearch,
		handleClear,
		searchTerm,
		debouncedSearch,
		deleteUser,
		isDeleting,
		restoreUser,
		isRestoring
	} = useUserList(
		currentPage,
		itemQuantity,
		filters,
		!isCurrentUserLoading
	)
	const { data: deletedData, isLoading: isDeletedUserListLoading } =
		useUserList(
			deletedCurrentPage,
			itemQuantity,
			deletedRequestFilters,
			!isCurrentUserLoading && isDev,
			debouncedSearch
		)
	const isLoading = isCurrentUserLoading || isUserListLoading

	//Pagination settings
	const activePage = data?.items ?? []
	const deletedResponseItems = deletedData?.items ?? []
	const isDeletedResponseCompatible = deletedResponseItems.every(
		user => typeof user.deletedAt === 'string'
	)
	const deletedPage = isDeletedResponseCompatible
		? deletedResponseItems
		: []
	const totalItems = data?.total ?? 0
	const totalPages = data?.totalPages ?? currentPage
	const deletedTotalItems = isDeletedResponseCompatible
		? (deletedData?.total ?? 0)
		: 0
	const deletedTotalPages = isDeletedResponseCompatible
		? (deletedData?.totalPages ?? deletedCurrentPage)
		: 1
	const loadingRows = Array.from({ length: 5 }, (_, index) => index)
	const listPage = Array.from({ length: totalPages }, (_, i) => i + 1)
	const deletedListPage = Array.from(
		{ length: deletedTotalPages },
		(_, index) => index + 1
	)

	useEffect(() => {
		setCurrentPage(1)
		setDeletedCurrentPage(1)
	}, [filters, searchTerm])

	useEffect(() => {
		if (currentPage > totalPages) {
			setCurrentPage(totalPages)
		}
	}, [currentPage, totalPages])

	useEffect(() => {
		if (deletedCurrentPage > deletedTotalPages) {
			setDeletedCurrentPage(deletedTotalPages)
		}
	}, [deletedCurrentPage, deletedTotalPages])

	const prevPage = () => {
		if (currentPage !== 1) {
			setCurrentPage(prev => prev - 1)
		} else {
			return
		}
	}

	const changeActivePage = (activePage: number) =>
		setCurrentPage(activePage)

	const nextPage = () => {
		if (currentPage !== totalPages) {
			setCurrentPage(prev => prev + 1)
		} else {
			return
		}
	}

	const deletedPrevPage = () => {
		setDeletedCurrentPage(page => Math.max(1, page - 1))
	}

	const deletedNextPage = () => {
		setDeletedCurrentPage(page => Math.min(deletedTotalPages, page + 1))
	}

	const loginMethodLabels: Record<UserLoginMethod, string> = {
		EMAIL: 'Email',
		PHONE: 'Телефон',
		GOOGLE: 'Google',
		GITHUB: 'GitHub',
		YANDEX: 'Яндекс',
		VK: 'VK',
		TELEGRAM: 'Telegram'
	}

	const getLoginMethods = (user: (typeof activePage)[number]) => {
		return (
			user.loginMethods?.map(method => loginMethodLabels[method]) ?? []
		)
	}

	const getRoleLabels = (user: (typeof activePage)[number]) => {
		return user.rights
	}

	const deleteTarget = activePage.find(user => user.id === deleteTargetId)
	const deleteTargetLabel =
		deleteTarget?.name ||
		deleteTarget?.email ||
		deleteTarget?.phone ||
		deleteTargetId ||
		'пользователя'
	const restoreTarget = deletedPage.find(
		user => user.id === restoreTargetId
	)
	const restoreTargetLabel =
		restoreTarget?.name ||
		restoreTarget?.email ||
		restoreTarget?.phone ||
		restoreTargetId ||
		'пользователя'

	const confirmDelete = () => {
		if (!deleteTargetId) return

		deleteUser(deleteTargetId)
		setDeleteTargetId(null)
	}

	const confirmRestore = () => {
		if (!restoreTargetId) return

		restoreUser(restoreTargetId)
		setRestoreTargetId(null)
	}

	const applyFilters = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		setFilters(normalizeUserFilters(filterDraft))
		setCurrentPage(1)
		setDeletedCurrentPage(1)
		toast.success('Фильтры пользователей применены')
	}

	const resetFilters = () => {
		setFilterDraft(DEFAULT_USER_FILTERS)
		setFilters({})
		setCurrentPage(1)
		setDeletedCurrentPage(1)
		toast.success('Фильтры пользователей сброшены')
	}

	return (
		<section className={styles.wrapper}>
			{deleteTargetId && (
				<ConfirmDialog
					title="Удалить пользователя?"
					message={`Пользователь ${deleteTargetLabel} будет помечен как удалённый, деактивирован и перемещён в DEV-only список удалённых. Данные останутся в базе, и DEV сможет восстановить запись. После восстановления аккаунт останется деактивированным и потребует отдельной активации.`}
					confirmLabel="Удалить"
					cancelLabel="Отмена"
					onConfirm={confirmDelete}
					onCancel={() => setDeleteTargetId(null)}
				/>
			)}
			{restoreTargetId && isDev && (
				<ConfirmDialog
					title="Восстановить пользователя?"
					message={`Запись пользователя ${restoreTargetLabel} снова станет видна администраторам. Аккаунт останется деактивированным: доступ, старые сессии и состояние виджетов автоматически не восстановятся.`}
					confirmLabel="Восстановить"
					cancelLabel="Отмена"
					onConfirm={confirmRestore}
					onCancel={() => setRestoreTargetId(null)}
				/>
			)}
			<Heading text="Панель администратора" />
			<AdminNavigation />
			<AdminHeader
				handleSearch={handleSearch}
				searchTerm={searchTerm}
				handleClear={handleClear}
			/>
			<AdminSectionHeading
				text="Список пользователей"
				title="Управление пользователями"
				description="Список аккаунтов с контактами, способами входа, ролями и действиями администратора."
				risk="high"
				riskText="Soft delete деактивирует аккаунт и отключает доступ, но сохраняет данные. Восстановить запись может только DEV, при этом аккаунт не активируется автоматически."
			/>
			<form className={styles.filters} onSubmit={applyFilters}>
				<div className={styles['filter-grid']}>
					<label className={styles['filter-field']}>
						<span className={styles['filter-label']}>Роль</span>
						<select
							className={styles['filter-input']}
							value={filterDraft.role}
							onChange={event =>
								setFilterDraft(prev => ({
									...prev,
									role: event.target.value as UserRoleFilter
								}))
							}
						>
							{ROLE_FILTER_OPTIONS.map(option => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label className={styles['filter-field']}>
						<span className={styles['filter-label']}>Подписка</span>
						<select
							className={styles['filter-input']}
							value={filterDraft.subscription}
							onChange={event =>
								setFilterDraft(prev => ({
									...prev,
									subscription: event.target
										.value as UserSubscriptionFilter
								}))
							}
						>
							{SUBSCRIPTION_FILTER_OPTIONS.map(option => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label className={styles['filter-field']}>
						<span className={styles['filter-label']}>Регистрация с</span>
						<input
							className={styles['filter-input']}
							type="date"
							value={filterDraft.registeredFrom}
							onChange={event =>
								setFilterDraft(prev => ({
									...prev,
									registeredFrom: event.target.value
								}))
							}
						/>
					</label>
					<label className={styles['filter-field']}>
						<span className={styles['filter-label']}>Регистрация по</span>
						<input
							className={styles['filter-input']}
							type="date"
							value={filterDraft.registeredTo}
							onChange={event =>
								setFilterDraft(prev => ({
									...prev,
									registeredTo: event.target.value
								}))
							}
						/>
					</label>
				</div>
				<div className={styles['filter-actions']}>
					<button type="submit" className={styles['filter-apply']}>
						Применить
					</button>
					<button
						type="button"
						className={styles['filter-reset']}
						onClick={resetFilters}
					>
						Сбросить
					</button>
				</div>
			</form>
			{isLoading ? (
				<div className={styles['list-section']}>
					<div className={styles['list-meta']}>
						<div className={styles['loading-meta-block']}>
							<SkeletonLoader
								count={1}
								className={styles['loading-meta-title']}
							/>
							<SkeletonLoader
								count={1}
								className={styles['loading-meta-subtitle']}
							/>
						</div>
						<SkeletonLoader
							count={1}
							className={styles['loading-meta-side']}
						/>
					</div>
					<div className={styles['mobile-list']}>
						{loadingRows.map(item => (
							<div key={item} className={styles['loading-card']}>
								<div className={styles['loading-card-header']}>
									<div className={styles['loading-card-main']}>
										<SkeletonLoader
											count={1}
											className={styles['loading-card-title']}
										/>
										<SkeletonLoader
											count={1}
											className={styles['loading-card-id']}
										/>
									</div>
									<SkeletonLoader
										count={1}
										className={styles['loading-card-actions']}
									/>
								</div>
								<div className={styles['loading-card-body']}>
									<SkeletonLoader
										count={1}
										className={styles['loading-card-line']}
									/>
									<SkeletonLoader
										count={1}
										className={styles['loading-card-line']}
									/>
									<SkeletonLoader
										count={1}
										className={styles['loading-card-line-short']}
									/>
									<SkeletonLoader
										count={1}
										className={styles['loading-card-line']}
									/>
									<SkeletonLoader
										count={1}
										className={styles['loading-card-line-short']}
									/>
								</div>
							</div>
						))}
					</div>
					<div className={styles['table-scroll']}>
						<table className={styles.table}>
							<caption className="srOnly">
								Заглушка списка пользователей в состоянии загрузки
							</caption>
							<thead>
								<tr>
									<th scope="col">ID</th>
									<th scope="col">Имя</th>
									<th scope="col">Email</th>
									<th scope="col">Телефон</th>
									<th scope="col">Способы входа</th>
									<th scope="col">Роли</th>
									<th scope="col">Дата регистрации</th>
									<th scope="col">Действия</th>
								</tr>
							</thead>
							<tbody>
								{loadingRows.map(item => (
									<tr key={item}>
										<td>
											<SkeletonLoader
												count={1}
												className={styles['loading-table-line']}
											/>
										</td>
										<td>
											<SkeletonLoader
												count={1}
												className={styles['loading-table-line-short']}
											/>
										</td>
										<td>
											<SkeletonLoader
												count={1}
												className={styles['loading-table-line']}
											/>
										</td>
										<td>
											<SkeletonLoader
												count={1}
												className={styles['loading-table-line-short']}
											/>
										</td>
										<td>
											<SkeletonLoader
												count={1}
												className={styles['loading-badge']}
											/>
										</td>
										<td>
											<div className={styles['loading-roles']}>
												<SkeletonLoader
													count={1}
													className={styles['loading-role']}
												/>
												<SkeletonLoader
													count={1}
													className={styles['loading-role']}
												/>
											</div>
										</td>
										<td>
											<SkeletonLoader
												count={1}
												className={styles['loading-table-line-short']}
											/>
										</td>
										<td>
											<SkeletonLoader
												count={1}
												className={styles['loading-card-actions']}
											/>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			) : totalItems ? (
				<div className={styles['list-section']}>
					<div className={styles['list-meta']}>
						<div>
							<p className={styles['meta-title']}>Пользователи</p>
							<p className={styles['meta-subtitle']}>
								Всего записей: {totalItems}
							</p>
						</div>
						<p className={styles['meta-subtitle']}>
							Показано {activePage.length} из {totalItems}
						</p>
					</div>
					<div className={styles['mobile-list']}>
						{activePage.map(user => {
							const loginMethods = getLoginMethods(user)
							const roles = getRoleLabels(user)
							const isDeleted = Boolean(user.deletedAt)

							return (
								<div
									key={user.id}
									className={clsx(
										styles['user-card'],
										isDeleted && styles['deleted-card']
									)}
								>
									<div className={styles['user-card-header']}>
										<div className={styles['user-card-main']}>
											<p className={styles['user-card-title']}>
												{user.name || 'Пользователь без имени'}
											</p>
											<p
												className={styles['user-card-id']}
												title={user.id}
											>
												ID: {user.id}
											</p>
											{isDeleted && user.deletedAt && (
												<div className={styles['deleted-state']}>
													<span className={styles['deleted-badge']}>
														Удалён (soft delete)
													</span>
													<span className={styles['deleted-date']}>
														Удалён: {formatDeletedAt(user.deletedAt)}
													</span>
												</div>
											)}
										</div>
										{(!isDeleted || isDev) && (
											<AdminActions
												editUrl={`${ADMIN_PAGES.USER}/edit/${user.id}`}
												userId={user.id}
												onDelete={
													isDeleted ? undefined : setDeleteTargetId
												}
												onRestore={
													isDeleted ? setRestoreTargetId : undefined
												}
												disabled={isDeleting || isRestoring}
											/>
										)}
									</div>
									<div className={styles['user-card-body']}>
										<div className={styles['user-card-row']}>
											<span className={styles['card-label']}>Email</span>
											<span
												className={styles['card-value']}
												title={user.email || 'Нет данных'}
											>
												{user.email || 'Нет данных'}
											</span>
										</div>
										<div className={styles['user-card-row']}>
											<span className={styles['card-label']}>Телефон</span>
											<span
												className={styles['card-value']}
												title={user.phone || 'Нет данных'}
											>
												{user.phone || 'Нет данных'}
											</span>
										</div>
										<div className={styles['user-card-row']}>
											<span className={styles['card-label']}>
												Способы входа
											</span>
											<div className={styles['methods-list']}>
												{loginMethods.length ? (
													loginMethods.map(method => (
														<span
															key={`${user.id}-${method}`}
															className={styles['method-badge']}
														>
															{method}
														</span>
													))
												) : (
													<span
														className={clsx(
															styles['method-badge'],
															styles['method-badge-empty']
														)}
													>
														Не привязаны
													</span>
												)}
											</div>
										</div>
										<div className={styles['user-card-row']}>
											<span className={styles['card-label']}>Роли</span>
											<div className={styles['roles-list']}>
												{roles.length ? (
													roles.map(role => (
														<span
															key={role}
															className={styles['role-badge']}
														>
															{role}
														</span>
													))
												) : (
													<span className={styles['card-value']}>
														Нет данных
													</span>
												)}
											</div>
										</div>
										<div className={styles['user-card-row']}>
											<span className={styles['card-label']}>
												Дата регистрации
											</span>
											<span className={styles['card-value']}>
												{user.createdAt.replace(/\T.*/, '')}
											</span>
										</div>
									</div>
								</div>
							)
						})}
					</div>
					<div className={styles['table-scroll']}>
						<table className={styles.table}>
							<caption className="srOnly">Таблица пользователей</caption>
							<thead>
								<tr>
									<th scope="col">ID</th>
									<th scope="col">Имя</th>
									<th scope="col">Email</th>
									<th scope="col">Телефон</th>
									<th scope="col">Способы входа</th>
									<th scope="col">Роли</th>
									<th scope="col">Дата регистрации</th>
									<th scope="col">Действия</th>
								</tr>
							</thead>
							<tbody>
								{activePage.map(user => {
									const loginMethods = getLoginMethods(user)
									const roles = getRoleLabels(user)
									const isDeleted = Boolean(user.deletedAt)

									return (
										<tr
											key={user.id}
											className={clsx(isDeleted && styles['deleted-row'])}
										>
											<td title={user.id}>
												<span className={styles.truncate}>{user.id}</span>
											</td>
											<td title={user.name || 'Нет данных'}>
												<span className={styles.truncate}>
													{user.name || 'Нет данных'}
												</span>
												{isDeleted && user.deletedAt && (
													<div className={styles['deleted-state']}>
														<span className={styles['deleted-badge']}>
															Удалён (soft delete)
														</span>
														<span className={styles['deleted-date']}>
															Удалён: {formatDeletedAt(user.deletedAt)}
														</span>
													</div>
												)}
											</td>
											<td title={user.email || 'Нет данных'}>
												<span className={styles.truncate}>
													{user.email || 'Нет данных'}
												</span>
											</td>
											<td title={user.phone || 'Нет данных'}>
												<span className={styles.truncate}>
													{user.phone || 'Нет данных'}
												</span>
											</td>
											<td>
												<div className={styles['methods-list']}>
													{loginMethods.length ? (
														loginMethods.map(method => (
															<span
																key={`${user.id}-${method}`}
																className={styles['method-badge']}
															>
																{method}
															</span>
														))
													) : (
														<span
															className={clsx(
																styles['method-badge'],
																styles['method-badge-empty']
															)}
														>
															Не привязаны
														</span>
													)}
												</div>
											</td>
											<td>
												<div className={styles['roles-list']}>
													{roles.length ? (
														roles.map(role => (
															<span
																key={role}
																className={styles['role-badge']}
															>
																{role}
															</span>
														))
													) : (
														<span className={styles.truncate}>
															Нет данных
														</span>
													)}
												</div>
											</td>
											<td>{user.createdAt.replace(/\T.*/, '')}</td>
											<td>
												<div className={styles['actions-cell']}>
													{(!isDeleted || isDev) && (
														<AdminActions
															editUrl={`${ADMIN_PAGES.USER}/edit/${user.id}`}
															userId={user.id}
															onDelete={
																isDeleted ? undefined : setDeleteTargetId
															}
															onRestore={
																isDeleted ? setRestoreTargetId : undefined
															}
															disabled={isDeleting || isRestoring}
														/>
													)}
												</div>
											</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>
					{totalItems > itemQuantity && (
						<Pagination
							listPage={listPage}
							currentPage={currentPage}
							prevPage={prevPage}
							nextPage={nextPage}
							changeActivePage={changeActivePage}
						/>
					)}
				</div>
			) : (
				<div className={styles['empty-state']}>
					<p className={styles['meta-title']}>Пользователи не найдены</p>
					<p className={styles['meta-subtitle']}>
						Попробуйте изменить строку поиска или очистить фильтр.
					</p>
				</div>
			)}
			{!isCurrentUserLoading && (
				<DeletedUsersSection
					isDev={isDev}
					isLoading={isDeletedUserListLoading}
					users={deletedPage}
					totalItems={deletedTotalItems}
					itemQuantity={itemQuantity}
					currentPage={deletedCurrentPage}
					listPage={deletedListPage}
					isActionPending={isDeleting || isRestoring}
					onRestore={setRestoreTargetId}
					onPrevPage={deletedPrevPage}
					onNextPage={deletedNextPage}
					onChangePage={setDeletedCurrentPage}
				/>
			)}
		</section>
	)
}

interface DeletedUsersSectionProps {
	isDev: boolean
	isLoading: boolean
	users: IUser[]
	totalItems: number
	itemQuantity: number
	currentPage: number
	listPage: number[]
	isActionPending: boolean
	onRestore: (userId: string) => void
	onPrevPage: () => void
	onNextPage: () => void
	onChangePage: (page: number) => void
}

const DeletedUsersSection = ({
	isDev,
	isLoading,
	users,
	totalItems,
	itemQuantity,
	currentPage,
	listPage,
	isActionPending,
	onRestore,
	onPrevPage,
	onNextPage,
	onChangePage
}: DeletedUsersSectionProps) => {
	return (
		<div className={styles['deleted-users-section']}>
			<div className={styles['deleted-section-header']}>
				<div>
					<p className={styles['meta-title']}>Удалённые пользователи</p>
					<p className={styles['meta-subtitle']}>
						Soft-deleted записи хранятся отдельно от рабочего списка.
					</p>
				</div>
				<AdminTooltip
					title="Доступ к удалённым пользователям"
					description="Содержимое этого списка и восстановление доступны только роли DEV."
					risk="high"
					riskText="После восстановления пользователь останется деактивированным."
				/>
			</div>

			{!isDev ? (
				<LockedDeletedUsersPreview />
			) : isLoading ? (
				<div className={styles['list-section']}>
					<div className={styles['list-meta']}>
						<div className={styles['loading-meta-block']}>
							<SkeletonLoader
								count={1}
								className={styles['loading-meta-title']}
							/>
							<SkeletonLoader
								count={1}
								className={styles['loading-meta-subtitle']}
							/>
						</div>
					</div>
					<div className={styles['deleted-loading-list']}>
						{[0, 1, 2].map(item => (
							<SkeletonLoader
								key={item}
								count={1}
								className={styles['deleted-loading-row']}
							/>
						))}
					</div>
				</div>
			) : totalItems ? (
				<div className={styles['list-section']}>
					<div className={styles['list-meta']}>
						<div>
							<p className={styles['meta-title']}>
								Доступно для восстановления
							</p>
							<p className={styles['meta-subtitle']}>
								Всего записей: {totalItems}
							</p>
						</div>
						<p className={styles['meta-subtitle']}>
							Показано {users.length} из {totalItems}
						</p>
					</div>

					<div className={styles['deleted-user-list']}>
						{users.map(user => (
							<div key={user.id} className={styles['deleted-user-row']}>
								<div className={styles['deleted-user-identity']}>
									<p className={styles['user-card-title']}>
										{user.name || 'Пользователь без имени'}
									</p>
									<p className={styles['user-card-id']} title={user.id}>
										ID: {user.id}
									</p>
									<span className={styles['deleted-badge']}>
										Удалён (soft delete)
									</span>
								</div>
								<div className={styles['deleted-user-contacts']}>
									<span title={user.email || 'Нет данных'}>
										{user.email || 'Нет данных'}
									</span>
									<span title={user.phone || 'Нет данных'}>
										{user.phone || 'Нет данных'}
									</span>
								</div>
								<div className={styles['roles-list']}>
									{user.rights.map(role => (
										<span key={role} className={styles['role-badge']}>
											{role}
										</span>
									))}
								</div>
								<span className={styles['deleted-date']}>
									{user.deletedAt
										? formatDeletedAt(user.deletedAt)
										: 'Нет данных'}
								</span>
								<AdminActions
									editUrl={`${ADMIN_PAGES.USER}/edit/${user.id}`}
									userId={user.id}
									onRestore={onRestore}
									disabled={isActionPending}
								/>
							</div>
						))}
					</div>

					{totalItems > itemQuantity && (
						<Pagination
							listPage={listPage}
							currentPage={currentPage}
							prevPage={onPrevPage}
							nextPage={onNextPage}
							changeActivePage={onChangePage}
						/>
					)}
				</div>
			) : (
				<div className={styles['empty-state']}>
					<p className={styles['meta-title']}>
						Удалённых пользователей нет
					</p>
					<p className={styles['meta-subtitle']}>
						Soft-deleted записи появятся здесь.
					</p>
				</div>
			)}
		</div>
	)
}

const LockedDeletedUsersPreview = () => (
	<div
		className={clsx(
			styles['list-section'],
			styles['locked-deleted-section']
		)}
		aria-disabled="true"
	>
		<div className={styles['locked-deleted-preview']} aria-hidden="true">
			<div className={styles['list-meta']}>
				<div>
					<p className={styles['meta-title']}>
						Доступно для восстановления
					</p>
					<p className={styles['meta-subtitle']}>Удалённые записи</p>
				</div>
			</div>
			<div className={styles['locked-deleted-rows']}>
				{[0, 1, 2].map(item => (
					<div key={item} className={styles['locked-deleted-row']}>
						<span>Удалённый пользователь</span>
						<span>Контактные данные</span>
						<span>Дата удаления</span>
						<button type="button" disabled>
							Восстановить
						</button>
					</div>
				))}
			</div>
		</div>
		<div className={styles['locked-deleted-overlay']}>
			<span className={styles['locked-deleted-badge']}>
				Восстановление доступно только роли DEV
			</span>
			<AdminTooltip
				title="DEV-only блок"
				description="ADMIN видит только наличие раздела. Данные этого списка и действие восстановления backend отдаёт только роли DEV."
			/>
		</div>
	</div>
)

export default UserList
