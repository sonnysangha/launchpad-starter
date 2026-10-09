"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowRightLeft, Check, LoaderCircle, X } from "lucide-react";
import { moveTaskReceiptSchema, stageSchema, type Stage, type Task } from "@/lib/contracts";
import styles from "./TaskMover.module.css";

export type TaskMoverHandle = { openFor: (task: Task) => void };
type MoveDraft = { taskId: string; stage: Stage | "" };
const empty: MoveDraft = { taskId: "", stage: "" };
const stages = stageSchema.options;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

// The trigger sits beside New task and the panel below it; `children` places both.
// Like TaskComposer, `locked` disables the trigger while the other task tool is in use.
export function TaskMover({ tasks, onMoved, moverRef, locked = false, children }: {
  tasks: Task[];
  onMoved: (task: Task) => void;
  moverRef?: Ref<TaskMoverHandle>;
  locked?: boolean;
  children: (parts: { trigger: ReactNode; panel: ReactNode; active: boolean }) => ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MoveDraft>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [success, setSuccess] = useState("");
  const openRef = useRef(false);
  const savingRef = useRef(false);
  const rejectedRef = useRef(false);
  const draftRef = useRef<MoveDraft>(empty);
  const requestIdRef = useRef("");
  const mounted = useRef(true);
  const selectRef = useRef<HTMLSelectElement>(null);
  const stagesRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const publishDraft = (value: MoveDraft) => { draftRef.current = value; setDraft(value); };
  const close = () => { openRef.current = false; setOpen(false); };
  const focusStages = () => void frame().then(() => stagesRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const openPanel = (focus: "select" | "stage", taskId = "") => {
    if (openRef.current || savingRef.current || locked) return;
    openRef.current = true;
    requestIdRef.current = crypto.randomUUID();
    rejectedRef.current = false;
    publishDraft({ taskId, stage: "" }); setError(""); setUncertain(false); setSuccess(""); setOpen(true);
    if (focus === "select") void frame().then(() => selectRef.current?.focus());
    else focusStages();
  };

  const save = async () => {
    if (savingRef.current) return;
    const { taskId, stage } = draftRef.current;
    const task = tasks.find(item => item.id === taskId);
    const problem = !task ? "Choose a task to move." : !stage ? "Choose the stage to move this task to." : task.stage === stage ? `This task is already in ${stage}.` : "";
    if (!task || !stage || problem) { setError(problem); return; }
    // fromStage is the stage this browser shows. The server applies the move only
    // if the task is still there, so a stale board can never overwrite a change.
    const sent = { requestId: requestIdRef.current, taskId, fromStage: task.stage, stage };
    savingRef.current = true; setSaving(true); setError("");
    try {
      const response = await fetch("/api/tasks/stage", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sent), signal: AbortSignal.timeout(8000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        // A lost/5xx response may follow a commit. Keep the same request ID and
        // fields for a safe retry instead of reporting a move that may not exist.
        const unknown = response.status >= 500 || response.status === 408;
        rejectedRef.current = !unknown;
        if (mounted.current) { setUncertain(unknown); setError(unknown ? "The move could not be confirmed. Retry this move safely, or refresh to check your project." : typeof payload?.error === "string" ? payload.error : "The task could not be moved. Try again."); }
        return;
      }
      const receipt = moveTaskReceiptSchema.safeParse(payload);
      if (!receipt.success || receipt.data.task.id !== sent.taskId || receipt.data.task.stage !== sent.stage || receipt.data.fromStage !== sent.fromStage) throw new Error("Invalid move receipt");
      const moved = receipt.data.task;
      onMoved(moved);
      if (mounted.current) {
        setUncertain(false); setSuccess(`Moved “${moved.title}” from ${receipt.data.fromStage} to ${moved.stage}.`);
        // The trigger re-enables only after this save settles.
        close(); void frame().then(() => triggerRef.current?.focus());
      }
    } catch {
      if (mounted.current) { setUncertain(true); setError("The move could not be confirmed. Retry this move safely, or refresh to check your project."); }
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const change = (patch: Partial<MoveDraft>) => {
    publishDraft({ ...draftRef.current, ...patch }); setError("");
    // Changing a move after a definitive rejection is a new request, never a conflicting retry.
    if (rejectedRef.current) { requestIdRef.current = crypto.randomUUID(); rejectedRef.current = false; }
  };

  useImperativeHandle(moverRef, () => ({
    openFor: task => {
      if (savingRef.current || locked) return;
      if (!openRef.current) openPanel("stage", task.id);
      else { if (!uncertain) change({ taskId: task.id, stage: "" }); focusStages(); }
    },
  }));

  const selected = tasks.find(task => task.id === draft.taskId);
  const dismiss = () => { close(); triggerRef.current?.focus(); };
  const trigger = <button ref={triggerRef} type="button" className={`button button-outline ${styles.trigger}`} aria-label="Move task" aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined} title="Move a task to another stage" disabled={saving || locked || tasks.length === 0} onClick={() => openPanel("select")}><ArrowRightLeft size={15} /><span>Move task</span></button>;
  const panel = <>
    {open && <form id={`${id}-panel`} className={styles.panel} aria-label="Move task" noValidate aria-busy={saving} onSubmit={event => { event.preventDefault(); void save(); }} onKeyDown={event => { if (event.key === "Escape" && !saving) { event.stopPropagation(); dismiss(); } }}>
      <div className={styles.title}><h2><ArrowRightLeft size={15} /> Move task</h2><button type="button" className="icon-button" aria-label="Close move task" disabled={saving} onClick={dismiss}><X size={16} /></button></div>
      <label htmlFor={`${id}-task`}>Task</label>
      <select ref={selectRef} id={`${id}-task`} value={draft.taskId} disabled={saving || uncertain} aria-describedby={`${id}-current`} onChange={event => { const next = tasks.find(task => task.id === event.target.value); change({ taskId: event.target.value, stage: next?.stage === draftRef.current.stage ? "" : draftRef.current.stage }); }}>
        <option value="" disabled>Choose a task…</option>
        {tasks.map((task, index) => <option key={task.id} value={task.id}>{`LP-${String(index + 1).padStart(2, "0")} · ${task.title}`}</option>)}
      </select>
      <p id={`${id}-current`} className={styles.current}>{selected ? `Currently in ${selected.stage}` : "Choose a task to see its stage."}</p>
      <p id={`${id}-stages`} className={styles.label}>Move to</p>
      <div ref={stagesRef} className={styles.stages} role="group" aria-labelledby={`${id}-stages`}>{stages.map(stage => <button type="button" key={stage} aria-pressed={draft.stage === stage} disabled={saving || uncertain || !selected || selected.stage === stage} onClick={() => change({ stage })}>{stage}{selected?.stage === stage && <small>Current</small>}</button>)}</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className={styles.footer}><span>Its name, details, and reference stay the same</span><button type="button" className="button button-outline" disabled={saving} onClick={dismiss}>Cancel</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <ArrowRightLeft size={15} />}{saving ? "Moving…" : uncertain ? "Retry move" : "Move task"}</button></div>
    </form>}
    {!open && success && <p className={styles.status}><Check size={15} /> <span role="status">{success}</span></p>}
  </>;
  return children({ trigger, panel, active: open || saving });
}
