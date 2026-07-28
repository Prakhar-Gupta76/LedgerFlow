import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { LegalDocument, LegalDocumentType } from "./registration.types";

type LegalDocumentRow = {
  id: string;
  document_type: LegalDocumentType;
  version: string;
  title: string;
  content_url: string;
  effective_at: Date;
};

@Injectable()
export class LegalDocumentsService {
  constructor(private readonly database: DatabaseService) {}

  async getActiveDocuments(): Promise<LegalDocument[]> {
    const result = await this.database.query<LegalDocumentRow>(`
      SELECT DISTINCT ON (document_type)
        id,
        document_type,
        version,
        title,
        content_url,
        effective_at
      FROM legal_documents
      WHERE effective_at <= NOW()
        AND (retired_at IS NULL OR retired_at > NOW())
      ORDER BY document_type, effective_at DESC
    `);

    const documents = result.rows.map((row) => ({
      id: row.id,
      documentType: row.document_type,
      version: row.version,
      title: row.title,
      contentUrl: row.content_url,
      effectiveAt: row.effective_at.toISOString(),
    }));

    const documentTypes = new Set(documents.map((document) => document.documentType));
    if (!documentTypes.has("TERMS") || !documentTypes.has("PRIVACY_POLICY")) {
      throw new ServiceUnavailableException({
        code: "LEGAL_DOCUMENTS_UNAVAILABLE",
        message: "Registration is temporarily unavailable.",
      });
    }

    return documents;
  }
}
