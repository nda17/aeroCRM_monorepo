import { SessionGate } from '@/features/session-bootstrap'
import { BillingScreen } from '@/screens/billing'

export default function BillingReturnPage() {
	return (
		<SessionGate>
			<BillingScreen returning />
		</SessionGate>
	)
}
