export const validEmail =
	/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/

export const validPassword = /(?=.*[0-9])(?=.*[a-z])(?=.*[A-Z])\S{6,}/g

export const validName = /^[a-zA-Z][a-zA-Z0-9-]+$/

export const validPhone = /^[0-9+()\-\s]{10,20}$/

export const validPhoneCode = /^\d{4,6}$/
