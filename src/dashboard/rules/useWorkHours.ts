import { useCallback, useRef } from "react";
import { errorMessage, type Holiday, type RulesScope, type WorkHours, type WorkHoursAtScope } from "../../lib/api";
import type { ToastTone } from "../components/Toast";
import { useResource, type Resource } from "../useResource";
import { createHoliday, dropWorkHours, loadHolidays, loadWorkHours, putWorkHours, removeHoliday } from "./rulesData";

export type Say = (text: string, tone?: ToastTone) => void;

export interface DeptHours {
  scope: RulesScope;
  at: WorkHoursAtScope;
}

export interface WorkHoursController {
  at: Resource<WorkHoursAtScope>;
  /** Company scope only: each department's hours (for By department). */
  depts: Resource<DeptHours[]>;
  holidays: Resource<Holiday[]>;
  /** Save fields at the picked scope (saved at once, like the board). */
  put: (patch: Partial<WorkHours>, saved?: string) => Promise<void>;
  /** Save fields for one department (By department rows). */
  putDept: (scope: RulesScope, patch: Partial<WorkHours>, saved: string) => Promise<void>;
  /** A department / PC goes back to the hours above it. */
  reset: (scope: RulesScope, saved: string) => Promise<void>;
  addHoliday: (name: string, date: string) => Promise<boolean>;
  removeHoliday: (h: Holiday) => Promise<void>;
}

/**
 * Work hours at the picked scope (GET/PUT/DELETE rules/hours/?scope=), the departments' own hours for the company
 * view, and the company holidays. Every change saves at once and says so in a toast; a failed save says why and
 * reloads what the server has.
 */
export function useWorkHours(
  scope: RulesScope,
  parent: RulesScope | null,
  deptScopes: readonly RulesScope[],
  say: Say,
  reach: string,
): WorkHoursController {
  const loadAt = useCallback((signal: AbortSignal) => loadWorkHours(scope, parent, signal), [scope, parent]);
  const at = useResource(loadAt, { resetKey: scope });

  const deptKey = scope === "company" ? deptScopes.join(",") : "";
  const loadDepts = useCallback(
    (signal: AbortSignal): Promise<DeptHours[]> =>
      deptKey
        ? Promise.all(
            deptKey.split(",").map((s) => loadWorkHours(s as RulesScope, "company", signal).then((h) => ({ scope: s as RulesScope, at: h }))),
          )
        : Promise.resolve([]),
    [deptKey],
  );
  const depts = useResource(loadDepts, { resetKey: deptKey });

  const loadHol = useCallback((signal: AbortSignal) => loadHolidays(signal), []);
  const holidays = useResource(loadHol);

  // Only the newest save's answer is applied, so quick changes never land out of order.
  const seq = useRef(0);
  const { setData: setAt, reload: reloadAt } = at;
  const { setData: setDepts, reload: reloadDepts } = depts;
  const atData = at.data;
  const deptData = depts.data;

  const put = useCallback(
    async (patch: Partial<WorkHours>, saved?: string) => {
      if (!atData) return;
      const n = ++seq.current;
      setAt({ ...atData, effective: { ...atData.effective, ...patch }, own: true, fields: { ...atData.fields, ...patch } });
      try {
        const next = await putWorkHours(scope, parent, patch);
        if (n !== seq.current) return;
        setAt(next);
        say(saved ?? reach);
        // Departments that keep some company hours show the new ones.
        if (scope === "company") reloadDepts();
      } catch (err) {
        say(errorMessage(err), "error");
        reloadAt();
      }
    },
    [atData, scope, parent, setAt, say, reach, reloadAt, reloadDepts],
  );

  const putDept = useCallback(
    async (dscope: RulesScope, patch: Partial<WorkHours>, saved: string) => {
      const list = deptData ?? [];
      setDepts(list.map((d) => (d.scope === dscope ? { scope: dscope, at: { ...d.at, own: true, effective: { ...d.at.effective, ...patch } } } : d)));
      try {
        await putWorkHours(dscope, "company", patch);
        say(saved);
      } catch (err) {
        say(errorMessage(err), "error");
      }
      reloadDepts();
    },
    [deptData, setDepts, say, reloadDepts],
  );

  const reset = useCallback(
    async (rscope: RulesScope, saved: string) => {
      try {
        await dropWorkHours(rscope);
        say(saved);
      } catch (err) {
        say(errorMessage(err), "error");
      }
      if (rscope === scope) reloadAt();
      else reloadDepts();
    },
    [scope, say, reloadAt, reloadDepts],
  );

  const { setData: setHol, reload: reloadHol } = holidays;
  const holData = holidays.data;
  const addHol = useCallback(
    async (name: string, date: string) => {
      try {
        const h = await createHoliday({ name, date });
        setHol([...(holData ?? []), h].sort((a, b) => a.date.localeCompare(b.date)));
        say(`Added ${name}. Reports skip that day.`);
        return true;
      } catch (err) {
        say(errorMessage(err), "error");
        reloadHol();
        return false;
      }
    },
    [holData, setHol, say, reloadHol],
  );
  const removeHol = useCallback(
    async (h: Holiday) => {
      setHol((holData ?? []).filter((x) => x.id !== h.id));
      try {
        await removeHoliday(h.id);
        say(`Removed ${h.name}.`);
      } catch (err) {
        say(errorMessage(err), "error");
        reloadHol();
      }
    },
    [holData, setHol, say, reloadHol],
  );

  return { at, depts, holidays, put, putDept, reset, addHoliday: addHol, removeHoliday: removeHol };
}
