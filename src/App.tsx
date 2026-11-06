import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { api } from "./services/api";
import type { Session } from "./types";
import Auth from "./components/Auth";
import Chat from "./components/Chat";
import Resources from "./components/Resources";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    api<Session>("/auth/session")
      .then((value) => {
        if (active) {
          setSession(value);
          setError("");
        }
      })
      .catch(() => {
        if (active)
          setError(
            "We couldn’t connect to Still. Make sure the server is running, then try again.",
          );
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(() => {
    const expired = () => setSession((s) => (s ? { ...s, user: null } : s));
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  if (error)
    return (
      <main className="connection-screen">
        <div className="brand-mark">s.</div>
        <h1>A moment to reconnect.</h1>
        <p role="alert">{error}</p>
        <button
          className="button primary"
          onClick={() => {
            setError("");
            setAttempt((a) => a + 1);
          }}
        >
          Try again
        </button>
      </main>
    );
  if (!session)
    return (
      <main className="connection-screen" aria-live="polite">
        <div className="brand-mark">s.</div>
        <p>Finding a little stillness…</p>
      </main>
    );
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            session.user ? (
              <Navigate to="/" replace />
            ) : (
              <Auth onSession={setSession} mode={session.mode} />
            )
          }
        />
        <Route
          path="/signup"
          element={
            session.user ? (
              <Navigate to="/" replace />
            ) : (
              <Auth
                key="signup"
                signup
                onSession={setSession}
                mode={session.mode}
              />
            )
          }
        />
        <Route
          path="/"
          element={
            session.user ? (
              <Chat
                key={session.user.id}
                session={session}
                onSession={setSession}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/resources"
          element={
            session.user ? <Resources /> : <Navigate to="/login" replace />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
