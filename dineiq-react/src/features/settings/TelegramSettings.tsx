import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { authRequest, jsonRequest } from "@/lib/auth";

type TelegramConfiguration = {
  enabled: boolean;
  chat_id: string;
  bot_token_configured: boolean;
};

export function TelegramSettings() {
  const [configuration, setConfiguration] =
    useState<TelegramConfiguration | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [chatId, setChatId] = useState("");
  const [botToken, setBotToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void authRequest<TelegramConfiguration>("/admin/settings/telegram", {
      signal: controller.signal,
    })
      .then((value) => {
        if (controller.signal.aborted) return;
        setConfiguration(value);
        setEnabled(value.enabled);
        setChatId(value.chat_id);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load Telegram settings.",
          );
      });
    return () => controller.abort();
  }, [retry]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const value = await authRequest<TelegramConfiguration>(
        "/admin/settings/telegram",
        jsonRequest("PUT", {
          enabled,
          chat_id: chatId.trim(),
          ...(botToken.trim() ? { bot_token: botToken.trim() } : {}),
        }),
      );
      setConfiguration(value);
      setEnabled(value.enabled);
      setChatId(value.chat_id);
      setBotToken("");
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save Telegram settings.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="telegram-title">
      <h2 id="telegram-title">Telegram alerts</h2>
      <p>Send service and cleaning alerts to your staff Telegram group.</p>
      {configuration ? (
        <form
          className="account-form max-w-lg"
          onSubmit={submit}
          onChange={() => setSaved(false)}
        >
          <fieldset disabled={busy} className="grid min-w-0 gap-4">
            <label className="settings-toggle">
              <input
                name="enabled"
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              Enable Telegram alerts
            </label>
            <label>
              Bot token
              <input
                name="bot_token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={botToken}
                onChange={(event) => setBotToken(event.target.value)}
                maxLength={256}
                pattern="[0-9]+:[A-Za-z0-9_-]+"
                required={enabled && !configuration.bot_token_configured}
                aria-describedby="telegram-token-help"
                placeholder={
                  configuration.bot_token_configured
                    ? "Token saved — enter a new token to replace it"
                    : "Enter your BotFather token"
                }
              />
            </label>
            <small id="telegram-token-help">
              {configuration.bot_token_configured
                ? "A token is saved. Leave this field empty to keep it."
                : "Create a bot with @BotFather in Telegram and paste its token here."}{" "}
              Saved tokens are never displayed.
            </small>
            <label>
              Staff group chat ID
              <input
                name="chat_id"
                value={chatId}
                onChange={(event) => setChatId(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                pattern="-[0-9]+"
                required={enabled}
                placeholder="-1001234567890"
                aria-describedby="telegram-group-help"
              />
            </label>
            <small id="telegram-group-help">
              Add your bot to the staff group and allow it to send messages. Use
              the group's negative numeric chat ID.
            </small>
            <div>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save Telegram settings"}
              </Button>
            </div>
          </fieldset>
          {saved && (
            <p role="status">
              Telegram settings saved. Changes apply immediately.
            </p>
          )}
        </form>
      ) : (
        !error && <p role="status">Loading Telegram settings…</p>
      )}
      {error && (
        <div className="grid justify-items-start gap-3" role="alert">
          <p className="account-error">{error}</p>
          {!configuration && (
            <Button
              variant="outline"
              onClick={() => {
                setError("");
                setRetry((value) => value + 1);
              }}
            >
              Retry connection
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
