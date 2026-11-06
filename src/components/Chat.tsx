import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../services/api";
import type { Conversation, Exchange, Message, Session } from "../types";
import Icon from "./Icon";

const starters = [
  "I’ve been feeling overwhelmed",
  "I need to get something off my mind",
  "I want to check in with myself",
];
type DialogState = {
  kind: "rename" | "delete" | "account" | "logout";
  chat?: Conversation;
};
export default function Chat({
  session,
  onSession,
}: {
  session: Session;
  onSession: (s: Session) => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width:760px)").matches,
  );
  const navigationRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [title, setTitle] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [working, setWorking] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lock = useRef(false);
  const request = useRef<{
    content: string;
    id: string;
    conversationId: string;
  } | null>(null);
  const current = conversations.find((c) => c.id === selected);
  useEffect(() => {
    const query = window.matchMedia("(max-width:760px)");
    const changed = () => {
      setMobile(query.matches);
      if (!query.matches) setSidebar(false);
    };
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (!sidebar || !mobile) return;
    const menuButton = menuRef.current;
    navigationRef.current
      ?.querySelector<HTMLButtonElement>(".new-chat")
      ?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !dialogRef.current?.open) setSidebar(false);
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      menuButton?.focus();
    };
  }, [sidebar, mobile]);
  async function loadList() {
    setListError("");
    try {
      setConversations(await api<Conversation[]>("/conversations"));
    } catch (e) {
      setListError(errorMessage(e));
    }
  }
  useEffect(() => {
    let active = true;
    api<Conversation[]>("/conversations")
      .then((data) => {
        if (active) setConversations(data);
      })
      .catch((e) => {
        if (active) setListError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    api<Message[]>(`/conversations/${selected}/messages`, {
      signal: controller.signal,
    })
      .then(setMessages)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selected]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);
  useEffect(() => {
    if (dialog) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [dialog]);
  function choose(id: string | null) {
    if (lock.current) return;
    setMessages([]);
    setError("");
    setInput("");
    setLoading(!!id);
    setSelected(id);
    setSidebar(false);
    request.current = null;
  }
  function upsert(chat: Conversation) {
    setConversations((all) => [chat, ...all.filter((c) => c.id !== chat.id)]);
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (
      lock.current ||
      !input.trim() ||
      loading ||
      current?.status === "archived"
    )
      return;
    lock.current = true;
    setSending(true);
    setError("");
    const content = input.trim();
    setPending(content);
    setInput("");
    try {
      let id = selected;
      if (!id) {
        const chat = await api<Conversation>("/conversations", {
          method: "POST",
          body: "{}",
        });
        upsert(chat);
        id = chat.id;
        setSelected(id);
      }
      const previous = request.current;
      const requestId =
        previous?.content === content && previous.conversationId === id
          ? previous.id
          : crypto.randomUUID();
      request.current = { content, id: requestId, conversationId: id };
      const result = await api<Exchange>(`/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, requestId }),
      });
      upsert(result.conversation);
      setMessages(await api<Message[]>(`/conversations/${id}/messages`));
      request.current = null;
    } catch (e) {
      setError(errorMessage(e));
      setInput(content);
    } finally {
      setPending("");
      setSending(false);
      lock.current = false;
      inputRef.current?.focus();
    }
  }
  async function archive(chat: Conversation) {
    if (lock.current) return;
    setError("");
    try {
      upsert(
        await api<Conversation>(`/conversations/${chat.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: chat.status === "active" ? "archived" : "active",
          }),
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function download() {
    try {
      const data = await api<unknown>("/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `still-conversations-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  function openDialog(value: DialogState) {
    setDialogError("");
    setTitle(value.chat?.title ?? "");
    setDialog(value);
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!dialog || working) return;
    setWorking(true);
    setDialogError("");
    try {
      if (dialog.kind === "rename" && dialog.chat)
        upsert(
          await api<Conversation>(`/conversations/${dialog.chat.id}`, {
            method: "PATCH",
            body: JSON.stringify({ title }),
          }),
        );
      if (dialog.kind === "delete" && dialog.chat) {
        await api(`/conversations/${dialog.chat.id}`, { method: "DELETE" });
        setConversations((all) => all.filter((c) => c.id !== dialog.chat?.id));
        if (selected === dialog.chat.id) choose(null);
      }
      if (dialog.kind === "account" || dialog.kind === "logout") {
        await api(dialog.kind === "account" ? "/account" : "/auth/logout", {
          method: dialog.kind === "account" ? "DELETE" : "POST",
          body: JSON.stringify(
            dialog.kind === "account" ? { confirm: "DELETE" } : {},
          ),
        });
        onSession({ ...session, user: null });
      }
      setDialog(null);
    } catch (e) {
      setDialogError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="app-shell">
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside
        className={`sidebar ${sidebar ? "is-open" : ""}`}
        aria-label="Main navigation"
        id="main-navigation"
        ref={navigationRef}
        inert={mobile && !sidebar}
      >
        <button
          className="icon-button mobile-menu sidebar-close"
          aria-label="Close menu"
          onClick={() => setSidebar(false)}
        >
          <Icon name="close" />
        </button>
        <Link to="/" className="wordmark">
          <span className="brand-mark">s.</span>still
          <span className="sidebar-wordmark-note">YOUR SPACE TO REFLECT</span>
        </Link>
        <button
          className="button primary new-chat"
          onClick={() => choose(null)}
          disabled={sending}
        >
          <Icon name="plus" /> New conversation
        </button>
        <div className="sidebar-section-label">
          YOUR CONVERSATIONS{" "}
          <span>
            {conversations
              .filter((c) => c.status === "active")
              .length.toString()
              .padStart(2, "0")}
          </span>
        </div>
        <div className="conversation-scroll">
          {listError && (
            <div className="error" role="alert">
              {listError}
              <button className="text-button" onClick={loadList}>
                Try again
              </button>
            </div>
          )}
          {!listError && !loading && !conversations.length && (
            <p className="sidebar-empty">
              A fresh start.
              <br />
              Your conversations will appear here.
            </p>
          )}
          {conversations
            .filter((c) => c.status === "active")
            .map((chat) => (
              <button
                className={`conversation-item ${selected === chat.id ? "selected" : ""}`}
                key={chat.id}
                disabled={sending || selected === chat.id}
                onClick={() => choose(chat.id)}
              >
                <Icon name="chat" size={17} />
                <span>{chat.title}</span>
              </button>
            ))}
          {conversations.some((c) => c.status === "archived") && (
            <>
              <button
                className="archive-toggle"
                aria-expanded={showArchived}
                onClick={() => setShowArchived(!showArchived)}
              >
                <Icon name="archive" size={16} /> Archived{" "}
                <span>{showArchived ? "−" : "+"}</span>
              </button>
              {showArchived &&
                conversations
                  .filter((c) => c.status === "archived")
                  .map((chat) => (
                    <button
                      className={`conversation-item ${selected === chat.id ? "selected" : ""}`}
                      key={chat.id}
                      disabled={sending || selected === chat.id}
                      onClick={() => choose(chat.id)}
                    >
                      <Icon name="chat" size={17} />
                      <span>{chat.title}</span>
                    </button>
                  ))}
            </>
          )}
        </div>
        <div className="sidebar-bottom">
          <Link to="/resources" className="sidebar-link">
            <Icon name="book" /> Support & resources <span>↗</span>
          </Link>
          <button className="sidebar-link" onClick={download}>
            <Icon name="download" /> Export conversations
          </button>
          <div className="user-row">
            <span className="avatar">
              {session.user?.guest
                ? "G"
                : session.user?.email?.charAt(0).toUpperCase()}
            </span>
            <div>
              <strong>
                {session.user?.guest ? "Guest space" : session.user?.email}
              </strong>
              <span>
                {session.user?.guest
                  ? "Temporary · up to 24 hours"
                  : "Your personal space"}
              </span>
            </div>
            <button
              className="icon-button"
              title="Sign out"
              aria-label="Sign out"
              disabled={sending}
              onClick={() => openDialog({ kind: "logout" })}
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
          <button
            className="delete-account"
            disabled={sending}
            onClick={() => openDialog({ kind: "account" })}
          >
            {session.user?.guest
              ? "Delete guest data"
              : "Delete account & data"}
          </button>
        </div>
      </aside>
      <main className="chat-main" inert={mobile && sidebar}>
        <header className="chat-header">
          <div className="header-title">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={sidebar}
              aria-controls="main-navigation"
              ref={menuRef}
              onClick={() => setSidebar(true)}
            >
              <Icon name="menu" />
            </button>
            <span className="header-dot" /> A little room to breathe
          </div>
          <Link to="/resources" className="header-resource">
            Find support <span>↗</span>
          </Link>
        </header>
        <div
          className={`mode-banner ${session.mode === "demo" ? "" : "ai-mode"}`}
        >
          <span className="status-dot" />
          {session.mode === "demo" ? "DEMO SPACE" : "AI COMPANION"}
          <span>
            {session.mode === "demo"
              ? "Replies are scripted. This space is for trying the experience."
              : "Replies can be mistaken. Your messages are sent to OpenAI."}
          </span>
        </div>
        {session.user?.guest && (
          <div className="guest-banner">
            Guest chats expire after 24 hours and are deleted when you sign out.
          </div>
        )}
        {current && (
          <div className="conversation-toolbar">
            <span>{current.title}</span>
            <button
              className="icon-button"
              aria-label="Rename conversation"
              disabled={sending}
              onClick={() => openDialog({ kind: "rename", chat: current })}
            >
              <Icon name="edit" size={17} />
            </button>
            <button
              className="icon-button"
              aria-label={
                current.status === "active"
                  ? "Archive conversation"
                  : "Restore conversation"
              }
              title={current.status === "active" ? "Archive" : "Restore"}
              disabled={sending}
              onClick={() => archive(current)}
            >
              <Icon name="archive" size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Delete conversation"
              disabled={sending}
              onClick={() => openDialog({ kind: "delete", chat: current })}
            >
              <Icon name="trash" size={17} />
            </button>
          </div>
        )}
        <div className="chat-scroll">
          {loading ? (
            <p className="loading" role="status">
              Opening your space…
            </p>
          ) : messages.length === 0 && !pending ? (
            <section className="empty-state">
              <div className="wellbeing-symbol">
                <Icon name="leaf" size={37} />
              </div>
              <span className="eyebrow">NO PERFECT WORDS NEEDED</span>
              <h1>
                What’s on your
                <br />
                <em>mind today?</em>
              </h1>
              <p>
                A thought, a feeling, or just a long day.
                <br />
                You can start wherever you are.
              </p>
              <div className="starters">
                {starters.map((text, i) => (
                  <button
                    key={text}
                    disabled={current?.status === "archived"}
                    onClick={() => {
                      setInput(text);
                      inputRef.current?.focus();
                    }}
                  >
                    <span className="starter-number">0{i + 1}</span>
                    {text}
                    <span className="starter-arrow">↗</span>
                  </button>
                ))}
              </div>
              <span className="empty-footnote">
                Take your time. This moment is yours.
              </span>
            </section>
          ) : (
            <div
              className="messages"
              role="log"
              aria-label="Conversation"
              aria-live="polite"
            >
              {messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  <div
                    className={`message-avatar ${message.role === "assistant" ? "still-avatar" : ""}`}
                  >
                    {message.role === "assistant" ? "s." : "Y"}
                  </div>
                  <div className="message-body">
                    <div className="message-meta">
                      <strong>
                        {message.role === "assistant" ? "Still" : "You"}
                      </strong>
                      <time dateTime={message.createdAt}>
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                      {message.role === "assistant" &&
                        session.mode === "demo" && <span>DEMO</span>}
                    </div>
                    <p>{message.content}</p>
                    {message.role === "assistant" &&
                      message.safetyCategory !== "none" && (
                        <Link className="support-link" to="/resources">
                          Find human support ↗
                        </Link>
                      )}
                  </div>
                </article>
              ))}
              {pending && (
                <>
                  <article className="message user pending">
                    <div className="message-avatar">Y</div>
                    <div className="message-body">
                      <div className="message-meta">
                        <strong>You</strong>
                        <span>Sending…</span>
                      </div>
                      <p>{pending}</p>
                    </div>
                  </article>
                  <div className="thinking" role="status">
                    <span className="message-avatar still-avatar">s.</span>
                    <span className="typing-dots">•••</span>
                    <span>Making a little space for your thoughts…</span>
                  </div>
                </>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>
        <div className="composer-area">
          {error && (
            <div className="error chat-error" role="alert">
              {error}
              <button className="text-button" onClick={() => setError("")}>
                Dismiss
              </button>
            </div>
          )}
          {current?.status === "archived" ? (
            <div className="archived-notice">
              This conversation is archived.
              <button className="text-button" onClick={() => archive(current)}>
                Restore to continue
              </button>
            </div>
          ) : (
            <form className="composer" onSubmit={send}>
              <label className="sr-only" htmlFor="message">
                Your message
              </label>
              <textarea
                ref={inputRef}
                id="message"
                rows={2}
                maxLength={4000}
                value={input}
                disabled={sending || loading}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Put your thoughts into words…"
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-footer">
                <span>
                  {input.length > 3500
                    ? `${input.length} / 4000`
                    : "Enter to send · Shift + Enter for a new line"}
                </span>
                <button
                  className="send-button"
                  aria-label="Send message"
                  disabled={!input.trim() || sending || loading}
                >
                  <Icon name="send" size={19} />
                </button>
              </div>
            </form>
          )}
          <p className="composer-disclaimer">
            For reflection, not diagnosis or emergency care.{" "}
            <Link to="/resources">Need human support?</Link>
          </p>
        </div>
      </main>
      <dialog
        ref={dialogRef}
        className="modal"
        aria-labelledby="dialog-title"
        onCancel={(event) => {
          if (working) event.preventDefault();
          else setDialog(null);
        }}
      >
        <form onSubmit={confirm}>
          <h2 id="dialog-title">
            {dialog?.kind === "rename"
              ? "A name for this conversation"
              : dialog?.kind === "delete"
                ? "Delete this conversation?"
                : dialog?.kind === "logout"
                  ? "Ready to step away?"
                  : session.user?.guest
                    ? "Delete your guest space?"
                    : "Delete your account?"}
          </h2>
          <p>
            {dialog?.kind === "rename"
              ? "Choose a title that feels right to you."
              : dialog?.kind === "logout"
                ? session.user?.guest
                  ? "Signing out permanently deletes your guest conversations."
                  : "Your conversations will be here when you return."
                : "This permanently removes the selected data from this app. This cannot be undone."}
          </p>
          {dialog?.kind === "rename" && (
            <>
              <label htmlFor="chat-title">Conversation title</label>
              <input
                autoFocus
                id="chat-title"
                required
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </>
          )}
          {dialogError && (
            <div className="error" role="alert">
              {dialogError}
            </div>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              disabled={working}
              onClick={() => setDialog(null)}
            >
              Cancel
            </button>
            <button
              className={`button ${dialog?.kind === "delete" || dialog?.kind === "account" ? "danger" : "primary"}`}
              disabled={working || (dialog?.kind === "rename" && !title.trim())}
            >
              {working
                ? "Just a moment…"
                : dialog?.kind === "rename"
                  ? "Save title"
                  : dialog?.kind === "logout"
                    ? "Sign out"
                    : "Delete permanently"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
