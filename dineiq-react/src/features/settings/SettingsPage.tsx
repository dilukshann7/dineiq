import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResetSettings } from "@/features/onboarding/ResetSettings";
import type { User } from "@/lib/auth";
import type { SetupStatus } from "@/lib/setup-state";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { TelegramSettings } from "./TelegramSettings";
import { CalibrationPanel } from "./calibration/CalibrationPanel";
import "./settings.css";

export function SettingsPage({
  user,
  setupStatus,
  onStop,
  onRestart,
}: {
  user: User;
  setupStatus: SetupStatus;
  onStop: () => void;
  onRestart: () => void;
}) {
  const [resetOpen, setResetOpen] = useState(false);
  return (
    <div className="camera-panel settings-page">
      <section className="settings-section" aria-labelledby="password-title">
        <h2 id="password-title">Change password</h2>
        <p>
          {user.display_name} · @{user.username}
        </p>
        <ChangePasswordForm />
      </section>
      {user.role === "ADMIN" && (
        <>
          <CalibrationPanel />
          <TelegramSettings />
          {resetOpen ? (
            <ResetSettings
              generation={setupStatus.generation}
              onStop={onStop}
              onRestart={onRestart}
              onClose={() => setResetOpen(false)}
            />
          ) : (
            <section
              className="settings-section"
              aria-labelledby="reset-settings-title"
            >
              <h2 id="reset-settings-title">Reset DineIQ</h2>
              <p>Permanently delete application data and start setup again.</p>
              <div>
                <Button
                  variant="destructive"
                  onClick={() => setResetOpen(true)}
                >
                  Review reset options
                </Button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
