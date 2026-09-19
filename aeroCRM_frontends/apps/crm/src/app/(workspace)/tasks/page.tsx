import { TasksScreen } from '@/screens/tasks'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Задачи'
}

const TasksPage = () => <TasksScreen />

export default TasksPage
