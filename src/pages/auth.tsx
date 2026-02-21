import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Eraser,
  KeyRound,
  Lock,
  Mail,
  User,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/contexts/I18nContext";
import { clearStoredAuthContext } from "@/lib/auth_storage";
import type {
  OAuth2PublicConfig,
  OAuth2TokenExchangeResult,
} from "@/lib/oauth2_flow";
import {
  OAUTH2_CODE_VERIFIER_STORAGE_KEY,
  OAUTH2_REDIRECT_URI_STORAGE_KEY,
  OAUTH2_STATE_STORAGE_KEY,
  buildOAuth2AuthorizationUrl,
  createOAuth2State,
  createPkceCodeChallenge,
  createPkceCodeVerifier,
  hasOAuth2CallbackParams,
  parseJwtClaimsUnsafe,
  resolveOAuthRedirectUri,
} from "@/lib/oauth2_flow";
import {
  AUTH_REDIRECT_REASON_SESSION_EXPIRED,
  AUTH_REDIRECT_REASON_STORAGE_KEY,
  AUTH_TOKEN_STORAGE_KEY,
  DEV_USER_EMAIL_STORAGE_KEY,
  DEV_USER_NAME_STORAGE_KEY,
  DEV_USER_SUB_STORAGE_KEY,
} from "@/ipc/backend_client";

type AuthMode = "login" | "register" | "forgot";

const OAUTH2_CONFIG_ENDPOINT = "/api/v1/auth/oauth/config";
const OAUTH2_EXCHANGE_ENDPOINT = "/api/v1/auth/oauth/exchange";
const OAUTH2_AUTO_START_PARAM = "oauth_start";

interface StoredAuthValues {
  token: string;
  email: string;
  name: string;
  sub: string;
}

interface ApiResponseEnvelope<T> {
  data?: T;
  error?: string;
}

function readStoredValue(key: string): string {
  return window.localStorage.getItem(key)?.trim() ?? "";
}

function deriveDevSub(email: string, name: string): string {
  const emailLocalPart = email.split("@")[0]?.trim() ?? "";
  if (emailLocalPart) {
    return emailLocalPart;
  }

  const normalizedName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const compactName = normalizedName.replace(/^-+|-+$/g, "");
  return compactName || "dev-user";
}

function saveStoredValue(key: string, value: string) {
  if (value) {
    window.localStorage.setItem(key, value);
    return;
  }
  window.localStorage.removeItem(key);
}

function saveAuthValues(values: StoredAuthValues) {
  saveStoredValue(AUTH_TOKEN_STORAGE_KEY, values.token);
  saveStoredValue(DEV_USER_SUB_STORAGE_KEY, values.sub);
  saveStoredValue(DEV_USER_EMAIL_STORAGE_KEY, values.email);
  saveStoredValue(DEV_USER_NAME_STORAGE_KEY, values.name);
}

function saveOAuthSessionValue(key: string, value: string) {
  if (value) {
    window.sessionStorage.setItem(key, value);
    return;
  }
  window.sessionStorage.removeItem(key);
}

function clearOAuthSessionValues() {
  window.sessionStorage.removeItem(OAUTH2_STATE_STORAGE_KEY);
  window.sessionStorage.removeItem(OAUTH2_CODE_VERIFIER_STORAGE_KEY);
  window.sessionStorage.removeItem(OAUTH2_REDIRECT_URI_STORAGE_KEY);
}

function readOAuthSessionValue(key: string): string {
  return window.sessionStorage.getItem(key)?.trim() ?? "";
}

async function readApiEnvelope<T>(
  response: Response,
): Promise<ApiResponseEnvelope<T>> {
  try {
    return (await response.json()) as ApiResponseEnvelope<T>;
  } catch {
    const text = await response.text().catch(() => "");
    return {
      error: text || undefined,
    };
  }
}

function readOAuthCallbackSearchParams(): URLSearchParams | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!hasOAuth2CallbackParams(window.location.search)) {
    return null;
  }
  return new URLSearchParams(window.location.search);
}

function clearAuthSearchParamsInUrl() {
  if (typeof window === "undefined") {
    return;
  }
  window.history.replaceState({}, "", "/auth");
}

function resolveOAuthToken(exchange: OAuth2TokenExchangeResult): string | null {
  const idToken = exchange.idToken?.trim() ?? "";
  if (idToken) {
    return idToken;
  }
  const accessToken = exchange.accessToken?.trim() ?? "";
  if (accessToken) {
    return accessToken;
  }
  return null;
}

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" className="shrink-0">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

export default function AuthPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useI18n();

  const storedValues = useMemo<StoredAuthValues>(
    () => ({
      token: readStoredValue(AUTH_TOKEN_STORAGE_KEY),
      email: readStoredValue(DEV_USER_EMAIL_STORAGE_KEY),
      name: readStoredValue(DEV_USER_NAME_STORAGE_KEY),
      sub: readStoredValue(DEV_USER_SUB_STORAGE_KEY),
    }),
    [],
  );

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState(storedValues.email);
  const [password, setPassword] = useState("");
  const [name, setName] = useState(storedValues.name);
  const [token, setToken] = useState(storedValues.token);
  const [devSub, setDevSub] = useState(storedValues.sub);
  const [isOAuthBusy, setIsOAuthBusy] = useState(false);
  const oauthCallbackHandledRef = useRef(false);
  const oauthAutoStartHandledRef = useRef(false);

  const persistCredentials = (
    overrides: Partial<StoredAuthValues> = {},
  ): StoredAuthValues => {
    const nextToken = (overrides.token ?? token).trim();
    const nextEmail = (overrides.email ?? email).trim();
    const nextName = (overrides.name ?? name).trim();
    const manualSub = (overrides.sub ?? devSub).trim();
    const nextSub = manualSub || deriveDevSub(nextEmail, nextName);

    saveAuthValues({
      token: nextToken,
      email: nextEmail,
      name: nextName,
      sub: nextSub,
    });

    queryClient.clear();
    return {
      token: nextToken,
      email: nextEmail,
      name: nextName,
      sub: nextSub,
    };
  };

  const fetchOAuth2Config =
    useCallback(async (): Promise<OAuth2PublicConfig> => {
      const response = await fetch(OAUTH2_CONFIG_ENDPOINT, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const payload = await readApiEnvelope<OAuth2PublicConfig>(response);
      if (!response.ok || !payload?.data) {
        throw new Error(
          payload?.error || t("auth.toast.oauthConfigLoadFailed"),
        );
      }
      return payload.data;
    }, [t]);

  const exchangeOAuth2Code = useCallback(
    async (params: {
      code: string;
      codeVerifier: string;
      redirectUri: string;
    }): Promise<OAuth2TokenExchangeResult> => {
      const response = await fetch(OAUTH2_EXCHANGE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });
      const payload =
        await readApiEnvelope<OAuth2TokenExchangeResult>(response);
      if (!response.ok || !payload?.data) {
        throw new Error(payload?.error || t("auth.toast.oauthExchangeFailed"));
      }
      return payload.data;
    },
    [t],
  );

  const handleOAuthCallback = useCallback(async () => {
    if (oauthCallbackHandledRef.current) {
      return;
    }

    const callbackParams = readOAuthCallbackSearchParams();
    if (!callbackParams) {
      return;
    }
    oauthCallbackHandledRef.current = true;
    setIsOAuthBusy(true);
    setPassword("");

    const oauthError = callbackParams.get("error")?.trim();
    if (oauthError) {
      const description =
        callbackParams.get("error_description")?.trim() || oauthError;
      toast.error(t("auth.toast.oauthProviderError", { message: description }));
      clearOAuthSessionValues();
      clearAuthSearchParamsInUrl();
      setIsOAuthBusy(false);
      return;
    }

    const code = callbackParams.get("code")?.trim();
    const callbackState = callbackParams.get("state")?.trim() ?? "";
    const expectedState = readOAuthSessionValue(OAUTH2_STATE_STORAGE_KEY);
    const codeVerifier = readOAuthSessionValue(
      OAUTH2_CODE_VERIFIER_STORAGE_KEY,
    );
    const savedRedirectUri = readOAuthSessionValue(
      OAUTH2_REDIRECT_URI_STORAGE_KEY,
    );

    if (!code) {
      toast.error(t("auth.toast.oauthCodeMissing"));
      clearOAuthSessionValues();
      clearAuthSearchParamsInUrl();
      setIsOAuthBusy(false);
      return;
    }
    if (!callbackState || !expectedState || callbackState !== expectedState) {
      toast.error(t("auth.toast.oauthStateMismatch"));
      clearOAuthSessionValues();
      clearAuthSearchParamsInUrl();
      setIsOAuthBusy(false);
      return;
    }
    if (!codeVerifier) {
      toast.error(t("auth.toast.oauthVerifierMissing"));
      clearOAuthSessionValues();
      clearAuthSearchParamsInUrl();
      setIsOAuthBusy(false);
      return;
    }

    try {
      const oauthConfig = await fetchOAuth2Config();
      if (!oauthConfig.enabled) {
        throw new Error(t("auth.toast.oauthNotConfigured"));
      }

      const redirectUri =
        savedRedirectUri ||
        resolveOAuthRedirectUri({
          configuredRedirectUri: oauthConfig.redirectUri,
          currentOrigin: window.location.origin,
        }).redirectUri;
      const exchangeResult = await exchangeOAuth2Code({
        code,
        codeVerifier,
        redirectUri,
      });
      const selectedToken = resolveOAuthToken(exchangeResult);
      if (!selectedToken) {
        throw new Error(t("auth.toast.oauthTokenMissing"));
      }

      const claims = parseJwtClaimsUnsafe(selectedToken);
      const nextEmail =
        typeof claims?.email === "string" ? claims.email : email.trim();
      const nextName =
        typeof claims?.name === "string" ? claims.name : name.trim();
      const nextSub =
        typeof claims?.sub === "string"
          ? claims.sub
          : deriveDevSub(nextEmail, nextName);

      const savedValues = persistCredentials({
        token: selectedToken,
        email: nextEmail,
        name: nextName,
        sub: nextSub,
      });
      setToken(savedValues.token);
      setEmail(savedValues.email);
      setName(savedValues.name);
      setDevSub(savedValues.sub);

      clearOAuthSessionValues();
      clearAuthSearchParamsInUrl();
      toast.success(t("auth.toast.oauthSignedIn"));
      navigate({ to: "/" });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("auth.toast.oauthExchangeFailed"),
      );
      clearOAuthSessionValues();
      clearAuthSearchParamsInUrl();
    } finally {
      setIsOAuthBusy(false);
    }
  }, [
    email,
    exchangeOAuth2Code,
    fetchOAuth2Config,
    name,
    navigate,
    persistCredentials,
    t,
  ]);

  useEffect(() => {
    void handleOAuthCallback();
  }, [handleOAuthCallback]);

  useEffect(() => {
    const redirectReason = window.sessionStorage.getItem(
      AUTH_REDIRECT_REASON_STORAGE_KEY,
    );
    if (redirectReason !== AUTH_REDIRECT_REASON_SESSION_EXPIRED) {
      return;
    }

    window.sessionStorage.removeItem(AUTH_REDIRECT_REASON_STORAGE_KEY);
    toast.error(t("auth.toast.sessionExpired"));
  }, [t]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (mode === "forgot") {
      toast.info(t("auth.toast.passwordResetNotWired"));
      setMode("login");
      return;
    }

    if (!email.trim()) {
      toast.error(t("auth.toast.emailRequired"));
      return;
    }
    if (!password.trim()) {
      toast.error(t("auth.toast.passwordRequired"));
      return;
    }
    if (mode === "register" && !name.trim()) {
      toast.error(t("auth.toast.nameRequired"));
      return;
    }

    persistCredentials();
    toast.success(t("auth.toast.credentialsSaved"));
    navigate({ to: "/" });
  };

  const handleGoogleLogin = async () => {
    if (isOAuthBusy) {
      return;
    }

    setIsOAuthBusy(true);
    try {
      const oauthConfig = await fetchOAuth2Config();
      if (
        !oauthConfig.enabled ||
        !oauthConfig.authorizationUrl ||
        !oauthConfig.clientId
      ) {
        toast.error(t("auth.toast.oauthNotConfigured"));
        return;
      }

      const codeVerifier = createPkceCodeVerifier();
      const codeChallenge = await createPkceCodeChallenge(codeVerifier);
      const state = createOAuth2State();
      const redirectResolution = resolveOAuthRedirectUri({
        configuredRedirectUri: oauthConfig.redirectUri,
        currentOrigin: window.location.origin,
      });
      const redirectUri = redirectResolution.redirectUri;

      if (redirectResolution.requiresOriginSwitch) {
        const switchUrl = new URL(redirectUri);
        switchUrl.searchParams.set(OAUTH2_AUTO_START_PARAM, "1");
        window.location.assign(switchUrl.toString());
        return;
      }

      saveOAuthSessionValue(OAUTH2_STATE_STORAGE_KEY, state);
      saveOAuthSessionValue(OAUTH2_CODE_VERIFIER_STORAGE_KEY, codeVerifier);
      saveOAuthSessionValue(OAUTH2_REDIRECT_URI_STORAGE_KEY, redirectUri);

      const authorizationUrl = buildOAuth2AuthorizationUrl({
        config: oauthConfig,
        redirectUri,
        state,
        codeChallenge,
      });
      window.location.assign(authorizationUrl);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("auth.toast.oauthStartFailed"),
      );
    } finally {
      setIsOAuthBusy(false);
    }
  };

  useEffect(() => {
    if (oauthAutoStartHandledRef.current) {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const shouldAutoStart = searchParams.get(OAUTH2_AUTO_START_PARAM) === "1";
    if (!shouldAutoStart || hasOAuth2CallbackParams(window.location.search)) {
      return;
    }

    oauthAutoStartHandledRef.current = true;
    window.history.replaceState({}, "", "/auth");
    void handleGoogleLogin();
  }, [handleGoogleLogin]);

  const handleClearCredentials = () => {
    clearStoredAuthContext();
    clearOAuthSessionValues();
    setToken("");
    setDevSub("");
    setEmail("");
    setName("");
    setPassword("");
    queryClient.clear();
    toast.success(t("auth.toast.credentialsCleared"));
  };

  return (
    <div className="relative flex min-h-full w-full items-center justify-center overflow-auto bg-background p-4">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/4 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        <div className="mb-7 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Zap className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold tracking-tight text-foreground">
            {t("auth.brand")}
          </span>
        </div>

        <Card className="border-border/60 bg-card/85 shadow-xl backdrop-blur-sm">
          <CardHeader className="pb-2 text-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.18 }}
              >
                <CardTitle>
                  {mode === "login" && t("auth.title.login")}
                  {mode === "register" && t("auth.title.register")}
                  {mode === "forgot" && t("auth.title.forgot")}
                </CardTitle>
                <CardDescription className="mt-1.5">
                  {mode === "login" && t("auth.description.login")}
                  {mode === "register" && t("auth.description.register")}
                  {mode === "forgot" && t("auth.description.forgot")}
                </CardDescription>
              </motion.div>
            </AnimatePresence>
          </CardHeader>

          <CardContent className="space-y-4 pt-4">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full gap-3 text-sm font-medium"
              onClick={() => {
                void handleGoogleLogin();
              }}
              disabled={isOAuthBusy}
            >
              <GoogleIcon />
              {isOAuthBusy
                ? t("auth.button.googleLoading")
                : t("auth.button.google")}
            </Button>

            {mode !== "forgot" && (
              <>
                <div className="relative">
                  <Separator />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground">
                    {t("auth.separator.or")}
                  </span>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                  {mode === "register" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="auth-name">{t("auth.label.name")}</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="auth-name"
                          placeholder={t("auth.placeholder.name")}
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          className="h-10 pl-9"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="auth-email">{t("auth.label.email")}</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="auth-email"
                        type="email"
                        placeholder={t("auth.placeholder.email")}
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="h-10 pl-9"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="auth-password">
                        {t("auth.label.password")}
                      </Label>
                      {mode === "login" && (
                        <button
                          type="button"
                          onClick={() => setMode("forgot")}
                          className="text-xs text-primary hover:underline"
                        >
                          {t("auth.button.forgotPassword")}
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="auth-password"
                        type="password"
                        placeholder={t("auth.placeholder.password")}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="h-10 pl-9"
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="mt-2 h-10 w-full gap-2 font-semibold"
                  >
                    {mode === "login"
                      ? t("auth.button.signIn")
                      : t("auth.button.createAccount")}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </form>
              </>
            )}

            {mode === "forgot" && (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reset-email">{t("auth.label.email")}</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="reset-email"
                      type="email"
                      placeholder={t("auth.placeholder.email")}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="h-10 pl-9"
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="h-10 w-full gap-2 font-semibold"
                >
                  {t("auth.button.sendResetLink")}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </form>
            )}

            <div className="space-y-2 rounded-md border border-border/70 bg-muted/40 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="auth-token">{t("auth.label.token")}</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="auth-token"
                    placeholder={t("auth.placeholder.token")}
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    className="h-10 pl-9"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auth-dev-sub">{t("auth.label.devSub")}</Label>
                <Input
                  id="auth-dev-sub"
                  placeholder={t("auth.placeholder.devSub")}
                  value={devSub}
                  onChange={(event) => setDevSub(event.target.value)}
                  className="h-10"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                className="h-9 w-full gap-2"
                onClick={handleClearCredentials}
              >
                <Eraser className="h-4 w-4" />
                {t("auth.button.clearCredentials")}
              </Button>
            </div>

            <div className="pt-1 text-center text-sm text-muted-foreground">
              {mode === "login" && (
                <>
                  {t("auth.prompt.noAccount")}{" "}
                  <button
                    type="button"
                    onClick={() => setMode("register")}
                    className="font-medium text-primary hover:underline"
                  >
                    {t("auth.button.createOne")}
                  </button>
                </>
              )}
              {mode === "register" && (
                <>
                  {t("auth.prompt.haveAccount")}{" "}
                  <button
                    type="button"
                    onClick={() => setMode("login")}
                    className="font-medium text-primary hover:underline"
                  >
                    {t("auth.button.signIn")}
                  </button>
                </>
              )}
              {mode === "forgot" && (
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="font-medium text-primary hover:underline"
                >
                  {t("auth.button.backToSignIn")}
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          {t("auth.note.localStorage")}
        </p>
      </motion.div>
    </div>
  );
}
