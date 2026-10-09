"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, LoaderCircle, Plus, Sparkles, X } from "lucide-react";
import { savedTaskSchema, taskInputSchema, type Task, type TaskInput } from "@/lib/contracts";
import styles from "./TaskComposer.module.css";

const empty: TaskInput = { title: "", description: "", stage: "Brief" };
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

// Creating and moving are mutually exclusive: `locked` disables New task while
// the Move task panel is in use.
export function TaskComposer({ onCreated, actions, children, locked = false, onActiveChange }: {
  onCreated: (task: Task) => void;
  actions?: ReactNode;
  children?: ReactNode;
  locked?: boolean;
  onActiveChange?: (active: boolean) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TaskInput>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [success, setSuccess] = useState("");
  const savingRef = useRef(false);
  const rejectedRef = useRef(false);
  const requestIdRef = useRef("");
  const mounted = useRef(true);
  const titleRef = useRef<HTMLInputElement>(null);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); newButtonRef.current?.focus(); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onActiveChange?.(open || saving); }, [open, saving, onActiveChange]);

  const openForm = () => {
    if (open || savingRef.current || locked) return;
    requestIdRef.current = crypto.randomUUID();
    rejectedRef.current = false;
    setDraft(empty); setError(""); setUncertain(false); setSuccess(""); setOpen(true);
    void frame().then(() => titleRef.current?.focus());
  };

  const save = async () => {
    if (savingRef.current) return;
    const parsed = taskInputSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Check the task details."); return; }
    savingRef.current = true; setSaving(true); setError("");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...parsed.data, requestId: requestIdRef.current }), signal: AbortSignal.timeout(8000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        // A lost/5xx response may follow a commit. Keep the same request ID and
        // fields for a safe retry instead of silently creating another task.
        const unknown = response.status >= 500 || response.status === 408;
        rejectedRef.current = !unknown;
        if (mounted.current) { setUncertain(unknown); setError(unknown ? "The save could not be confirmed. Retry this task safely, or refresh to check your project." : typeof payload?.error === "string" ? payload.error : "The task could not be saved. Try again."); }
        return;
      }
      const task = savedTaskSchema.safeParse(payload?.task);
      if (!task.success || task.data.title !== parsed.data.title || task.data.stage !== parsed.data.stage || task.data.description !== parsed.data.description) throw new Error("Invalid save receipt");
      onCreated(task.data);
      if (mounted.current) { setUncertain(false); setSuccess(`Added “${task.data.title}” to ${task.data.stage}.`); close(); }
    } catch {
      if (mounted.current) { setUncertain(true); setError("The save could not be confirmed. Retry this task safely, or refresh to check your project."); }
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const change = (patch: Partial<TaskInput>) => {
    setDraft(previous => ({ ...previous, ...patch })); setError("");
    // Editing after a definitive rejection is a new request, never a conflicting retry.
    if (rejectedRef.current) { requestIdRef.current = crypto.randomUUID(); rejectedRef.current = false; }
  };

  return <div className={styles.composer}>
    <div className={styles.heading}><p>{success ? <><Check size={15} /> <span role="status">{success}</span></> : <><Sparkles size={15} /> <span>Add a task to this project.</span></>}</p>{actions}<button ref={newButtonRef} type="button" className="button button-primary" disabled={saving || locked} onClick={openForm}><Plus size={16} /> New task</button></div>
    {open && <form className={styles.form} aria-label="New task" noValidate aria-busy={saving} onSubmit={event => { event.preventDefault(); void save(); }} onKeyDown={event => { if (event.key === "Escape" && !saving) { event.stopPropagation(); close(); } }}>
      <div className={styles.formTitle}><h2>New task</h2><button type="button" className="icon-button" aria-label="Close new task" disabled={saving} onClick={close}><X size={16} /></button></div>
      <div className={styles.fields}><div className={styles.name}><label htmlFor={`${id}-title`}>Task name</label><input ref={titleRef} id={`${id}-title`} value={draft.title} disabled={saving || uncertain} onChange={event => change({ title: event.target.value })} placeholder="What needs to be done?" aria-describedby={error ? `${id}-error` : undefined} /></div><div><label htmlFor={`${id}-stage`}>Stage</label><select id={`${id}-stage`} value={draft.stage} disabled={saving || uncertain} onChange={event => change({ stage: event.target.value as TaskInput["stage"] })}>{["Brief", "Build", "Review", "Handoff"].map(stage => <option key={stage}>{stage}</option>)}</select></div></div>
      <label htmlFor={`${id}-description`}>Description</label><textarea id={`${id}-description`} value={draft.description} disabled={saving || uncertain} rows={2} onChange={event => change({ description: event.target.value })} placeholder="Optional — add a little context…" />
      {error && <p className="form-error" id={`${id}-error`} role="alert">{error}</p>}
      <div className={styles.footer}><span>Only your account can access this task</span><button type="button" className="button button-outline" disabled={saving} onClick={close}>Cancel</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}{saving ? "Adding…" : uncertain ? "Retry save" : "Add task"}</button></div>
    </form>}
    {children}
  </div>;
}
