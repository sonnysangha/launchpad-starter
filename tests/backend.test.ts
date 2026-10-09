import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createTaskSchema, createWorkspaceSchema, draftSchema, moveTaskSchema, taskInputSchema, type Draft } from "../src/lib/contracts";
import { AppError, apiError } from "../src/lib/errors";
import { assertSameOrigin, readJson } from "../src/lib/request-security";
import { LaunchpadStore } from "../src/lib/store";
import { getPreviewTasks } from "../src/lib/sample-tasks";

const draft: Draft = { workspaceName: "Orbit Studio", projectName: "Fictional brand launch", workflow: "client_delivery" };
const origin = "http://127.0.0.1:3212";

test("workspace and project persist atomically, repeat Create is idempotent, owners remain isolated", () => {
  const directory = mkdtempSync(join(tmpdir(), "launchpad-store-"));
  const path = join(directory, "test.sqlite");
  let store = new LaunchpadStore(path);
  try {
    assert.equal(store.getWorkspace("clerk-a"), null);
    const first = store.createWorkspace("clerk-a", draft);
    assert.equal(first.created, true);
    assert.equal(first.workspace.tasks.length, 6);
    assert.deepEqual([...new Set(first.workspace.tasks.map((task) => task.stage))], ["Brief", "Build", "Review", "Handoff"]);
    const repeated = store.createWorkspace("clerk-a", { ...draft, projectName: "Changed name" });
    assert.equal(repeated.created, false);
    assert.deepEqual(repeated.workspace, first.workspace);
    const other = store.createWorkspace("clerk-b", { ...draft, workflow: "campaign" });
    assert.notEqual(other.workspace.id, first.workspace.id);
    assert.notDeepEqual(other.workspace.tasks.map((task) => task.title), first.workspace.tasks.map((task) => task.title));
    // Preview promises the exact task content Create will save, but must never
    // reuse its deterministic preview IDs as persisted identities.
    for (const workspace of [first.workspace, other.workspace]) {
      const preview = getPreviewTasks(workspace.workflow);
      const content = (tasks: typeof preview) => tasks.map(({ id: _id, ...task }) => task);
      assert.deepEqual(content(preview), content(workspace.tasks));
      assert.ok(workspace.tasks.every(task => !preview.some(item => item.id === task.id)));
      assert.equal(new Set(workspace.tasks.map(task => task.id)).size, workspace.tasks.length);
    }
    assert.equal(store.getWorkspace("clerk-c"), null);
    store.close();
    store = new LaunchpadStore(path);
    assert.deepEqual(store.getWorkspace("clerk-a"), first.workspace);
    store.resetWorkspace("clerk-a");
    assert.equal(store.getWorkspace("clerk-a"), null);
    assert.deepEqual(store.getWorkspace("clerk-b"), other.workspace);
    assert.throws(() => store.createWorkspace("clerk-c", { ...draft, workspaceName: "x" }));
    assert.equal(store.getWorkspace("clerk-c"), null);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Create requires explicit confirmation and rejects ownership injection or unknown fields", () => {
  assert.equal(createWorkspaceSchema.safeParse(draft).success, false);
  assert.equal(createWorkspaceSchema.safeParse({ ...draft, confirmed: false }).success, false);
  assert.equal(createWorkspaceSchema.safeParse({ ...draft, confirmed: true, ownerId: "someone-else" }).success, false);
  assert.equal(createWorkspaceSchema.safeParse({ ...draft, confirmed: true }).success, true);
  assert.equal(draftSchema.safeParse({ ...draft, workflow: "payments" }).success, false);
  assert.equal(draftSchema.safeParse({ ...draft, workspaceName: "bad\u0000name" }).success, false);
  assert.equal(draftSchema.safeParse({ ...draft, workspaceName: "bad\u200ename" }).success, false);
  assert.equal(draftSchema.safeParse({ ...draft, workspaceName: "🪐".repeat(80) }).success, true);
  assert.equal(draftSchema.safeParse({ ...draft, workspaceName: "🪐".repeat(81) }).success, false);
  assert.equal(draftSchema.parse({ ...draft, workspaceName: "  Orbit Studio  " }).workspaceName, "Orbit Studio");
});

test("task inputs normalize text, count Unicode characters, and reject invalid or injected fields", async () => {
  assert.deepEqual(taskInputSchema.parse({ title: "  Plan the launch  " }), {
    title: "Plan the launch", description: "", stage: "Brief",
  });
  assert.equal(taskInputSchema.safeParse({ title: "🪐".repeat(120), description: "🪐".repeat(500) }).success, true);
  for (const input of [
    { title: "x" }, { title: "   " }, { title: "🪐".repeat(121) },
    { title: "New task", description: "🪐".repeat(501) },
    { title: "Bad\u0000title" }, { title: "\nHidden control" },
    { title: "New task", description: "Bad\u200edescription" },
    { title: "New task", stage: "Done" }, { title: "New task", ownerId: "another-owner" },
    { title: "New task", id: "existing-task" },
  ]) assert.equal(taskInputSchema.safeParse(input).success, false, JSON.stringify(input));
  assert.equal(createTaskSchema.safeParse({ title: "New task" }).success, false);
  assert.equal(createTaskSchema.safeParse({ title: "New task", requestId: "invalid" }).success, false);
  const request = new Request(`${origin}/api/tasks`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "New task", requestId: randomUUID(), workspaceId: "another-workspace" }) });
  await assert.rejects(readJson(request, createTaskSchema), (error) => error instanceof AppError && error.code === "INVALID_INPUT" && error.status === 400);
});

test("task creation is owner scoped, persistent, and idempotent across store connections", () => {
  const directory = mkdtempSync(join(tmpdir(), "launchpad-tasks-"));
  const path = join(directory, "test.sqlite");
  let store = new LaunchpadStore(path);
  let secondStore: LaunchpadStore | undefined;
  try {
    const firstWorkspace = store.createWorkspace("owner-a", draft).workspace;
    const otherWorkspace = store.createWorkspace("owner-b", draft).workspace;
    const input = { requestId: randomUUID(), title: "  Record the product demo  " };
    assert.throws(() => store.createTask("missing-owner", input),
      (error) => error instanceof AppError && error.code === "WORKSPACE_NOT_FOUND" && error.status === 404);
    assert.equal(store.getWorkspace("missing-owner"), null);
    const first = store.createTask("owner-a", input);
    assert.equal(first.created, true);
    assert.equal(first.task.title, "Record the product demo");
    assert.equal(first.task.description, "");
    assert.equal(first.task.stage, "Brief");
    assert.deepEqual(store.getWorkspace("owner-a")?.tasks, [...firstWorkspace.tasks, first.task]);
    assert.deepEqual(store.getWorkspace("owner-b"), otherWorkspace);
    const repeat = store.createTask("owner-a", { ...input, title: first.task.title, stage: "Brief", description: "" });
    assert.deepEqual(repeat, { task: first.task, created: false });
    assert.throws(() => store.createTask("owner-a", { ...input, title: "A different task" }),
      (error) => error instanceof AppError && error.code === "TASK_REQUEST_CONFLICT" && error.status === 409);
    assert.equal(store.getWorkspace("owner-a")?.tasks.length, 7);
    const other = store.createTask("owner-b", input);
    assert.equal(other.created, true);
    assert.notEqual(other.task.id, first.task.id);
    store.close();
    store = new LaunchpadStore(path);
    assert.deepEqual(store.createTask("owner-a", input), { task: first.task, created: false });
    secondStore = new LaunchpadStore(path);
    const next = secondStore.createTask("owner-a", { requestId: randomUUID(), title: "Review the recording", stage: "Review" });
    assert.deepEqual(store.getWorkspace("owner-a")?.tasks, [...firstWorkspace.tasks, first.task, next.task]);
    assert.deepEqual(store.getWorkspace("owner-b")?.tasks, [...otherWorkspace.tasks, other.task]);
    assert.throws(() => store.createTask("owner-a", { requestId: randomUUID(), title: "x" }));
    assert.equal(store.getWorkspace("owner-a")?.tasks.length, 8);
  } finally {
    secondStore?.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("task capacity rejects new writes while allowing safe retries, and reset removes stale requests", () => {
  const store = new LaunchpadStore(":memory:");
  try {
    const originalWorkspace = store.createWorkspace("owner-a", draft).workspace;
    const input = { requestId: randomUUID(), title: "Record the demo", description: "Show the finished dashboard", stage: "Build" as const };
    const first = store.createTask("owner-a", input);
    for (let index = 7; index < 100; index++) {
      store.createTask("owner-a", { requestId: randomUUID(), title: `Task ${index + 1}` });
    }
    assert.equal(store.getWorkspace("owner-a")?.tasks.length, 100);
    assert.deepEqual(store.createTask("owner-a", input), { task: first.task, created: false });
    assert.throws(() => store.createTask("owner-a", { requestId: randomUUID(), title: "One too many" }),
      (error) => error instanceof AppError && error.code === "TASK_LIMIT_REACHED" && error.status === 409);
    assert.equal(store.getWorkspace("owner-a")?.tasks.length, 100);
    store.resetWorkspace("owner-a");
    assert.throws(() => store.createTask("owner-a", input),
      (error) => error instanceof AppError && error.code === "WORKSPACE_NOT_FOUND");
    const recreatedWorkspace = store.createWorkspace("owner-a", draft).workspace;
    assert.notEqual(recreatedWorkspace.id, originalWorkspace.id);
    const recreatedTask = store.createTask("owner-a", input);
    assert.equal(recreatedTask.created, true);
    assert.notEqual(recreatedTask.task.id, first.task.id);
    assert.equal(store.getWorkspace("owner-a")?.tasks.length, 7);
  } finally { store.close(); }
});

test("task append rolls back if the retry record cannot be saved, and reset cascades retry history", () => {
  const directory = mkdtempSync(join(tmpdir(), "launchpad-task-atomic-"));
  const path = join(directory, "test.sqlite");
  const store = new LaunchpadStore(path);
  const inspection = new DatabaseSync(path);
  try {
    const before = store.createWorkspace("owner-a", draft).workspace;
    const input = { requestId: randomUUID(), title: "A task that must be atomic" };
    inspection.exec(`CREATE TRIGGER fail_task_request BEFORE INSERT ON task_creation_requests
      BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;`);
    assert.throws(() => store.createTask("owner-a", input));
    assert.deepEqual(store.getWorkspace("owner-a"), before);
    inspection.exec("DROP TRIGGER fail_task_request");
    assert.equal(store.createTask("owner-a", input).created, true);
    store.resetWorkspace("owner-a");
    assert.equal((inspection.prepare("SELECT COUNT(*) AS count FROM task_creation_requests").get() as { count: number }).count, 0);
  } finally {
    inspection.close(); store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("task move inputs require both distinct stages and reject preview IDs or injected fields", async () => {
  const valid = { requestId: randomUUID(), taskId: randomUUID(), fromStage: "Brief", stage: "Review" };
  assert.deepEqual(moveTaskSchema.parse(valid), valid);
  for (const input of [
    { ...valid, stage: undefined }, { ...valid, fromStage: undefined }, { ...valid, fromStage: null },
    { ...valid, stage: "Brief" }, { ...valid, stage: "Done" },
    { ...valid, taskId: "preview-campaign-1" }, { ...valid, taskId: undefined }, { ...valid, requestId: "invalid" },
    { ...valid, workspaceId: randomUUID() }, { ...valid, ownerId: "another-owner" }, { ...valid, title: "Renamed task" },
  ]) assert.equal(moveTaskSchema.safeParse(input).success, false, JSON.stringify(input));
  const request = (body: unknown) => new Request(`${origin}/api/tasks/stage`, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await assert.rejects(readJson(request({ ...valid, workspaceId: "another-workspace" }), moveTaskSchema),
    (error) => error instanceof AppError && error.code === "INVALID_INPUT" && error.status === 400);
  await assert.rejects(readJson(request({ ...valid, stage: valid.fromStage }), moveTaskSchema),
    (error) => error instanceof AppError && error.code === "INVALID_INPUT" && error.message === "Choose a different stage for this task.");
  assert.deepEqual(await readJson(request(valid), moveTaskSchema), valid);
});

test("task moves are owner scoped, update one task in place, and replay safely across store connections", () => {
  const directory = mkdtempSync(join(tmpdir(), "launchpad-task-moves-"));
  const path = join(directory, "test.sqlite");
  let store = new LaunchpadStore(path);
  let secondStore: LaunchpadStore | undefined;
  const inspection = new DatabaseSync(path);
  const receipts = () => (inspection.prepare("SELECT COUNT(*) AS count FROM task_stage_requests").get() as { count: number }).count;
  try {
    const workspace = store.createWorkspace("owner-a", draft).workspace;
    const otherWorkspace = store.createWorkspace("owner-b", draft).workspace;
    const target = workspace.tasks[0];
    assert.equal(target.stage, "Brief");
    const input = { requestId: randomUUID(), taskId: target.id, fromStage: "Brief" as const, stage: "Review" as const };
    assert.throws(() => store.moveTaskStage("missing-owner", input),
      (error) => error instanceof AppError && error.code === "WORKSPACE_NOT_FOUND" && error.status === 404);
    assert.throws(() => store.moveTaskStage("owner-b", input),
      (error) => error instanceof AppError && error.code === "TASK_NOT_FOUND" && error.status === 404);
    assert.throws(() => store.moveTaskStage("owner-a", { ...input, taskId: otherWorkspace.tasks[0].id }),
      (error) => error instanceof AppError && error.code === "TASK_NOT_FOUND" && error.status === 404);
    assert.throws(() => store.moveTaskStage("owner-a", { ...input, fromStage: "Build" }),
      (error) => error instanceof AppError && error.code === "TASK_STAGE_CHANGED" && error.status === 409);
    assert.deepEqual(store.getWorkspace("owner-a"), workspace);
    assert.deepEqual(store.getWorkspace("owner-b"), otherWorkspace);
    assert.equal(receipts(), 0);

    // The first move changes only the stage of that task, in its original position.
    const first = store.moveTaskStage("owner-a", input);
    assert.deepEqual(first, { task: { ...target, stage: "Review" }, fromStage: "Brief", replayed: false });
    assert.deepEqual(Object.keys(first.task), Object.keys(target));
    const moved = store.getWorkspace("owner-a")!;
    assert.deepEqual(moved, { ...workspace, tasks: workspace.tasks.map((task) => task.id === target.id ? first.task : task) });
    assert.deepEqual(store.getWorkspace("owner-b"), otherWorkspace);
    assert.equal(receipts(), 1);

    // An identical retry returns the stored receipt; any different body is a conflict.
    assert.deepEqual(store.moveTaskStage("owner-a", input), { ...first, replayed: true });
    for (const change of [{ stage: "Handoff" as const }, { fromStage: "Build" as const }, { taskId: workspace.tasks[1].id }]) {
      assert.throws(() => store.moveTaskStage("owner-a", { ...input, ...change }),
        (error) => error instanceof AppError && error.code === "TASK_REQUEST_CONFLICT" && error.status === 409);
    }
    assert.throws(() => store.createTask("owner-a", { requestId: input.requestId, title: "Reuse a move request" }),
      (error) => error instanceof AppError && error.code === "TASK_REQUEST_CONFLICT" && error.status === 409);
    assert.deepEqual(store.getWorkspace("owner-a"), moved);
    assert.equal(receipts(), 1);

    // A request ID already committed by a task creation can never move a task.
    const creationRequestId = randomUUID();
    const created = store.createTask("owner-a", { requestId: creationRequestId, title: "Record the product demo" }).task;
    const withCreated = store.getWorkspace("owner-a")!;
    assert.throws(() => store.moveTaskStage("owner-a", { requestId: creationRequestId, taskId: created.id, fromStage: "Brief", stage: "Build" }),
      (error) => error instanceof AppError && error.code === "TASK_REQUEST_CONFLICT" && error.status === 409);
    assert.deepEqual(store.getWorkspace("owner-a"), withCreated);
    assert.equal(receipts(), 1);

    // A stale fromStage is rejected without writing, so a later retry can still apply.
    const stale = { requestId: randomUUID(), taskId: target.id, fromStage: "Brief" as const, stage: "Build" as const };
    assert.throws(() => store.moveTaskStage("owner-a", stale),
      (error) => error instanceof AppError && error.code === "TASK_STAGE_CHANGED" && error.status === 409);
    assert.deepEqual(store.getWorkspace("owner-a"), withCreated);
    assert.equal(receipts(), 1);

    // Replaying an older move never re-applies it over a newer one.
    const second = store.moveTaskStage("owner-a", { requestId: randomUUID(), taskId: target.id, fromStage: "Review", stage: "Handoff" });
    assert.equal(second.task.stage, "Handoff");
    assert.deepEqual(store.moveTaskStage("owner-a", input), { ...first, replayed: true });
    const finalTasks = store.getWorkspace("owner-a")!.tasks;
    assert.equal(finalTasks.find((task) => task.id === target.id)?.stage, "Handoff");
    assert.deepEqual(finalTasks.map((task) => task.id), withCreated.tasks.map((task) => task.id));

    store.close();
    store = new LaunchpadStore(path);
    assert.deepEqual(store.moveTaskStage("owner-a", input), { ...first, replayed: true });
    secondStore = new LaunchpadStore(path);
    assert.deepEqual(secondStore.moveTaskStage("owner-a", input), { ...first, replayed: true });
    const fromSecond = secondStore.moveTaskStage("owner-a", { requestId: randomUUID(), taskId: created.id, fromStage: "Brief", stage: "Build" });
    assert.deepEqual(store.getWorkspace("owner-a")?.tasks, finalTasks.map((task) => task.id === created.id ? fromSecond.task : task));
    assert.deepEqual(store.getWorkspace("owner-b"), otherWorkspace);
    assert.equal(receipts(), 3);
  } finally {
    secondStore?.close(); inspection.close(); store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("task move capacity rejects new moves while allowing safe replays, and a recreated workspace starts fresh", () => {
  const store = new LaunchpadStore(":memory:", { maxTaskMoves: 3 });
  try {
    const workspace = store.createWorkspace("owner-a", draft).workspace;
    const taskId = workspace.tasks[0].id;
    const stages = ["Brief", "Build", "Review", "Handoff"] as const;
    const inputs = stages.slice(1).map((stage, index) => ({ requestId: randomUUID(), taskId, fromStage: stages[index], stage }));
    const results = inputs.map((input) => store.moveTaskStage("owner-a", input));
    const full = store.getWorkspace("owner-a");
    assert.equal(full?.tasks[0].stage, "Handoff");
    assert.deepEqual(store.moveTaskStage("owner-a", inputs[0]), { ...results[0], replayed: true });
    assert.throws(() => store.moveTaskStage("owner-a", { requestId: randomUUID(), taskId, fromStage: "Handoff", stage: "Brief" }),
      (error) => error instanceof AppError && error.code === "TASK_MOVE_LIMIT_REACHED" && error.status === 409);
    assert.deepEqual(store.getWorkspace("owner-a"), full);
    store.resetWorkspace("owner-a");
    assert.throws(() => store.moveTaskStage("owner-a", inputs[0]),
      (error) => error instanceof AppError && error.code === "WORKSPACE_NOT_FOUND");
    const recreated = store.createWorkspace("owner-a", draft).workspace;
    assert.throws(() => store.moveTaskStage("owner-a", inputs[0]),
      (error) => error instanceof AppError && error.code === "TASK_NOT_FOUND");
    const fresh = store.moveTaskStage("owner-a", { ...inputs[0], taskId: recreated.tasks[0].id });
    assert.equal(fresh.replayed, false);
  } finally { store.close(); }
});

test("task move rolls back if the receipt cannot be saved, and reset cascades receipts to zero", () => {
  const directory = mkdtempSync(join(tmpdir(), "launchpad-task-move-atomic-"));
  const path = join(directory, "test.sqlite");
  const store = new LaunchpadStore(path);
  const inspection = new DatabaseSync(path);
  const receipts = () => (inspection.prepare("SELECT COUNT(*) AS count FROM task_stage_requests").get() as { count: number }).count;
  try {
    const before = store.createWorkspace("owner-a", draft).workspace;
    const input = { requestId: randomUUID(), taskId: before.tasks[2].id, fromStage: "Build" as const, stage: "Review" as const };
    inspection.exec(`CREATE TRIGGER fail_task_move BEFORE INSERT ON task_stage_requests
      BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;`);
    assert.throws(() => store.moveTaskStage("owner-a", input));
    assert.deepEqual(store.getWorkspace("owner-a"), before);
    assert.equal(receipts(), 0);
    inspection.exec("DROP TRIGGER fail_task_move");
    assert.equal(store.moveTaskStage("owner-a", input).replayed, false);
    assert.equal(store.getWorkspace("owner-a")?.tasks[2].stage, "Review");
    assert.equal(receipts(), 1);
    store.resetWorkspace("owner-a");
    assert.equal(receipts(), 0);
  } finally {
    inspection.close(); store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mutation request checks reject cross-site requests, malformed JSON, and oversized streams", async () => {
  const request = (body: string, headers = {}) => new Request(`${origin}/api/workspace`, {
    method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body,
  });
  assert.doesNotThrow(() => assertSameOrigin(request("{}"), origin));
  assert.throws(() => assertSameOrigin(request("{}", { origin: "https://other.invalid" }), origin), (error) => error instanceof AppError && error.status === 403);
  assert.throws(() => assertSameOrigin(request("{}", { "sec-fetch-site": "cross-site" }), origin));
  assert.throws(() => assertSameOrigin(new Request(`${origin}/api/workspace`), origin));
  await assert.rejects(readJson(request("bad-json"), createWorkspaceSchema), (error) => error instanceof AppError && error.code === "INVALID_JSON");
  await assert.rejects(readJson(request(" ".repeat(9_000)), createWorkspaceSchema), (error) => error instanceof AppError && error.status === 413);
  await assert.rejects(readJson(request("{}", { "content-type": "text/plain" }), createWorkspaceSchema), (error) => error instanceof AppError && error.status === 415);
  assert.equal((await readJson(request(JSON.stringify({ ...draft, confirmed: true })), createWorkspaceSchema)).projectName, draft.projectName);
});

test("known store errors preserve their status across separately bundled server modules", async () => {
  const directory = mkdtempSync(join(tmpdir(), "launchpad-error-bundle-"));
  let store: LaunchpadStore | undefined;
  try {
    const bundle = join(directory, "store.cjs");
    await build({ entryPoints: [new URL("../src/lib/store.ts", import.meta.url).pathname], outfile: bundle,
      bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
    const { LaunchpadStore: BundledStore } = createRequire(import.meta.url)(bundle) as { LaunchpadStore: typeof LaunchpadStore };
    store = new BundledStore(":memory:");
    const input = { requestId: randomUUID(), title: "Create a real task" };
    let missingError: unknown;
    try { store.createTask("missing-owner", input); } catch (error) { missingError = error; }
    assert.ok(missingError);
    assert.equal(missingError instanceof AppError, false, "The regression must exercise a distinct bundled constructor");
    const missingResponse = apiError(missingError);
    assert.equal(missingResponse.status, 404);
    assert.deepEqual(await missingResponse.json(), { code: "WORKSPACE_NOT_FOUND", error: "Create a workspace before adding tasks." });
    store.createWorkspace("owner-a", draft);
    store.createTask("owner-a", input);
    let conflictError: unknown;
    try { store.createTask("owner-a", { ...input, title: "Different task" }); } catch (error) { conflictError = error; }
    const conflictResponse = apiError(conflictError);
    assert.equal(conflictResponse.status, 409);
    assert.equal((await conflictResponse.json()).code, "TASK_REQUEST_CONFLICT");
    let notFoundError: unknown;
    try {
      store.moveTaskStage("owner-a", { requestId: randomUUID(), taskId: randomUUID(), fromStage: "Brief", stage: "Build" });
    } catch (error) { notFoundError = error; }
    assert.ok(notFoundError);
    assert.equal(notFoundError instanceof AppError, false);
    const notFoundResponse = apiError(notFoundError);
    assert.equal(notFoundResponse.status, 404);
    assert.equal((await notFoundResponse.json()).code, "TASK_NOT_FOUND");
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("unexpected provider errors are redacted and private responses cannot be cached", async () => {
  for (const error of [new Error("private-provider-secret-in-failure"),
    { name: "AppError", code: "WORKSPACE_NOT_FOUND", status: 404, message: "private-provider-secret-in-failure" }]) {
    const response = apiError(error);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(!(await response.text()).includes("private-provider-secret"));
  }
});

