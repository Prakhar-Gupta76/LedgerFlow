import { Controller, Get } from "@nestjs/common";
import { LegalDocumentsService } from "./legal-documents.service";

@Controller("legal-documents")
export class LegalDocumentsController {
  constructor(private readonly legalDocuments: LegalDocumentsService) {}

  @Get("active")
  getActiveDocuments() {
    return this.legalDocuments.getActiveDocuments();
  }
}
