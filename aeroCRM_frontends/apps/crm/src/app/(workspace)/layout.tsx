import {
	SupportLiveUpdates,
	WorkspaceLiveUpdates
} from '@/features/live-updates/LiveUpdates'
import { AccessGate } from '@/features/crm-access-gate'
import { SessionGate } from '@/features/session-bootstrap'
import { SupportChat } from '@/features/support-chat/ui/SupportChat'
import { CrmAppShell } from '@/widgets/crm-app-shell'
import type { PropsWithChildren } from 'react'

const WorkspaceLayout = ({ children }: PropsWithChildren) => {
	return (
		<SessionGate>
			<AccessGate>
				<WorkspaceLiveUpdates />
				<CrmAppShell>{children}</CrmAppShell>
			</AccessGate>
			<SupportLiveUpdates />
			<SupportChat />
		</SessionGate>
	)
}

export default WorkspaceLayout
