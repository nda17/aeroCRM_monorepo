import {
	Body,
	Controller,
	Headers,
	HttpCode,
	Post,
	UseGuards
} from '@nestjs/common';
import { CustomersAuthorizationClient } from '../access/customers-authorization.client';
import { ContactIntakeOperationGuard } from '../intake-operations/intake-operation.controller';
import { CustomersService } from './customers.service';
import {
	CustomersSalesSearchDto,
	CustomersSalesPreviewDto
} from './sales-context.dto';

@Controller('internal/v1/crm-customers/sales-context')
@UseGuards(ContactIntakeOperationGuard)
export class CustomersSalesContextController {
	constructor(
		private readonly authorization: CustomersAuthorizationClient,
		private readonly customers: CustomersService
	) {}
	@Post('search')
	@HttpCode(200)
	async search(
		@Headers('authorization') bearer: string | undefined,
		@Body() dto: CustomersSalesSearchDto
	) {
		return this.customers.salesSearch(
			await this.authorization.authorize(bearer, dto.workspaceId),
			dto.search.trim()
		);
	}
	@Post('preview')
	@HttpCode(200)
	async preview(
		@Headers('authorization') bearer: string | undefined,
		@Body() dto: CustomersSalesPreviewDto
	) {
		return this.customers.salesPreview(
			await this.authorization.authorize(bearer, dto.workspaceId),
			dto.contactIds
		);
	}
}
