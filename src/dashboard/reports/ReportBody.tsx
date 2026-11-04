import type { ReactElement } from "react";
import type { MetricTopItem, TeamReport } from "../../lib/api";
import { formatBytes } from "../features/metrics";
import { clockOf } from "../features/reportFormat";
import { appSource, mergeBySource, siteSource } from "../features/usageSources";
import { TipBody } from "../ui/Tooltip";
import type { Tip } from "../ui/useTip";
import { fmt } from "./dates";
import { rowKey, type ColorOf } from "./model";
import { WhoWorkedWhen } from "./WhoWorkedWhen";

function InfoIcon({ size = 12 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

interface TileDef {
  value: string;
  label: string;
  sub?: string;
  def?: string;
}

function tilesFor(r: TeamReport): TileDef[] {
  const t = r.totals;
  return [
    { value: String(t.people_worked), label: t.people_worked === 1 ? "person worked" : "people worked" },
    {
      value: fmt(t.worked_seconds),
      label: "worked in total",
      sub: t.person_days ? `${fmt(t.worked_seconds / t.person_days)} a person-day` : undefined,
      def: "Worked: time from Start day to End day, not counting breaks.",
    },
    {
      value: fmt(t.active_seconds),
      label: "active on the PC",
      sub: "Keyboard or mouse in use, not what was done",
      def: "Active on PC: time the PC was in use (keyboard or mouse), not what was done.",
    },
    { value: fmt(t.break_seconds), label: "on breaks" },
    { value: t.data_bytes ? formatBytes(t.data_bytes) : "0 MB", label: "internet data" },
    { value: String(t.alerts_all), label: t.alerts_all === 1 ? "alert" : "alerts" },
  ];
}

function TopCard({ title, rows }: { title: string; rows: Array<{ key: string; v: string }> }): ReactElement {
  return (
    <section className="z-card" style={{ padding: "16px 18px" }} aria-label={title}>
      <h2 style={{ margin: "0 0 8px", fontSize: 15 }}>{title}</h2>
      {rows.length === 0 ? (
        <p className="rp-k" style={{ margin: 0, fontSize: 13 }}>
          Nothing recorded in this period.
        </p>
      ) : (
        rows.map((it) => (
          <div key={it.key} className="rp-li">
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.key}</span>
            <b className="rp-num" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
              {it.v}
            </b>
          </div>
        ))
      )}
    </section>
  );
}

function tops(r: TeamReport): Array<{ title: string; rows: Array<{ key: string; v: string }> }> {
  const timed = (items: MetricTopItem[], nameOf: (key: string) => string) =>
    mergeBySource(items, nameOf, 8)
      .sort((a, b) => b.seconds - a.seconds)
      .map((x) => ({ key: x.key, v: fmt(x.seconds) }));
  return [
    { title: "Top apps", rows: timed(r.top_apps, appSource) },
    { title: "Top websites", rows: timed(r.top_sites, siteSource) },
    { title: "Most internet data", rows: r.top_data.slice(0, 8).map((x) => ({ key: x.key, v: formatBytes(x.bytes ?? 0) })) },
  ];
}

/**
 * The Report tab (board DashReports, `v.report`): six totals, "Who worked when", By person, and the top apps,
 * websites and internet data. All from GET reports/ for the period (and person) picked above.
 */
export function ReportBody({
  report,
  colorOf,
  pin,
  onPin,
  onPerson,
  onShowAll,
  onDay,
  tip,
}: {
  report: TeamReport;
  colorOf: ColorOf;
  /** Highlighted person (chart pin / #m=…). */
  pin: string | null;
  onPin: (key: string | null) => void;
  onPerson: (memberId: number) => void;
  onShowAll: () => void;
  onDay: (date: string) => void;
  tip: Tip;
}): ReactElement {
  const one = Boolean(report.member);
  const rows = [...report.people].sort((a, b) => b.worked_seconds - a.worked_seconds);
  const defBtn = (key: string, label: string, text: string) => (
    <button type="button" className="rp-def" {...tip.anchor(key, <TipBody text={text} />)}>
      {label}
      <InfoIcon size={13} />
    </button>
  );

  return (
    <>
      <div style={{ containerType: "inline-size" }}>
        <section aria-label="Totals" className="rp-tiles">
          {tilesFor(report).map((t) => (
            <div key={t.label} className="rp-tile">
              <b className="rp-num rp-tv">{t.value}</b>
              {t.def ? (
                <span>
                  <button
                    type="button"
                    className="rp-def rp-tl"
                    style={{ fontSize: 13, fontWeight: 500, color: "#404040" }}
                    {...tip.anchor(`tile-${t.label}`, <TipBody text={t.def} />)}
                  >
                    {t.label}
                    <InfoIcon />
                  </button>
                </span>
              ) : (
                <span className="rp-tl">{t.label}</span>
              )}
              {t.sub ? <span className="rp-ts rp-num">{t.sub}</span> : null}
            </div>
          ))}
        </section>
      </div>

      <WhoWorkedWhen report={report} colorOf={colorOf} pin={pin} onPin={onPin} onDay={one ? onDay : undefined} tip={tip} />

      <section className="z-card" aria-labelledby="who-h" style={{ overflow: "hidden" }}>
        <div style={{ padding: "16px 16px 6px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
          <div>
            <h2 id="who-h" style={{ margin: 0, fontSize: 17 }}>
              By person
            </h2>
            <span className="rp-k" style={{ fontSize: 13 }}>
              Click a name to see that person's report.
            </span>
          </div>
          {one ? (
            <button type="button" className="z-btn sm" onClick={onShowAll}>
              Show everyone
            </button>
          ) : null}
        </div>
        {rows.length === 0 ? (
          <p className="rp-k" style={{ margin: 0, padding: "6px 16px 16px", fontSize: 13 }}>
            No one logged in from their Zinwe window in this period, and there were no alerts. Try a longer period.
          </p>
        ) : (
          <>
            <ul className="rp-cards rp-ph-only" aria-label="By person">
              {rows.map((p) => {
                const z = p.days_worked === 0;
                return (
                  <li key={rowKey(p)} className={`rp-pcard${pin === rowKey(p) ? " hl" : ""}`}>
                    {p.member_id ? (
                      <button type="button" className="rp-lnk" style={{ fontSize: 15, alignSelf: "flex-start" }} onClick={() => onPerson(p.member_id!)}>
                        {p.name}
                      </button>
                    ) : (
                      <b style={{ fontSize: 15 }}>{p.name}</b>
                    )}
                    <dl>
                      <div>
                        <dt>Worked</dt>
                        <dd>{z ? "—" : fmt(p.worked_seconds)}</dd>
                      </div>
                      <div>
                        <dt>Days</dt>
                        <dd>{p.days_worked}</dd>
                      </div>
                      <div>
                        <dt>A day</dt>
                        <dd>{z ? "—" : fmt(p.worked_seconds / p.days_worked)}</dd>
                      </div>
                      <div>
                        <dt>On breaks</dt>
                        <dd>
                          {z ? "—" : fmt(p.break_seconds)}{" "}
                          <span className="rp-k">{z ? "" : `${p.breaks} ${p.breaks === 1 ? "break" : "breaks"}`}</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Usual start</dt>
                        <dd>{clockOf(p.first_in)}</dd>
                      </div>
                      <div>
                        <dt>Usual finish</dt>
                        <dd>{clockOf(p.last_out)}</dd>
                      </div>
                      <div>
                        <dt>Active on PC</dt>
                        <dd>{p.active_seconds ? fmt(p.active_seconds) : "—"}</dd>
                      </div>
                      <div>
                        <dt>Internet data</dt>
                        <dd>{p.data_bytes ? formatBytes(p.data_bytes) : "—"}</dd>
                      </div>
                      <div>
                        <dt>Alerts</dt>
                        <dd>{p.alerts}</dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>
            <p className="rp-k rp-ph-only" style={{ margin: 0, padding: "0 16px 14px" }}>
              Active on PC: time the PC was in use (keyboard or mouse), not what was done.
            </p>
            <div className="rp-ph-hide" style={{ overflowX: "auto" }}>
              <table className="rp-tbl">
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Days</th>
                    <th scope="col">{defBtn("def-worked", "Worked", "Time from Start day to End day, not counting breaks.")}</th>
                    <th scope="col">A day</th>
                    <th scope="col">On breaks</th>
                    <th scope="col">Usual start</th>
                    <th scope="col">Usual finish</th>
                    <th scope="col">{defBtn("def-active", "Active on PC", "Time the PC was in use (keyboard or mouse), not what was done.")}</th>
                    <th scope="col">Internet data</th>
                    <th scope="col">Alerts</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const z = p.days_worked === 0;
                    return (
                      <tr key={rowKey(p)} className={pin === rowKey(p) ? "hl" : undefined}>
                        <td>
                          {p.member_id ? (
                            <button type="button" className="rp-lnk" onClick={() => onPerson(p.member_id!)}>
                              {p.name}
                            </button>
                          ) : (
                            <span title="This PC isn't linked to a team member">{p.name}</span>
                          )}
                        </td>
                        <td className="rp-num">{p.days_worked}</td>
                        <td className="rp-num">
                          <b>{z ? "—" : fmt(p.worked_seconds)}</b>
                        </td>
                        <td className="rp-num">{z ? "—" : fmt(p.worked_seconds / p.days_worked)}</td>
                        <td className="rp-num">
                          {z ? "—" : fmt(p.break_seconds)}{" "}
                          <span className="rp-k">{z ? "" : `${p.breaks} ${p.breaks === 1 ? "break" : "breaks"}`}</span>
                        </td>
                        <td className="rp-num">{clockOf(p.first_in)}</td>
                        <td className="rp-num">{clockOf(p.last_out)}</td>
                        <td className="rp-num">{p.active_seconds ? fmt(p.active_seconds) : "—"}</td>
                        <td className="rp-num">{p.data_bytes ? formatBytes(p.data_bytes) : "—"}</td>
                        <td className="rp-num">{p.alerts}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {report.no_activity.length > 0 ? (
          <p className="rp-k" style={{ margin: 0, padding: "10px 16px 14px", borderTop: "1px solid #F5F5F5", fontSize: 13 }}>
            <b style={{ color: "#404040" }}>No activity:</b> {report.no_activity.join(", ")}
          </p>
        ) : null}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        {tops(report).map((t) => (
          <TopCard key={t.title} title={t.title} rows={t.rows} />
        ))}
      </div>
      <p style={{ margin: "-6px 0 0", fontSize: 12, color: "#6B6B6B" }}>Local network copies and Windows itself are left out.</p>
    </>
  );
}
