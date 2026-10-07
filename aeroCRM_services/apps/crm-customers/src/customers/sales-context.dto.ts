import { Transform } from 'class-transformer';
import {
	ArrayMaxSize,
	ArrayUnique,
	Equals,
	IsArray,
	IsString,
	IsUUID,
	MaxLength,
	MinLength
} from 'class-validator';

export class CustomersSalesSearchDto {
	@Equals(1) schemaVersion!: 1;
	@IsUUID('4') workspaceId!: string;
	@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@MinLength(1)
	@MaxLength(200)
	search!: string;
}

export class CustomersSalesPreviewDto {
	@Equals(1) schemaVersion!: 1;
	@IsUUID('4') workspaceId!: string;
	@IsArray()
	@ArrayMaxSize(100)
	@ArrayUnique()
	@IsUUID('4', { each: true })
	contactIds!: string[];
}
