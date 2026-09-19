export {
	COMPANY_NAME_LIMIT,
	normalizeCompanyName,
	parseWorkspaceBranding,
	type BrandingCommand,
	type BrandingResponse,
	type WorkspaceBranding
} from './model/branding.contract'
export {
	getWorkspaceBranding,
	updateWorkspaceBranding
} from './api/branding.api'
export { useWorkspaceBranding } from './model/use-workspace-branding'
