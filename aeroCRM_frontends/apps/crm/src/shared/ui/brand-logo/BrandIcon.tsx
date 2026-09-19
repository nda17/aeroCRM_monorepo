import brand from '../../../../../../brand/aerocrm-wing.json'

export const BrandIcon = ({ size }: { size: number }) => (
	<svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
		<rect width="64" height="64" rx="14" fill="#4c165e" />
		<path d={brand.iconWing} fill="#efc85b" />
		<path d={brand.iconLetter} fill="#ffffff" />
	</svg>
)
