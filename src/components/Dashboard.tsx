"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RotateCcw } from "lucide-react";
import type { DemoTab, Workspace } from "@/lib/contracts";
import { AppHeader } from "./AppChrome";
import { LaunchpadTabs } from "./LaunchpadTabs";
import { ProjectTasks } from "./ProjectTasks";
import { TaskComposer } from "./TaskComposer";
import { TaskMover, type TaskMoverHandle } from "./TaskMover";

export function Dashboard({ workspace }: { workspace: Workspace }) {
  useEffect(() => { document.title = `${workspace.projectName} | Launchpad`; }, [workspace.projectName]);
  const [activeTab, setActiveTab] = useState<DemoTab>("overview");
  const [tasks, setTasks] = useState(workspace.tasks);
  const [focusTask, setFocusTask] = useState<{ id: string; token: number } | null>(null);
  const [composerActive, setComposerActive] = useState(false);
  const moverRef = useRef<TaskMoverHandle>(null);
  const revealTask = (id: string) => setFocusTask(previous => ({ id, token: (previous?.token ?? 0) + 1 }));
  const [resetText, setResetText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const resettingRef = useRef(false);
  const router = useRouter();
  const resetWorkspace = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (resettingRef.current || resetText !== "RESET") return;
    resettingRef.current = true; setResetting(true); setResetError("");
    try {
      const response = await fetch("/api/reset", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: resetText }), signal: AbortSignal.timeout(20000) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "The workspace could not be reset. Please try again.");
      router.replace("/onboarding"); router.refresh();
    } catch (cause) {
      setResetError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "The reset did not finish in time. Refresh to check your workspace before trying again.");
      resettingRef.current = false; setResetting(false);
    }
  };
  return <div className="dashboard-page"><AppHeader workspaceName={workspace.workspaceName} /><main className="dashboard-main">
    <LaunchpadTabs activeTab={activeTab} onTabChange={setActiveTab} workspaceName={workspace.workspaceName} projectName={workspace.projectName} workflow={workspace.workflow} taskCount={tasks.length} saved>
      <TaskMover moverRef={moverRef} tasks={tasks} locked={composerActive} onMoved={task => { setTasks(previous => previous.map(item => item.id === task.id ? task : item)); revealTask(task.id); }}>
        {mover => <TaskComposer actions={mover.trigger} locked={mover.active} onActiveChange={setComposerActive} onCreated={task => { setTasks(previous => previous.some(item => item.id === task.id) ? previous : [...previous, task]); revealTask(task.id); }}>{mover.panel}</TaskComposer>}
      </TaskMover>
      <ProjectTasks tasks={tasks} focusTask={focusTask} projectName={workspace.projectName} view={activeTab === "workflow" ? "list" : "board"} onMoveTask={task => moverRef.current?.openFor(task)} moveDisabled={composerActive} />
    <details className="reset-panel"><summary><RotateCcw size={14} /> Reset demo workspace</summary><form onSubmit={resetWorkspace} noValidate aria-busy={resetting}><h2>Start this demo again</h2><p>This removes your workspace, project, and sample tasks. Your account stays signed in. Other users’ workspaces are untouched.</p><label htmlFor="reset-confirmation">Type RESET to confirm</label><div className="reset-controls"><input id="reset-confirmation" value={resetText} onChange={event => setResetText(event.target.value)} autoComplete="off" spellCheck={false} disabled={resetting} aria-describedby="reset-hint" /><button className="button button-danger" type="submit" disabled={resetText !== "RESET" || resetting}>{resetting ? <LoaderCircle className="spin" size={16} /> : <RotateCcw size={16} />}{resetting ? "Resetting workspace…" : "Reset my demo workspace"}</button></div><p id="reset-hint" className="reset-hint">This cannot be undone. Available in the local demo only.</p>{resetError && <p className="form-error" role="alert">{resetError}</p>}</form></details>
    </LaunchpadTabs>
    </main></div>;
}

export default Dashboard;
