import { Type } from 'class-transformer';
import {
	ArrayMaxSize,
	ArrayMinSize,
	ArrayUnique,
	Equals,
	IsDefined,
	IsArray,
	IsIn,
	IsInt,
	IsString,
	IsUUID,
	Matches,
	Max,
	MaxLength,
	Min,
	ValidateIf,
	ValidateNested
} from 'class-validator';

export class CommerceWorkspaceQuery {
	@IsUUID('4') workspaceId!: string;
}

export class CommerceListQuery extends CommerceWorkspaceQuery {
	@Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
	@Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 50;
	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@MaxLength(100)
	search?: string;
	@ValidateIf((_object, value) => value !== undefined)
	@IsIn(['true'])
	includeArchived?: 'true';
}

export class CommercePeriodQuery extends CommerceWorkspaceQuery {
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
	from!: string;
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
	to!: string;
	@ValidateIf((_object, value) => value !== undefined)
	@IsUUID('4')
	pipelineId?: string;
}

export class CommerceHistoryQuery extends CommerceWorkspaceQuery {
	@ValidateIf((_object, value) => value !== undefined)
	@IsUUID('4')
	dealId?: string;
}

export class CommerceExportQuery extends CommerceWorkspaceQuery {
	@IsIn(['json', 'csv']) format!: 'json' | 'csv';
}

export class CommerceCommandDto {
	@Equals(1) schemaVersion!: 1;
	@IsUUID('4') workspaceId!: string;
	@IsUUID('4') commandId!: string;
}

export class CommerceVersionedCommandDto extends CommerceCommandDto {
	@IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
}

export class CreatePipelineDto extends CommerceCommandDto {
	@IsString() @Matches(/\S/) @MaxLength(200) name!: string;
	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@MaxLength(64)
	templateKey?: string;
	@ValidateIf((_object, value) => value !== undefined)
	@IsInt()
	@Min(1)
	@Max(32767)
	templateVersion?: number;
}

export class RenamePipelineDto extends CommerceVersionedCommandDto {
	@IsString() @Matches(/\S/) @MaxLength(200) name!: string;
}

export class AddStageDto extends CommerceVersionedCommandDto {
	@IsString() @Matches(/\S/) @MaxLength(200) name!: string;
	@IsIn(['OPEN', 'WON', 'LOST']) state!: 'OPEN' | 'WON' | 'LOST';
}

export class RenameStageDto extends RenamePipelineDto {}

export class ReorderStagesDto extends CommerceVersionedCommandDto {
	@IsUUID('4', { each: true })
	@ArrayMinSize(3)
	@ArrayMaxSize(100)
	@ArrayUnique()
	stageIds!: string[];
}

export class CatalogCreateDto extends CommerceCommandDto {
	@IsIn(['PRODUCT', 'SERVICE']) kind!: 'PRODUCT' | 'SERVICE';
	@IsString() @Matches(/\S/) @MaxLength(200) name!: string;
	@IsString() @Matches(/\S/) @MaxLength(32) unit!: string;
	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@Matches(/\S/)
	@MaxLength(100)
	code?: string;
	@ValidateIf((_object, value) => value !== undefined && value !== null)
	@IsInt()
	@Min(0)
	@Max(2147483647)
	basePriceMinor?: number | null;
}

export class CatalogUpdateDto extends CommerceVersionedCommandDto {
	@ValidateIf((_object, value) => value !== undefined)
	@IsIn(['PRODUCT', 'SERVICE'])
	kind?: 'PRODUCT' | 'SERVICE';
	@IsString() @Matches(/\S/) @MaxLength(200) name!: string;
	@IsString() @Matches(/\S/) @MaxLength(32) unit!: string;
	@ValidateIf((_object, value) => value !== undefined && value !== null)
	@IsInt()
	@Min(0)
	@Max(2147483647)
	basePriceMinor?: number | null;
}

export class CatalogArchiveDto extends CommerceVersionedCommandDto {}

export class DealLineDto {
	@ValidateIf((_object, value) => value !== undefined) @IsUUID('4') id?: string;
	@ValidateIf((_object, value) => value !== undefined && value !== null)
	@IsUUID('4')
	catalogItemId?: string | null;
	@IsIn(['PRODUCT', 'SERVICE']) kind!: 'PRODUCT' | 'SERVICE';
	@IsString() @Matches(/\S/) @MaxLength(200) name!: string;
	@IsString() @Matches(/\S/) @MaxLength(32) unit!: string;
	@IsString() @Matches(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/) quantity!: string;
	@IsInt() @Min(0) @Max(2147483647) unitPriceMinor!: number;
	@ValidateIf((_object, value) => value !== undefined)
	@IsInt()
	@Min(0)
	@Max(2147483647)
	discountMinor?: number;
}

export class ReplaceDealLinesDto extends CommerceVersionedCommandDto {
	@IsDefined()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => DealLineDto)
	@ArrayMaxSize(100)
	lines!: DealLineDto[];
	@ValidateIf((_object, value) => value !== undefined)
	@IsInt()
	@Min(0)
	@Max(2147483647)
	manualAmountMinor?: number;
}

export class SaveLineToCatalogDto extends CommerceVersionedCommandDto {
	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@Matches(/\S/)
	@MaxLength(100)
	code?: string;
}

export class PaymentFieldsDto {
	@IsIn(['RECEIPT', 'REFUND']) kind!: 'RECEIPT' | 'REFUND';
	@IsInt() @Min(1) @Max(2147483647) amountMinor!: number;
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
	occurredAt!: string;
	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@MaxLength(1000)
	comment?: string;
}

export class AddPaymentDto extends CommerceCommandDto {
	@IsIn(['RECEIPT', 'REFUND']) kind!: 'RECEIPT' | 'REFUND';
	@IsInt() @Min(1) @Max(2147483647) amountMinor!: number;
	@IsString()
	@Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
	occurredAt!: string;
	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@MaxLength(1000)
	comment?: string;
}

export class CorrectPaymentDto extends CommerceCommandDto {
	@IsDefined()
	@ValidateNested()
	@Type(() => PaymentFieldsDto)
	replacement!: PaymentFieldsDto;
}

export class CreateQuoteDto extends CommerceCommandDto {
	@IsString() @Matches(/\S/) @MaxLength(200) sellerName!: string;
	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@MaxLength(1000)
	sellerDetails?: string;
	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@MaxLength(1000)
	customerDetails?: string;
}

export class ImportMappingDto {
	@IsString() @MaxLength(200) code!: string;
	@IsString() @MaxLength(200) kind!: string;
	@IsString() @MaxLength(200) name!: string;
	@IsString() @MaxLength(200) unit!: string;
	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@MaxLength(200)
	basePriceMinor?: string;
}

export class ImportFileDto {
	@IsUUID('4') workspaceId!: string;
	@ValidateIf((_object, value) => value !== undefined)
	@Equals(1)
	schemaVersion?: 1;
	@IsString() @Matches(/\S/) @MaxLength(200) filename!: string;
	@IsString()
	@Matches(/^[A-Za-z0-9+/]*={0,2}$/)
	@MaxLength(1333344)
	contentBase64!: string;
}

export class ImportInspectDto extends ImportFileDto {}
export class ImportPreviewDto extends ImportFileDto {
	@ValidateIf((_object, value) => value !== undefined)
	@IsString()
	@Matches(/\S/)
	@MaxLength(200)
	sheet?: string;
	@IsDefined()
	@ValidateNested()
	@Type(() => ImportMappingDto)
	mapping!: ImportMappingDto;
}

export class ImportApplyDto extends CommerceCommandDto {
	@IsUUID('4') previewId!: string;
}
