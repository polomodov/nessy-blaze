import { useMemo, useState } from "react";
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
import {
  AUTH_TOKEN_STORAGE_KEY,
  DEV_USER_EMAIL_STORAGE_KEY,
  DEV_USER_NAME_STORAGE_KEY,
  DEV_USER_SUB_STORAGE_KEY,
} from "@/ipc/backend_client";

type AuthMode = "login" | "register" | "forgot";

interface StoredAuthValues {
  token: string;
  email: string;
  name: string;
  sub: string;
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

function clearAuthValues() {
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(DEV_USER_SUB_STORAGE_KEY);
  window.localStorage.removeItem(DEV_USER_EMAIL_STORAGE_KEY);
  window.localStorage.removeItem(DEV_USER_NAME_STORAGE_KEY);
}

const DEFAULT_GOOGLE_EMAIL = "google-user@local.blaze";
const DEFAULT_GOOGLE_NAME = "Google User";

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

  const handleGoogleLogin = () => {
    const nextEmail = email.trim() || DEFAULT_GOOGLE_EMAIL;
    const nextName = name.trim() || DEFAULT_GOOGLE_NAME;
    const nextSub = devSub.trim() || deriveDevSub(nextEmail, nextName);
    const storedValuesAfterGoogle = persistCredentials({
      email: nextEmail,
      name: nextName,
      sub: nextSub,
    });

    setEmail(storedValuesAfterGoogle.email);
    setName(storedValuesAfterGoogle.name);
    setDevSub(storedValuesAfterGoogle.sub);

    toast.success(t("auth.toast.googleSignedIn"));
    navigate({ to: "/" });
  };

  const handleClearCredentials = () => {
    clearAuthValues();
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
              onClick={handleGoogleLogin}
            >
              <GoogleIcon />
              {t("auth.button.google")}
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
