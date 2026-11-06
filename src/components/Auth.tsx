import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../services/api";
import type { Session } from "../types";
import Icon from "./Icon";

export default function Auth({
  signup = false,
  onSession,
  mode,
}: {
  signup?: boolean;
  onSession: (s: Session) => void;
  mode: Session["mode"];
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event?: FormEvent, guest = false) {
    event?.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      onSession(
        await api<Session>(
          guest ? "/auth/guest" : signup ? "/auth/register" : "/auth/login",
          {
            method: "POST",
            body: JSON.stringify(guest ? {} : { email, password }),
          },
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="wordmark">
          <span className="brand-mark">s.</span>still
          <span className="wordmark-caption">A LITTLE SPACE FOR YOU</span>
        </div>
        <div className="story-center">
          <div className="orb orb-one" />
          <div className="orb orb-two" />
          <span className="eyebrow">PAUSE. REFLECT. BEGIN AGAIN.</span>
          <h1>
            You don’t have to
            <br />
            have it all
            <br />
            <em>figured out.</em>
          </h1>
          <p>
            A quiet place to put your thoughts into words,
            <br />
            one conversation at a time.
          </p>
        </div>
        <p className="story-footer">
          <Icon name="leaf" /> Small moments. A little more room to breathe.
        </p>
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <span className="eyebrow">WELCOME TO STILL</span>
          <h2>
            {signup
              ? "Make space for yourself."
              : "It’s good to have you here."}
          </h2>
          <p className="muted">
            {signup
              ? "Create an account to return to your conversations."
              : "Sign in to pick up where you left off."}
          </p>
          {mode === "demo" && (
            <div className="notice">
              <span className="status-dot" /> Demo mode · replies are scripted.
              No AI key is configured.
            </div>
          )}
          <form onSubmit={submit} className="auth-form">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={busy}
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              required
              minLength={10}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={signup ? "At least 10 characters" : "Your password"}
              disabled={busy}
            />
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? "Just a moment…" : signup ? "Create account" : "Sign in"}
              <span aria-hidden="true">↗</span>
            </button>
          </form>
          <p className="auth-switch">
            {signup ? "Already have an account?" : "New here?"}{" "}
            <Link to={signup ? "/login" : "/signup"}>
              {signup ? "Sign in" : "Create an account"}
            </Link>
          </p>
          <div className="divider">
            <span>or take a look around</span>
          </div>
          <button
            className="button secondary full"
            disabled={busy}
            onClick={() => submit(undefined, true)}
          >
            Continue as guest <span aria-hidden="true">→</span>
          </button>
          <p className="fine-print">
            Guest chats are stored on this server for up to 24 hours and removed
            on logout. Accounts save chats until you delete them.
          </p>
          <div className="auth-disclaimer">
            <Icon name="shield" />
            <p>
              Still is a reflection companion, not a therapist or emergency
              service.{" "}
              {mode === "ai"
                ? "Messages are sent to OpenAI to generate and check replies."
                : "Demo replies use simple patterns and may miss important context."}{" "}
              Avoid sharing identifying or sensitive details.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
