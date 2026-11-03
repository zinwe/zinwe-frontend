import { useState, type ReactElement } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import { usePageMeta } from "../../hooks/usePageMeta";
import { FeedbackForm } from "../components/FeedbackForm";
import { IssueForm } from "../components/IssueForm";
import { GetStarted } from "../help/GetStarted";
import { PoliciesCard } from "../help/PoliciesCard";
import { SupportTab } from "../help/SupportTab";
import { WhatsNewList } from "../help/WhatsNewList";
import { SectionNav, type Section } from "../settings/SectionNav";
import { PageHead } from "../shell/PageHead";
import "../../styles/dash13/help.css";

/** Tabs and the hash names other pages link with: /app/help#tab=get-started|support|issue|policies|whats-new|feedback. */
const TABS = [
  { key: "get-started", label: "Get started", desc: "" },
  { key: "support", label: "Support", desc: "Message a person, and common questions" },
  { key: "issue", label: "Report an issue", desc: "Something not working? Send it with a screenshot" },
  { key: "policies", label: "Policies", desc: "The documents you agreed to" },
  { key: "whats-new", label: "What’s new", desc: "Zinwe 1.3 and earlier updates" },
  { key: "feedback", label: "Feedback", desc: "Rate Zinwe and tell us what to improve" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** Board names too (DashHelp state keys). */
const ALIAS: Record<string, Tab> = { start: "get-started", news: "whats-new", "how-to-use": "get-started", bug: "issue", report: "issue" };

function tabFromHash(hash: string): Tab | null {
  const raw = new URLSearchParams(hash.slice(1)).get("tab")?.toLowerCase() ?? "";
  if ((TABS as readonly { key: string }[]).some((t) => t.key === raw)) return raw as Tab;
  return ALIAS[raw] ?? null;
}

/**
 * Help & support (board DashHelp, /app/help): Get started (setup checklist, the tour, the website), Support (message
 * the team, the floating Support panel, common questions), Policies, What's new and Feedback. The account menu's
 * Settings / Help & support / Log out replaced the old sidebar menu; this page holds its help items.
 * `#tab=<name>` picks a tab; on a phone the tabs are a row list and a row opens its section with a back arrow.
 */
export default function HowToUsePage(): ReactElement {
  usePageMeta({ title: "Help & support — Zinwe", description: "Setup steps, a real person when you need one, and the documents you agreed to." });
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { account } = useAuth();
  const user = account?.user;
  const fromHash = tabFromHash(hash);
  const tab: Tab = fromHash ?? "get-started";
  // Phone only: false = the row list, true = one section open. A #tab= link opens that section.
  const [open, setOpen] = useState(fromHash !== null);
  const [seenHash, setSeenHash] = useState(hash);
  if (hash !== seenHash) {
    setSeenHash(hash);
    setOpen(fromHash !== null);
  }

  const sections: Section[] = TABS.map((t) => ({ key: t.key, label: t.label, desc: t.key === "get-started" ? "Get fully set up, the tour and the website" : t.desc }));

  return (
    <div className={`zp-help${open ? " zn-open" : ""}`}>
      <PageHead title="Help & support" lede="Setup steps, a real person when you need one, and the documents you agreed to." />
      <div className="zp-col">
        <SectionNav
          label="Help"
          backLabel="Back to Help & support"
          sections={sections}
          current={tab}
          idPrefix="hp-tab-"
          panelId="hp-panel"
          onPick={(key) => {
            setOpen(true);
            navigate({ hash: `tab=${key}` }, { replace: true });
          }}
          onBack={() => {
            setOpen(false);
            navigate({ hash: "" }, { replace: true });
          }}
        />
        <div id="hp-panel" className="zp-panel" role="tabpanel" aria-labelledby={`hp-tab-${tab}`}>
          {tab === "get-started" ? <GetStarted userId={user?.id} /> : null}
          {tab === "support" ? <SupportTab email={user?.email ?? ""} /> : null}
          {tab === "issue" ? (
            <section className="z-card zp-card mid" aria-label="Report an issue">
              <IssueForm page="/app/help#tab=issue" showHistory heading />
            </section>
          ) : null}
          {tab === "policies" ? <PoliciesCard /> : null}
          {tab === "whats-new" ? <WhatsNewList /> : null}
          {tab === "feedback" ? (
            <section className="z-card zp-card mid" aria-label="Feedback">
              <FeedbackForm page="/app/help#tab=feedback" heading />
              <Link to="/app/feedback" style={{ fontWeight: 600, fontSize: 13, alignSelf: "flex-start" }}>
                Your past feedback
              </Link>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
