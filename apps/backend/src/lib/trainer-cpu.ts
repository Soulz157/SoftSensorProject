/**
 * How many CPUs a training container is given, and the budget the trainer is
 * told. One place, because two callers must agree: the container spawn (quota
 * and `TRAINER_CPU_BUDGET` env) and the param-grid endpoint (which tells the
 * client how many workers a search can use, so its time estimate divides by the
 * same number the trainer will actually run). See images/trainer/app/MIRRORS.md
 * entry 15.
 */

/** The container's CPU quota in Docker `NanoCpus` (1e9 per CPU). 2 CPUs unless
 *  `TRAINING_NANO_CPUS` says otherwise. */
export function configuredNanoCpus(): number {
  return Number(process.env.TRAINING_NANO_CPUS ?? 2 * 1e9);
}

/**
 * Whole CPUs in a `NanoCpus` quota, never below 1. The trainer's
 * `TRAINER_CPU_BUDGET` (images/trainer/app/config.py `cpu_budget`) — kept in
 * step with the quota here, or raising `TRAINING_NANO_CPUS` would change what
 * the container is allowed and not what it uses.
 */
export function trainerCpuBudget(nanoCpus: number): number {
  return Math.max(1, Math.floor(nanoCpus / 1e9));
}
