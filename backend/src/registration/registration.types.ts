export type LegalDocumentType = "TERMS" | "PRIVACY_POLICY";

export type LegalDocument = {
  id: string;
  documentType: LegalDocumentType;
  version: string;
  title: string;
  contentUrl: string;
  effectiveAt: string;
};

export type RegistrationResult = {
  user: {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    status: "ACTIVE";
    createdAt: string;
  };
  wallet: {
    id: string;
    walletNumber: string;
    currency: "INR";
    balanceMinor: 0;
    status: "ACTIVE";
  };
};
