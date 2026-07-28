import { Module } from "@nestjs/common";
import { LegalDocumentsController } from "./legal-documents.controller";
import { LegalDocumentsService } from "./legal-documents.service";
import { RegistrationController } from "./registration.controller";
import { RegistrationService } from "./registration.service";

@Module({
  controllers: [RegistrationController, LegalDocumentsController],
  providers: [RegistrationService, LegalDocumentsService],
})
export class RegistrationModule {}
