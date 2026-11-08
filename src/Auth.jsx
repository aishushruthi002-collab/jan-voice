import { useState } from "react";
import { supabase } from "./supabase";
import "./Auth.css";

export default function Auth({ resetMode = false, onPasswordUpdated }) {
  const [mode, setMode] = useState(resetMode ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("status");
  const [loading, setLoading] = useState(false);

  function showMessage(text, type = "status") {
    setMessage(text);
    setMessageType(type);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage("");

    if (mode === "reset" && password !== confirmPassword) {
      showMessage("The passwords do not match.", "error");
      return;
    }

    if (mode === "reset" && password.length < 6) {
      showMessage("Your password must be at least 6 characters long.", "error");
      return;
    }

    setLoading(true);

    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: window.location.origin }
        );

        if (error) throw error;

        showMessage("If an account exists for this email, a password reset link is on its way. Check your inbox.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });

        if (error) throw error;

        setPassword("");
        setConfirmPassword("");
        showMessage("Your password has been updated.");
        onPasswordUpdated?.();
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });

        if (error) throw error;

        showMessage(
          data.session
            ? "Account created! You are now signed in."
            : "Account created! Check your email to confirm your account."
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) throw error;

        showMessage("Login successful!");
      }
    } catch (error) {
      showMessage(error.message || "Authentication failed.", "error");
    } finally {
      setLoading(false);
    }
  }

  const isForgotMode = mode === "forgot";
  const isResetMode = mode === "reset";
  const isPasswordForm = mode === "login" || mode === "signup" || isResetMode;

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>JanVoice</h1>
        <p>Public Grievance &amp; Civic Issue Reporting</p>

        <h2>
          {mode === "login"
            ? "Welcome back"
            : mode === "signup"
              ? "Create your account"
              : isForgotMode
                ? "Reset your password"
                : "Choose a new password"}
        </h2>
        {isForgotMode && (
          <p className="auth-helper">
            Enter your account email and we’ll send you a password reset link.
          </p>
        )}
        {isResetMode && (
          <p className="auth-helper">
            Choose a new password for your JanVoice account.
          </p>
        )}

        {!isResetMode && (
          <>
            <label htmlFor="auth-email">Email address</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </>
        )}

        {isPasswordForm && (
          <>
            <label htmlFor="auth-password">
              {isResetMode ? "New password" : "Password"}
            </label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              minLength={6}
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </>
        )}

        {isResetMode && (
          <>
            <label htmlFor="auth-confirm-password">Confirm new password</label>
            <input
              id="auth-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Enter your new password again"
              minLength={6}
              required
              autoComplete="new-password"
            />
          </>
        )}

        <button type="submit" disabled={loading}>
          {loading
            ? "Please wait..."
            : mode === "login"
              ? "Log In"
              : mode === "signup"
                ? "Sign Up"
                : isForgotMode
                  ? "Send reset link"
                  : "Update password"}
        </button>

        {message && (
          <p
            className={`auth-message ${messageType === "error" ? "error" : "success"}`}
            role={messageType === "error" ? "alert" : "status"}
          >
            {message}
          </p>
        )}

        {mode === "login" && (
          <button
            type="button"
            className="auth-switch auth-forgot-link"
            onClick={() => {
              setMode("forgot");
              setMessage("");
            }}
          >
            Forgot Password?
          </button>
        )}

        {!isResetMode && (
          <p className="auth-mode-switch">
            {mode === "login"
              ? "New to JanVoice?"
              : mode === "signup"
                ? "Already have an account?"
                : "Remembered your password?"}{" "}
            <button
              type="button"
              className="auth-switch"
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setMessage("");
                setMessageType("status");
              }}
            >
              {mode === "login" ? "Create an account" : "Log in"}
            </button>
          </p>
        )}
      </form>
    </div>
  );
}
