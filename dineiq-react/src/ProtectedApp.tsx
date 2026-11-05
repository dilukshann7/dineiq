import { AuthGate } from "@/features/auth/AuthGate";
import { Dashboard } from "@/features/dashboard/Dashboard";
import { InstallationGate } from "@/features/onboarding/InstallationGate";
import { Button } from "@/components/ui/button";

export default function ProtectedApp() {
  return (
    <InstallationGate>
      {(status, refresh) => (
        <AuthGate>
          {(user, logout) =>
            status.phase === "in_progress" && user.role === "STAFF" ? (
              <main className="account-screen">
                <section className="account-card">
                  <h1>Setup in progress</h1>
                  <p>Your admin needs to finish setting up DineIQ.</p>
                  <Button onClick={logout}>Sign out</Button>
                </section>
              </main>
            ) : (
              <Dashboard
                key={user.id}
                user={user}
                onLogout={logout}
                setupStatus={status}
                refreshSetup={refresh}
              />
            )
          }
        </AuthGate>
      )}
    </InstallationGate>
  );
}
