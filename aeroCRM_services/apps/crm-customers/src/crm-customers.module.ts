import { CustomersSalesContextController } from "./customers/sales-context.controller";
import {
  MailController,
  MailUploadScopeGuard,
  MailIntakeSourceController,
} from "./mail/mail.controller";
import { MailService } from "./mail/mail.service";
import { MailAuthorizationClient } from "./mail/mail-authorization.client";
import { MailConfig, mailRole } from "./mail/mail.config";
import { MailTransport } from "./mail/mail.transport";
import { MailObjects } from "./mail/mail.objects";
import { MailWorker } from "./mail/mail.worker";
import { APP_FILTER } from "@nestjs/core";
import {
  WorkspaceClosureController,
  WorkspaceClosureErrorFilter,
  WorkspaceClosureService,
  WorkspaceClosureInternalGuard,
} from "./workspace-closure/workspace-closure.controller";
import { LiveChangesService } from "./live/live-changes.service";
import { LiveChangesController } from "./live/live-changes.controller";
import { Module } from "@nestjs/common";
import { CustomersExportController } from "./exports/export.controller";
import { CustomersExportService } from "./exports/export.service";
import { CustomerImportController } from "./imports/import.controller";
import { CustomerImportService } from "./imports/import.service";
import { ConfigModule } from "@nestjs/config";
import { CrmCustomersHealthController } from "./health/crm-customers-health.controller";
import { CrmCustomersHealthService } from "./health/crm-customers-health.service";
import { CrmCustomersPrismaModule } from "./prisma/crm-customers-prisma.module";
import { CustomersAuthorizationClient } from "./access/customers-authorization.client";
import { CustomersController } from "./customers/customers.controller";
import { CustomersService } from "./customers/customers.service";
import { CompaniesV2Controller } from "./customers/companies-v2.controller";
import { ContactsV2Controller } from "./customers/contacts-v2.controller";
import { CompanyLookupController } from "./company-lookup/company-lookup.controller";
import { CompanyLookupService } from "./company-lookup/company-lookup.service";
import { CompanyLookupProvider } from "./company-lookup/company-lookup.provider";
import { DadataCompanyLookupAdapter } from "./company-lookup/dadata-company-lookup.adapter";
import { ContactIntakeOperationService } from "./intake-operations/intake-operation.service";
import {
  ContactIntakeOperationController,
  ContactIntakeOperationGuard,
} from "./intake-operations/intake-operation.controller";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CrmCustomersPrismaModule],
  controllers:
    mailRole() === "api"
      ? [
          MailController,
          MailIntakeSourceController,
          LiveChangesController,
          CrmCustomersHealthController,
          CustomersController,
          CustomersSalesContextController,
          CompaniesV2Controller,
          ContactsV2Controller,
          CompanyLookupController,
          CustomersExportController,
          CustomerImportController,
          ContactIntakeOperationController,
          WorkspaceClosureController,
        ]
      : [CrmCustomersHealthController],
  providers: [
    MailService,
    MailAuthorizationClient,
    MailConfig,
    MailTransport,
    MailObjects,
    MailWorker,
    CrmCustomersHealthService,
    ...(mailRole() === "api"
      ? [
          MailUploadScopeGuard,
          LiveChangesService,
          CustomersAuthorizationClient,
          CustomersService,
          CompanyLookupService,
          {
            provide: CompanyLookupProvider,
            useClass: DadataCompanyLookupAdapter,
          },
          CustomersExportService,
          CustomerImportService,
          ContactIntakeOperationService,
          ContactIntakeOperationGuard,
          WorkspaceClosureService,
          WorkspaceClosureInternalGuard,
          { provide: APP_FILTER, useClass: WorkspaceClosureErrorFilter },
        ]
      : []),
  ],
})
export class CrmCustomersModule {}
