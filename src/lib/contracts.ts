import { z } from "zod";

export const workflowSchema = z.enum(["client_delivery", "campaign"]);
export const demoTabSchema = z.enum(["overview", "workflow", "roles", "handbook"]);
export type DemoTab = z.infer<typeof demoTabSchema>;
export const nameSchema = z.string().trim().refine(
  (value) => [...value].length >= 2 && [...value].length <= 80,
  "Use between 2 and 80 characters.",
).refine((value) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value), "Control characters are not allowed.");

export const draftSchema = z.object({
  workspaceName: nameSchema,
  projectName: nameSchema,
  workflow: workflowSchema,
}).strict();

export const createWorkspaceSchema = draftSchema.extend({ confirmed: z.literal(true) }).strict();
export const stageSchema = z.enum(["Brief", "Build", "Review", "Handoff"]);
const taskTextSchema = z.string().refine(
  (value) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value), "Control characters are not allowed.",
).trim();
export const taskInputSchema = z.object({
  title: taskTextSchema.refine((value) => [...value].length >= 2 && [...value].length <= 120,
    "Use between 2 and 120 characters for the task title."),
  description: taskTextSchema.refine((value) => [...value].length <= 500,
    "Use no more than 500 characters for the task description.").default(""),
  stage: stageSchema.default("Brief"),
}).strict();
export const createTaskSchema = taskInputSchema.extend({ requestId: z.uuid() }).strict();
// Both stages are required: the server applies a move only if the task is
// still where the caller saw it, so a stale view can never overwrite a change.
export const moveTaskSchema = z.object({
  requestId: z.uuid(),
  taskId: z.uuid(),
  fromStage: stageSchema,
  stage: stageSchema,
}).strict().refine((input) => input.fromStage !== input.stage, "Choose a different stage for this task.");
export const resetSchema = z.object({ confirmation: z.literal("RESET") }).strict();

export type Draft = z.infer<typeof draftSchema>;
export type Workflow = Draft["workflow"];
export type Stage = z.infer<typeof stageSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type CreateTaskInput = z.input<typeof createTaskSchema>;
const savedTextSchema = (max: number) => z.string().refine(value => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && [...value].length <= max);
// Sample tasks carry a short display tag; a created task never does.
export const savedTaskSchema = taskInputSchema.extend({ id: z.uuid(), tag: savedTextSchema(40).optional() }).strict();
// A move receipt echoes the whole stored task, so its stage is never defaulted.
export const moveTaskReceiptSchema = z.object({
  task: savedTaskSchema.extend({ stage: stageSchema }).strict(), fromStage: stageSchema, replayed: z.boolean(),
}).strict();
export type Task = { id: string; title: string; stage: Stage; description?: string; tag?: string };
export type MoveTaskInput = z.input<typeof moveTaskSchema>;
export type MoveTaskResult = { task: Task; fromStage: Stage; replayed: boolean };
export type Workspace = Draft & { id: string; tasks: Task[]; createdAt: string };
