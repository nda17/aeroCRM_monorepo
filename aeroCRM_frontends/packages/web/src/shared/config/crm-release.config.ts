// Frontend publication does not release the CRM backend or enable sales.
// Change only with the compatible Gateway, Identity, Billing and CRM rollout.
export const CRM_RELEASE = {
	apiEnabled: true,
	billingEnabled:
		process.env.NEXT_PUBLIC_CRM_BILLING_ENABLED === 'true',
	appUrl: 'https://workspace.aerocrm.space',
	unavailableLabel: 'Скоро'
} as const

// Local interactive QA stays within the two development origins. This is
// navigation only: neither the backend release nor billing gate is enabled.
export const getCrmAppUrl = () =>
	process.env.NODE_ENV === 'development'
		? 'http://localhost:3001'
		: CRM_RELEASE.appUrl
