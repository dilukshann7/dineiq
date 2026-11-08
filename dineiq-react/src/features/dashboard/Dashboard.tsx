import { useEffect, useRef } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import { ShieldCheck } from "lucide-react";
import { Logo } from "@/components/Logo";
import { StaffManagement } from "@/features/staff/StaffManagement";
import { ActivityHistory } from "@/features/activity/ActivityHistory";
import { CameraPanel } from "@/features/camera/CameraPanel";
import { CameraToggle } from "@/features/camera/CameraToggle";
import { SetupTables } from "@/features/table-setup/SetupTables";
import { TableDashboard } from "@/features/tables/TableDashboard";
import { TableHistory } from "@/features/tables/TableHistory";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { dashboardRedirect } from "@/lib/routes";
import type { User } from "@/lib/auth";
import type { SetupStatus } from "@/lib/setup-state";
import { OnboardingWizard } from "@/features/onboarding/OnboardingWizard";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardNavigation } from "./DashboardNavigation";
import { useDashboardWorkspace } from "./useDashboardWorkspace";
import "./dashboard.css";

export function Dashboard({
  user,
  onLogout,
  setupStatus,
  refreshSetup,
}: {
  user: User;
  onLogout: () => void;
  setupStatus: SetupStatus;
  refreshSetup: () => void;
}) {
  const isAdmin = user.role === "ADMIN";
  const onboarding = setupStatus.phase !== "complete";
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activityUser = searchParams.get("user") || "";
  const redirect = dashboardRedirect(user.role, onboarding, location.pathname);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titles: Record<string, string> = {
    "/camera": "Camera",
    "/tables": "Tables",
    "/history": "History",
    "/staff": "Staff",
    "/activity": isAdmin ? "Activity" : "My activity",
    "/settings": "Settings",
    "/setup": "Welcome to DineIQ",
  };
  const title = titles[location.pathname] || "Page not found";
  useEffect(() => {
    document.title = `${title} · DineIQ`;
    headingRef.current?.focus({ preventScroll: true });
  }, [title, location.pathname]);
  const workspace = useDashboardWorkspace(onboarding);
  const {
    monitor,
    camera,
    detector,
    videoRef,
    frameRef,
    overlayRef,
    toggleCamera,
    toggleMonitoring,
  } = workspace;

  return (
    <div className="camera-page" data-onboarding={onboarding}>
      {redirect && <Navigate to={redirect} replace />}
      <a className="camera-skip" href="#main">
        Skip to dashboard
      </a>
      <DashboardHeader user={user} onLogout={onLogout} />
      <main id="main" className="camera-container camera-main">
        <div className="camera-heading-row">
          <div className="camera-heading">
            <span className="camera-eyebrow">Your restaurant, in view</span>
            <h1 ref={headingRef} tabIndex={-1}>
              {title}
            </h1>
            <p>
              {location.pathname === "/settings"
                ? "Manage your account and restaurant preferences."
                : onboarding
                  ? "Set up your restaurant workspace."
                  : "A live view of your restaurant."}
            </p>
          </div>
          {isAdmin && (
            <CameraToggle camera={camera.camera} onToggle={toggleCamera} />
          )}
        </div>
        {onboarding && location.pathname === "/settings" && (
          <Link to="/setup" className="mb-6 inline-block underline">
            Back to setup
          </Link>
        )}
        <div className="camera-workspace" data-onboarding={onboarding}>
          {!onboarding && <DashboardNavigation role={user.role} />}
          {isAdmin && (
            <CameraPanel
              active={
                location.pathname === "/camera" ||
                location.pathname === "/setup"
              }
              camera={camera.camera}
              videoRef={videoRef}
              frameRef={frameRef}
              overlayRef={overlayRef}
              detection={detector.detection}
              detectionError={detector.detectionError}
              detectionHz={detector.detectionHz}
              fullscreenError={camera.fullscreenError}
              expandPreview={camera.expandPreview}
              onRetryDetection={detector.retryDetection}
              automaticStatus={
                camera.live
                  ? workspace.automaticTables.status ||
                    (monitor.monitoring
                      ? monitor.layout?.matching_message ||
                        "Tables update automatically: new tables are added, removed tables disappear, and positions follow movement."
                      : "Monitoring paused. Resume monitoring to update tables automatically.")
                  : ""
              }
            />
          )}
          {isAdmin && onboarding && (
            <OnboardingWizard
              workspace={workspace}
              status={setupStatus}
              onRefresh={refreshSetup}
              active={location.pathname === "/setup"}
            />
          )}
          <Routes>
            <Route path="setup" element={null} />
            <Route path="camera" element={null} />
            <Route
              path="settings"
              element={
                <SettingsPage
                  user={user}
                  setupStatus={setupStatus}
                  onStop={workspace.stopForReset}
                  onRestart={() => {
                    if (!camera.live) toggleCamera();
                  }}
                />
              }
            />
            <Route
              path="tables"
              element={
                !onboarding && (
                  <TableDashboard
                    admin={isAdmin}
                    layoutLoading={monitor.layoutLoading}
                    layout={monitor.layout}
                    states={monitor.visibleStates}
                    enabled={monitor.monitoring}
                    live={camera.live}
                    error={monitor.monitorError}
                    onConfigure={monitor.configureTables}
                    onToggle={toggleMonitoring}
                    onReload={monitor.reloadMonitoring}
                    onCorrect={monitor.correctTable}
                    onServed={(id, visitId) =>
                      monitor.staffAction(() =>
                        monitor.client.markServed(id, visitId),
                      )
                    }
                    onAcknowledge={(alertId) =>
                      monitor.staffAction(() =>
                        monitor.client.acknowledge(alertId),
                      )
                    }
                    now={monitor.clock}
                  >
                    {monitor.setup && (
                      <SetupTables
                        client={monitor.client}
                        frame={monitor.setup.frame}
                        layout={monitor.setup.layout}
                        onCancel={() => monitor.setSetup(null)}
                        onSave={monitor.saveSetup}
                      />
                    )}
                  </TableDashboard>
                )
              }
            />
            <Route
              path="history"
              element={
                isAdmin &&
                !onboarding && (
                  <TableHistory
                    layout={monitor.layout}
                    client={monitor.client}
                  />
                )
              }
            />
            <Route
              path="staff"
              element={
                isAdmin &&
                !onboarding && (
                  <div className="camera-panel">
                    <StaffManagement
                      onHistory={(id) => {
                        navigate(
                          `/activity?${new URLSearchParams({ user: id })}`,
                        );
                      }}
                    />
                  </div>
                )
              }
            />
            <Route
              path="activity"
              element={
                !onboarding && (
                  <div className="camera-panel">
                    <ActivityHistory
                      key={activityUser}
                      admin={isAdmin}
                      initialUser={activityUser}
                      tables={monitor.layout?.tables || []}
                    />
                  </div>
                )
              }
            />
            <Route path="/" element={null} />
            <Route
              path="*"
              element={
                <section className="camera-panel">
                  <p>This page does not exist.</p>
                  <Link
                    to={isAdmin ? "/camera" : "/tables"}
                    className="underline"
                  >
                    Return to dashboard
                  </Link>
                </section>
              }
            />
          </Routes>
        </div>
        <p className="camera-privacy">
          <ShieldCheck size={15} aria-hidden="true" />
          Camera frames are analyzed by your backend and are not saved. Table
          configuration and state history are stored.
        </p>
      </main>
      <footer className="camera-container camera-footer">
        <Logo compact />
        <span>Live camera workspace</span>
      </footer>
    </div>
  );
}
