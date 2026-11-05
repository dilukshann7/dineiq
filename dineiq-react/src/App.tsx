import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { HomePage } from "@/features/home/HomePage";

const ProtectedApp = lazy(() => import("./ProtectedApp"));

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route
        path="*"
        element={
          <Suspense
            fallback={
              <main className="account-screen">
                <p role="status">Opening DineIQ…</p>
              </main>
            }
          >
            <ProtectedApp />
          </Suspense>
        }
      />
    </Routes>
  );
}
