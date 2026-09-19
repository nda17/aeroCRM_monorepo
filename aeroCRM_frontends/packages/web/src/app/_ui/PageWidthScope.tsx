import type { PropsWithChildren } from 'react'

const PageWidthScope = ({ children }: PropsWithChildren<unknown>) => {
	return <div className="w-full">{children}</div>
}

export default PageWidthScope
