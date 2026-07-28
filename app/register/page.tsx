"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Fingerprint,
  LockKeyhole,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./register.module.css";

type FieldName =
  | "fullName"
  | "email"
  | "phone"
  | "password"
  | "confirmPassword"
  | "consent";

type FormValues = {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  consent: boolean;
};

type FormErrors = Partial<Record<FieldName, string>>;

type LegalDocument = {
  id: string;
  documentType: "TERMS" | "PRIVACY_POLICY";
  version: string;
  contentUrl: string;
  effectiveAt: string;
};

type RegistrationResult = {
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
    balanceMinor: number;
    status: "ACTIVE";
  };
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

const initialValues: FormValues = {
  fullName: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
  consent: false,
};

const passwordRules = [
  { label: "8+ characters", test: (value: string) => value.length >= 8 },
  { label: "Uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { label: "Number", test: (value: string) => /\d/.test(value) },
  { label: "Special character", test: (value: string) => /[^A-Za-z0-9]/.test(value) },
];

function validateField(name: FieldName, values: FormValues): string | undefined {
  switch (name) {
    case "fullName":
      if (!values.fullName.trim()) return "Enter your full name.";
      if (values.fullName.trim().length < 2) return "Use at least 2 characters.";
      if (values.fullName.trim().length > 100) return "Use 100 characters or fewer.";
      return undefined;
    case "email":
      if (!values.email.trim()) return "Enter your email address.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
        return "Enter a valid email address.";
      }
      return undefined;
    case "phone":
      if (!values.phone) return "Enter your phone number.";
      if (!/^[6-9]\d{9}$/.test(values.phone)) {
        return "Enter a valid 10-digit Indian mobile number.";
      }
      return undefined;
    case "password":
      if (!values.password) return "Create a password.";
      if (!passwordRules.every((rule) => rule.test(values.password))) {
        return "Your password does not meet all requirements.";
      }
      return undefined;
    case "confirmPassword":
      if (!values.confirmPassword) return "Confirm your password.";
      if (values.confirmPassword !== values.password) {
        return "The passwords do not match.";
      }
      return undefined;
    case "consent":
      if (!values.consent) return "Accept the terms and privacy policy to continue.";
      return undefined;
  }
}

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

export default function RegisterPage() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success">("idle");
  const [legalDocuments, setLegalDocuments] = useState<LegalDocument[]>([]);
  const [legalStatus, setLegalStatus] = useState<"loading" | "ready" | "error">("loading");
  const [submitError, setSubmitError] = useState("");
  const [registration, setRegistration] = useState<RegistrationResult | null>(null);

  const loadLegalDocuments = useCallback(async () => {
    setLegalStatus("loading");
    try {
      const response = await fetch(`${API_BASE_URL}/legal-documents/active`);
      if (!response.ok) throw new Error("Legal documents unavailable");
      const documents = (await response.json()) as LegalDocument[];
      if (
        !documents.some((document) => document.documentType === "TERMS") ||
        !documents.some((document) => document.documentType === "PRIVACY_POLICY")
      ) {
        throw new Error("Required legal documents unavailable");
      }
      setLegalDocuments(documents);
      setLegalStatus("ready");
    } catch {
      setLegalStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadLegalDocuments();
  }, [loadLegalDocuments]);

  const terms = legalDocuments.find((document) => document.documentType === "TERMS");
  const privacy = legalDocuments.find(
    (document) => document.documentType === "PRIVACY_POLICY",
  );

  const passwordScore = useMemo(
    () => passwordRules.filter((rule) => rule.test(values.password)).length,
    [values.password],
  );

  function updateValue<K extends keyof FormValues>(name: K, value: FormValues[K]) {
    const nextValues = { ...values, [name]: value };
    setValues(nextValues);

    if (touched[name]) {
      setErrors((current) => ({
        ...current,
        [name]: validateField(name, nextValues),
        ...(name === "password" && touched.confirmPassword
          ? { confirmPassword: validateField("confirmPassword", nextValues) }
          : {}),
      }));
    }
  }

  function handleBlur(name: FieldName) {
    setTouched((current) => ({ ...current, [name]: true }));
    setErrors((current) => ({
      ...current,
      [name]: validateField(name, values),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const fields: FieldName[] = [
      "fullName",
      "email",
      "phone",
      "password",
      "confirmPassword",
      "consent",
    ];
    const nextErrors = fields.reduce<FormErrors>((result, field) => {
      const error = validateField(field, values);
      if (error) result[field] = error;
      return result;
    }, {});

    setTouched(
      fields.reduce<Partial<Record<FieldName, boolean>>>((result, field) => {
        result[field] = true;
        return result;
      }, {}),
    );
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0 || legalStatus !== "ready") return;

    setStatus("submitting");
    setSubmitError("");

    try {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: values.fullName.trim().replace(/\s+/g, " "),
          email: values.email.trim().toLowerCase(),
          phoneNumber: `+91${values.phone}`,
          password: values.password,
          acceptedLegalDocumentIds: legalDocuments.map((document) => document.id),
        }),
      });

      const body = (await response.json().catch(() => null)) as
        | RegistrationResult
        | { code?: string; message?: string | string[] }
        | null;

      if (!response.ok) {
        const code = body && "code" in body ? body.code : undefined;
        if (code === "LEGAL_DOCUMENTS_CHANGED") {
          setValues((current) => ({ ...current, consent: false }));
          await loadLegalDocuments();
        }
        const message = body && "message" in body ? body.message : undefined;
        throw new Error(
          Array.isArray(message)
            ? message[0]
            : message ?? "We could not create your account. Please try again.",
        );
      }

      setRegistration(body as RegistrationResult);
      setStatus("success");
    } catch (error) {
      setStatus("idle");
      setSubmitError(
        error instanceof TypeError
          ? "Unable to reach LedgerFlow. Make sure the API is running and try again."
          : error instanceof Error
            ? error.message
            : "We could not create your account. Please try again.",
      );
    }
  }

  if (status === "success" && registration) {
    return (
      <main className={styles.page}>
        <div className={styles.successGrid}>
          <section className={styles.successPanel}>
            <Link className={styles.brand} href="/">
              <BrandMark />
              <span>LedgerFlow</span>
            </Link>

            <div className={styles.successContent}>
              <span className={styles.successIcon}>
                <CheckCircle2 size={38} strokeWidth={1.8} />
              </span>
              <span className={styles.eyebrow}>Account created</span>
              <h1>Your LedgerFlow wallet is ready.</h1>
              <p>
                Your profile and INR wallet were created together in one secure
                transaction. You can now continue to login.
              </p>

              <div className={styles.successSummary}>
                <div>
                  <span className={styles.summaryIcon}>
                    <UserRound size={18} />
                  </span>
                  <p>
                    <small>Account name</small>
                    <strong>{registration.user.fullName}</strong>
                  </p>
                </div>
                <div>
                  <span className={styles.summaryIcon}>
                    <WalletCards size={18} />
                  </span>
                  <p>
                    <small>INR wallet number</small>
                    <strong>{registration.wallet.walletNumber}</strong>
                  </p>
                </div>
              </div>

              <div className={styles.successActions}>
                <Link className={styles.primaryButton} href="/login">
                  Continue to login
                  <ArrowRight size={18} />
                </Link>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => {
                    setValues(initialValues);
                    setErrors({});
                    setTouched({});
                    setRegistration(null);
                    setSubmitError("");
                    setStatus("idle");
                  }}
                >
                  Register another account
                </button>
              </div>
            </div>
          </section>

          <aside className={styles.successAside}>
            <div className={styles.successAsideContent}>
              <ShieldCheck size={30} />
              <h2>One secure transaction.</h2>
              <p>
                Your profile, protected credentials, consent records, INR
                wallet, and welcome job were committed together—or not at all.
              </p>
            </div>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <aside className={styles.storyPanel}>
          <div className={styles.storyGlow} />
          <Link className={`${styles.brand} ${styles.brandLight}`} href="/">
            <BrandMark />
            <span>LedgerFlow</span>
          </Link>

          <div className={styles.storyContent}>
            <span className={styles.storyKicker}>A wallet built for clarity</span>
            <h1>Start moving virtual money with confidence.</h1>
            <p>
              Your LedgerFlow account gives you one clear place to fund, send,
              track, and understand every wallet movement.
            </p>

            <div className={styles.promiseList}>
              <div>
                <span><WalletCards size={19} /></span>
                <p><strong>Your INR wallet, created automatically</strong>Ready with a zero balance the moment registration completes.</p>
              </div>
              <div>
                <span><Fingerprint size={19} /></span>
                <p><strong>Credentials protected from day one</strong>Your raw password is never stored or returned.</p>
              </div>
              <div>
                <span><ShieldCheck size={19} /></span>
                <p><strong>Consent and actions stay auditable</strong>Accepted policies are tied to their exact published versions.</p>
              </div>
            </div>
          </div>

          <div className={styles.storyVisual} aria-hidden="true">
            <div className={styles.walletPreview}>
              <div className={styles.previewTop}>
                <span>YOUR NEW WALLET</span>
                <span className={styles.previewChip} />
              </div>
              <strong>₹0.00</strong>
              <small>INR · Ready after registration</small>
              <div className={styles.previewLine}>
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className={styles.secureBadge}>
              <LockKeyhole size={17} />
              Protected setup
            </div>
          </div>

          <p className={styles.storyFootnote}>
            Virtual funds only. No real money or payment credentials required.
          </p>
        </aside>

        <section className={styles.formPanel}>
          <div className={styles.formTopbar}>
            <Link className={styles.backLink} href="/">
              <ArrowLeft size={16} />
              Back to home
            </Link>
            <p>
              Already registered? <Link href="/login">Log in</Link>
            </p>
          </div>

          <div className={styles.formWrap}>
            <div className={styles.mobileBrand}>
              <Link className={styles.brand} href="/">
                <BrandMark />
                <span>LedgerFlow</span>
              </Link>
            </div>

            <div className={styles.formHeading}>
              <span className={styles.stepLabel}>Account setup · 1 of 1</span>
              <h2>Create your account</h2>
              <p>Enter your details to create your profile and first INR wallet.</p>
            </div>

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              <div className={styles.field}>
                <label htmlFor="fullName">Full name</label>
                <div className={`${styles.inputShell} ${errors.fullName ? styles.inputError : ""}`}>
                  <UserRound size={18} />
                  <input
                    id="fullName"
                    name="fullName"
                    type="text"
                    autoComplete="name"
                    placeholder="e.g. Prakhar Gupta"
                    value={values.fullName}
                    onBlur={() => handleBlur("fullName")}
                    onChange={(event) => updateValue("fullName", event.target.value)}
                    aria-invalid={Boolean(errors.fullName)}
                    aria-describedby={errors.fullName ? "fullName-error" : undefined}
                  />
                </div>
                {errors.fullName && <span id="fullName-error" className={styles.errorText}>{errors.fullName}</span>}
              </div>

              <div className={styles.field}>
                <label htmlFor="email">Email address</label>
                <div className={`${styles.inputShell} ${errors.email ? styles.inputError : ""}`}>
                  <Mail size={18} />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="you@example.com"
                    value={values.email}
                    onBlur={() => handleBlur("email")}
                    onChange={(event) => updateValue("email", event.target.value.toLowerCase())}
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? "email-error" : undefined}
                  />
                </div>
                {errors.email && <span id="email-error" className={styles.errorText}>{errors.email}</span>}
              </div>

              <div className={styles.field}>
                <label htmlFor="phone">Phone number</label>
                <div className={`${styles.inputShell} ${styles.phoneShell} ${errors.phone ? styles.inputError : ""}`}>
                  <Phone size={18} />
                  <span className={styles.countryCode}>+91</span>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel-national"
                    inputMode="numeric"
                    placeholder="98765 43210"
                    maxLength={10}
                    value={values.phone}
                    onBlur={() => handleBlur("phone")}
                    onChange={(event) =>
                      updateValue("phone", event.target.value.replace(/\D/g, "").slice(0, 10))
                    }
                    aria-invalid={Boolean(errors.phone)}
                    aria-describedby={errors.phone ? "phone-error" : "phone-help"}
                  />
                </div>
                {errors.phone ? (
                  <span id="phone-error" className={styles.errorText}>{errors.phone}</span>
                ) : (
                  <span id="phone-help" className={styles.helpText}>Used for account recovery and security alerts.</span>
                )}
              </div>

              <div className={styles.passwordGrid}>
                <div className={styles.field}>
                  <label htmlFor="password">Password</label>
                  <div className={`${styles.inputShell} ${errors.password ? styles.inputError : ""}`}>
                    <LockKeyhole size={18} />
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Create a strong password"
                      value={values.password}
                      onBlur={() => handleBlur("password")}
                      onChange={(event) => updateValue("password", event.target.value)}
                      aria-invalid={Boolean(errors.password)}
                    />
                    <button
                      className={styles.visibilityButton}
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="confirmPassword">Confirm password</label>
                  <div className={`${styles.inputShell} ${errors.confirmPassword ? styles.inputError : ""}`}>
                    <LockKeyhole size={18} />
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Repeat your password"
                      value={values.confirmPassword}
                      onBlur={() => handleBlur("confirmPassword")}
                      onChange={(event) => updateValue("confirmPassword", event.target.value)}
                      aria-invalid={Boolean(errors.confirmPassword)}
                    />
                    <button
                      className={styles.visibilityButton}
                      type="button"
                      onClick={() => setShowConfirmPassword((visible) => !visible)}
                      aria-label={showConfirmPassword ? "Hide confirmed password" : "Show confirmed password"}
                    >
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              </div>

              {(errors.password || errors.confirmPassword) && (
                <span className={styles.errorText}>
                  {errors.confirmPassword ?? errors.password}
                </span>
              )}

              <div className={styles.passwordGuide}>
                <div className={styles.strengthTop}>
                  <span>Password strength</span>
                  <strong>
                    {passwordScore === 0 && "Not started"}
                    {passwordScore === 1 && "Weak"}
                    {passwordScore === 2 && "Fair"}
                    {passwordScore === 3 && "Good"}
                    {passwordScore === 4 && "Strong"}
                  </strong>
                </div>
                <div className={styles.strengthBar} aria-hidden="true">
                  {passwordRules.map((rule, index) => (
                    <span
                      className={index < passwordScore ? styles.strengthActive : ""}
                      key={rule.label}
                    />
                  ))}
                </div>
                <div className={styles.ruleGrid}>
                  {passwordRules.map((rule) => {
                    const passed = rule.test(values.password);
                    return (
                      <span className={passed ? styles.rulePassed : ""} key={rule.label}>
                        <Check size={12} />
                        {rule.label}
                      </span>
                    );
                  })}
                </div>
              </div>

              <label className={`${styles.consent} ${errors.consent ? styles.consentError : ""}`}>
                <input
                  type="checkbox"
                  checked={values.consent}
                  disabled={legalStatus !== "ready"}
                  onBlur={() => handleBlur("consent")}
                  onChange={(event) => updateValue("consent", event.target.checked)}
                />
                <span className={styles.checkbox}>
                  <Check size={13} />
                </span>
                <span>
                  I agree to the{" "}
                  <Link href={terms?.contentUrl ?? "/terms"}>
                    Terms of Service{terms ? ` (v${terms.version})` : ""}
                  </Link>{" "}
                  and{" "}
                  <Link href={privacy?.contentUrl ?? "/privacy"}>
                    Privacy Policy{privacy ? ` (v${privacy.version})` : ""}
                  </Link>
                  . I understand this project uses virtual funds only.
                </span>
              </label>
              {errors.consent && <span className={styles.errorText}>{errors.consent}</span>}

              {legalStatus === "loading" && (
                <p className={styles.legalStatus}>Loading current terms and privacy policy…</p>
              )}
              {legalStatus === "error" && (
                <div className={styles.apiError} role="alert">
                  <span>Current legal documents could not be loaded.</span>
                  <button type="button" onClick={() => void loadLegalDocuments()}>
                    Try again
                  </button>
                </div>
              )}
              {submitError && (
                <div className={styles.apiError} role="alert">
                  {submitError}
                </div>
              )}

              <button
                className={styles.submitButton}
                type="submit"
                disabled={status === "submitting" || legalStatus !== "ready"}
              >
                {status === "submitting" ? (
                  <>
                    <span className={styles.spinner} />
                    Creating your account…
                  </>
                ) : (
                  <>
                    Create account & wallet
                    <ArrowRight size={18} />
                  </>
                )}
              </button>

              <div className={styles.formSecurity}>
                <LockKeyhole size={14} />
                Your information is protected and your password is never stored
                in plain text.
              </div>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
