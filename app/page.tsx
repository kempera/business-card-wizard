"use client";

import { useEffect, useMemo, useState } from "react";
import type { ContactDraft, ContactRecord, FeatureStatus, SaveContactResult, SalesforcePushResult } from "./lib/types";

type Tab = "upload" | "dashboard" | "salesforce" | "exports";

const emptyFeatures: FeatureStatus = {
  database: false,
  googleVision: false,
  llmExtraction: false,
  ocr: false,
  salesforce: false,
  linkedinEnrichment: false,
  auth: false
};

function confidenceClass(value: number): string {
  if (value >= 80) return "confHigh";
  if (value >= 60) return "confMid";
  return "confLow";
}

function tagsToText(tags: string[]): string {
  return tags.join(", ");
}

function textToTags(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

/** Pull the most useful fields from a NinjaPear enrichment payload for inline display */
function parseEnrichment(enriched_json: Record<string, unknown> | null): {
  headline?: string;
  location?: string;
  currentRole?: string;
  currentCompany?: string;
  education?: string;
  photo?: string;
  summary?: string;
  provider?: string;
  fetchedAt?: string;
  enrichmentStatus?: string;
} | null {
  if (!enriched_json) return null;
  const profile = (enriched_json.profile ?? enriched_json) as Record<string, unknown>;
  if (!profile || typeof profile !== "object") return null;

  const exp = Array.isArray(profile.experiences) ? profile.experiences as Record<string, unknown>[] : [];
  const current = exp.find((e) => !e.ends_at) || exp[0];
  const edu = Array.isArray(profile.education) ? profile.education as Record<string, unknown>[] : [];
  const latestEdu = edu[0];

  return {
    headline: typeof profile.headline === "string" ? profile.headline : undefined,
    location: typeof profile.city === "string"
      ? [profile.city, profile.country].filter(Boolean).join(", ")
      : typeof profile.location === "string" ? profile.location : undefined,
    currentRole: current ? String(current.title || "") : undefined,
    currentCompany: current ? String(current.company || current.company_name || "") : undefined,
    education: latestEdu
      ? [latestEdu.school, latestEdu.degree_name].filter(Boolean).join(" · ")
      : undefined,
    photo: typeof profile.profile_pic_url === "string" ? profile.profile_pic_url : undefined,
    summary: typeof profile.summary === "string" ? profile.summary.slice(0, 220) : undefined,
    provider: typeof enriched_json.provider === "string" ? enriched_json.provider : undefined,
    fetchedAt: typeof enriched_json.fetched_at === "string" ? enriched_json.fetched_at.slice(0, 10) : undefined,
    enrichmentStatus: typeof enriched_json.enrichment_status === "string" ? enriched_json.enrichment_status : undefined,
  };
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("upload");
  const [eventName, setEventName] = useState("GB AI Innovation Day");
  const [files, setFiles] = useState<File[]>([]);
  const [drafts, setDrafts] = useState<ContactDraft[]>([]);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [features, setFeatures] = useState<FeatureStatus>(emptyFeatures);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [expandedEnrichId, setExpandedEnrichId] = useState<string | null>(null);

  async function loadContacts() {
    const response = await fetch("/api/contacts", { cache: "no-store" });
    const data = await response.json();
    setContacts(data.contacts || []);
    setFeatures(data.features || emptyFeatures);
    if (!response.ok && data.error) setError(data.error);
  }

  useEffect(() => {
    void loadContacts();
  }, []);

  const filteredContacts = useMemo(() => {
    return contacts.filter((contact) => {
      const statusOk = statusFilter === "all" || contact.status === statusFilter;
      const tagOk = !tagFilter || contact.tags.some((tag) => tag.toLowerCase().includes(tagFilter.toLowerCase()));
      return statusOk && tagOk;
    });
  }, [contacts, statusFilter, tagFilter]);

  const metrics = useMemo(() => {
    const avg = contacts.length
      ? Math.round(contacts.reduce((sum, contact) => sum + contact.confidence, 0) / contacts.length)
      : 0;
    const enrichedCount = contacts.filter((c) => c.enriched_json && (c.enriched_json as Record<string, unknown>).provider).length;
    return {
      contacts: contacts.length,
      events: new Set(contacts.map((contact) => contact.event_name)).size,
      avg,
      enriched: enrichedCount,
      salesforceReady: contacts.filter((contact) => contact.email && contact.company && (contact.last_name || contact.name)).length
    };
  }, [contacts]);

  async function processCards() {
    setError("");
    setMessage("");
    if (!files.length) {
      setError("Upload or capture at least one card image first.");
      return;
    }
    setProcessing(true);
    setProgress(0);
    const nextDrafts: ContactDraft[] = [];

    for (let index = 0; index < files.length; index += 1) {
      const formData = new FormData();
      formData.append("eventName", eventName);
      formData.append("files", files[index]);
      const response = await fetch("/api/cards/process", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || `Failed to process ${files[index].name}`);
        break;
      }
      nextDrafts.push(...(data.drafts || []));
      setDrafts((current) => [...current, ...(data.drafts || [])]);
      setProgress(Math.round(((index + 1) / files.length) * 100));
    }

    setProcessing(false);
    if (nextDrafts.length) setMessage(`Processed ${nextDrafts.length} card(s). Review and save them below.`);
  }

  async function saveDraft(index: number, draft: ContactDraft) {
    setError("");
    const response = await fetch("/api/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...draft, status: draft.status === "New" ? "Reviewed" : draft.status })
    });
    const data = (await response.json()) as SaveContactResult & { error?: string };
    if (!response.ok) {
      setError(data.error || "Could not save contact.");
      return;
    }
    setMessage(data.action === "deduped" ? "Duplicate detected — existing contact was updated." : `Contact ${data.action}.`);
    setDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index));
    await loadContacts();
    setTab("dashboard");
  }

  async function deleteContact(id: string) {
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    setSelectedIds((current) => current.filter((selected) => selected !== id));
    if (expandedEnrichId === id) setExpandedEnrichId(null);
    await loadContacts();
  }

  async function enrichContact(id: string) {
    setError("");
    setMessage("");
    setEnrichingId(id);
    try {
      const response = await fetch("/api/linkedin/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id })
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "LinkedIn enrichment failed.");
      } else {
        const p = parseEnrichment(data.enrichment as Record<string, unknown> | null);
        if (p?.headline || p?.currentRole) {
          setMessage(`✅ Enriched: ${p.currentRole || ""} ${p.currentRole && p.currentCompany ? "at" : ""} ${p.currentCompany || ""} ${p.location ? "· " + p.location : ""}`.trim());
        } else if (data.enrichment?.message) {
          setMessage(data.enrichment.message as string);
        } else {
          setMessage("Enrichment stored.");
        }
        setExpandedEnrichId(id);
        await loadContacts();
      }
    } finally {
      setEnrichingId(null);
    }
  }

  async function pushSalesforce() {
    setError("");
    const ids = selectedIds.length ? selectedIds : filteredContacts.map((contact) => contact.id);
    const response = await fetch("/api/salesforce/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids })
    });
    const data = (await response.json()) as { results?: SalesforcePushResult[]; error?: string };
    if (!response.ok) {
      setError(data.error || "Salesforce push failed.");
      return;
    }
    const ok = data.results?.filter((result) => result.ok).length || 0;
    const failed = data.results?.filter((result) => !result.ok).length || 0;
    setMessage(`Salesforce push complete: ${ok} succeeded, ${failed} failed.`);
    await loadContacts();
  }

  function updateDraft(index: number, patch: Partial<ContactDraft>) {
    setDrafts((current) => current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)));
  }

  return (
    <main className="container">
      <section className="hero">
        <div>
          <div className="eyebrow">OCR → AI review → CRM</div>
          <h1>📇 Business Card Wizard</h1>
          <p className="subtitle">
            Capture trade-show cards, extract contacts with OCR + LLMs, review before save,
            dedupe, enrich via NinjaPear, export Excel/vCards/QR codes, and push to Salesforce.
          </p>
        </div>
        <div className="card statusGrid" aria-label="Feature status">
          {Object.entries(features).map(([key, value]) => (
            <span className={`statusPill ${value ? "on" : ""}`} key={key}>
              {value ? "●" : "○"} {key}
            </span>
          ))}
        </div>
      </section>

      {!features.auth ? <div className="notice warn">Production warning: set APP_AUTH_PASSWORD to protect this wizard.</div> : null}
      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}

      <nav className="tabs" aria-label="Wizard sections">
        {[
          ["upload", "Upload + Review"],
          ["dashboard", "Dashboard"],
          ["salesforce", "Salesforce"],
          ["exports", "Exports"]
        ].map(([id, label]) => (
          <button className={`tab ${tab === id ? "active" : ""}`} key={id} onClick={() => setTab(id as Tab)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "upload" ? (
        <section className="grid">
          <div className="card col6">
            <h2>1. Capture cards</h2>
            <div className="field">
              <label htmlFor="eventName">Event name</label>
              <input id="eventName" className="input" value={eventName} onChange={(event) => setEventName(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="files">Upload or use phone camera</label>
              <input
                id="files"
                className="input"
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={(event) => setFiles(Array.from(event.target.files || []))}
              />
            </div>
            <div className="actions">
              <button className="btn" disabled={processing} onClick={processCards}>🚀 Process cards</button>
              <button className="btn secondary" disabled={processing} onClick={() => { setDrafts([]); setFiles([]); }}>Clear queue</button>
            </div>
            <p className="subtitle">Selected: {files.map((file) => file.name).join(", ") || "none"}</p>
            <div className="progress" aria-label="Processing progress"><span style={{ width: `${progress}%` }} /></div>
          </div>

          <div className="card col6">
            <h2>2. Review before saving</h2>
            <p className="subtitle">Every OCR/LLM result stays editable until you approve it.</p>
            {drafts.length === 0 ? <div className="notice">No draft contacts yet.</div> : null}
            {drafts.map((draft, index) => (
              <article className="reviewCard" key={`${draft.file_name}-${index}`}>
                <div className="actions" style={{ justifyContent: "space-between" }}>
                  <strong>{draft.file_name || `Draft ${index + 1}`}</strong>
                  <span className={confidenceClass(draft.confidence)}>{draft.confidence}% confidence</span>
                </div>
                {draft.warnings.length ? <div className="notice warn">{draft.warnings.join(" ")}</div> : null}
                <div className="grid">
                  <div className="field col6"><label>Name</label><input className="input" value={draft.name} onChange={(event) => updateDraft(index, { name: event.target.value })} /></div>
                  <div className="field col6"><label>Company</label><input className="input" value={draft.company} onChange={(event) => updateDraft(index, { company: event.target.value })} /></div>
                  <div className="field col6"><label>Title</label><input className="input" value={draft.title} onChange={(event) => updateDraft(index, { title: event.target.value })} /></div>
                  <div className="field col6"><label>Email</label><input className="input" value={draft.email} onChange={(event) => updateDraft(index, { email: event.target.value })} /></div>
                  <div className="field col6"><label>Phone</label><input className="input" value={draft.phone} onChange={(event) => updateDraft(index, { phone: event.target.value })} /></div>
                  <div className="field col6"><label>Mobile</label><input className="input" value={draft.mobile} onChange={(event) => updateDraft(index, { mobile: event.target.value })} /></div>
                  <div className="field col6"><label>LinkedIn</label><input className="input" value={draft.linkedin_url} onChange={(event) => updateDraft(index, { linkedin_url: event.target.value })} /></div>
                  <div className="field col6"><label>Tags</label><input className="input" value={tagsToText(draft.tags)} onChange={(event) => updateDraft(index, { tags: textToTags(event.target.value) })} /></div>
                  <div className="field col6"><label>Status</label><select className="input" value={draft.status} onChange={(event) => updateDraft(index, { status: event.target.value as ContactDraft["status"] })}><option>New</option><option>Reviewed</option><option>Qualified</option><option>Follow-up</option><option>Rejected</option></select></div>
                  <div className="field col6"><label>Follow-up date</label><input className="input" type="date" value={draft.follow_up_date || ""} onChange={(event) => updateDraft(index, { follow_up_date: event.target.value || null })} /></div>
                  <div className="field col12"><label>Notes</label><textarea value={draft.notes} onChange={(event) => updateDraft(index, { notes: event.target.value })} /></div>
                </div>
                <details><summary>Raw OCR text</summary><pre className="rawText">{draft.raw_text}</pre></details>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button className="btn" onClick={() => saveDraft(index, draft)}>✅ Save reviewed contact</button>
                  <button className="btn danger" onClick={() => setDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index))}>Discard</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "dashboard" ? (
        <section className="grid">
          <div className="metric col3"><strong>{metrics.contacts}</strong><span>Contacts</span></div>
          <div className="metric col3"><strong>{metrics.events}</strong><span>Events</span></div>
          <div className="metric col3"><strong>{metrics.avg}%</strong><span>Avg confidence</span></div>
          <div className="metric col3"><strong>{metrics.enriched}</strong><span>Enriched</span></div>
          <div className="card col12">
            <div className="actions">
              <select className="input" style={{ maxWidth: 220 }} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option><option>New</option><option>Reviewed</option><option>Qualified</option><option>Follow-up</option><option>Pushed to Salesforce</option><option>Rejected</option>
              </select>
              <input className="input" style={{ maxWidth: 260 }} placeholder="Filter by tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} />
              <span className="statusPill on">{metrics.salesforceReady} Salesforce-ready</span>
            </div>
            <ContactTable
              contacts={filteredContacts}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              onDelete={deleteContact}
              onEnrich={enrichContact}
              enrichingId={enrichingId}
              expandedEnrichId={expandedEnrichId}
              onToggleEnrich={(id) => setExpandedEnrichId((current) => current === id ? null : id)}
            />
          </div>
        </section>
      ) : null}

      {tab === "salesforce" ? (
        <section className="card">
          <h2>Salesforce Lead push</h2>
          <p className="subtitle">Maps reviewed contacts to Salesforce Lead fields using OAuth refresh-token credentials.</p>
          {!features.salesforce ? <div className="notice warn">Set Salesforce OAuth env vars before pushing.</div> : null}
          <div className="actions">
            <button className="btn" onClick={pushSalesforce} disabled={!contacts.length}>☁️ Push selected / visible contacts</button>
            <span>{selectedIds.length ? `${selectedIds.length} selected` : `${filteredContacts.length} visible`}</span>
          </div>
          <ContactTable
            contacts={filteredContacts}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            onDelete={deleteContact}
            onEnrich={enrichContact}
            enrichingId={enrichingId}
            expandedEnrichId={expandedEnrichId}
            onToggleEnrich={(id) => setExpandedEnrichId((current) => current === id ? null : id)}
            compact
          />
        </section>
      ) : null}

      {tab === "exports" ? (
        <section className="card">
          <h2>Exports</h2>
          <div className="actions">
            <a className="btn" href="/api/exports/excel">⬇️ Excel (contacts + enrichment)</a>
            <a className="btn secondary" href="/api/exports/vcard">📇 All vCards</a>
            <a className="btn secondary" href="/api/exports/enrichment">🧠 Enrichment JSON</a>
          </div>
          <p className="subtitle">Per-contact vCard, QR, and enrichment JSON exports are available in the dashboard table.</p>
        </section>
      ) : null}
    </main>
  );
}

function EnrichmentPanel({ enriched_json }: { enriched_json: Record<string, unknown> | null }) {
  const p = parseEnrichment(enriched_json);
  if (!p) return <div className="enrichPanel empty">No enrichment data yet.</div>;

  return (
    <div className="enrichPanel">
      <div className="enrichHeader">
        {p.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="enrichPhoto" src={p.photo} alt="Profile" width={48} height={48} />
        ) : null}
        <div>
          {p.headline ? <div className="enrichHeadline">{p.headline}</div> : null}
          {p.location ? <div className="enrichMeta">📍 {p.location}</div> : null}
        </div>
        <div className="enrichMeta" style={{ marginLeft: "auto", textAlign: "right" }}>
          {p.provider ? <span className="badge">{p.provider}</span> : null}
          {p.fetchedAt ? <span className="badge">{p.fetchedAt}</span> : null}
          {p.enrichmentStatus === "pending" ? <span className="badge warn">⏳ pending</span> : null}
        </div>
      </div>
      {(p.currentRole || p.currentCompany) ? (
        <div className="enrichRow"><strong>Current:</strong> {[p.currentRole, p.currentCompany].filter(Boolean).join(" at ")}</div>
      ) : null}
      {p.education ? <div className="enrichRow"><strong>Education:</strong> {p.education}</div> : null}
      {p.summary ? <div className="enrichRow enrichSummary">{p.summary}{p.summary.length >= 220 ? "…" : ""}</div> : null}
      <details style={{ marginTop: 8 }}>
        <summary className="enrichToggle">Raw enrichment JSON</summary>
        <pre className="rawText" style={{ maxHeight: 220 }}>{JSON.stringify(enriched_json, null, 2)}</pre>
      </details>
    </div>
  );
}

function ContactTable({
  contacts,
  selectedIds,
  setSelectedIds,
  onDelete,
  onEnrich,
  enrichingId,
  expandedEnrichId,
  onToggleEnrich,
  compact = false
}: {
  contacts: ContactRecord[];
  selectedIds: string[];
  setSelectedIds: (value: string[] | ((current: string[]) => string[])) => void;
  onDelete: (id: string) => void;
  onEnrich: (id: string) => void;
  enrichingId: string | null;
  expandedEnrichId: string | null;
  onToggleEnrich: (id: string) => void;
  compact?: boolean;
}) {
  if (!contacts.length) return <div className="notice">No contacts yet.</div>;

  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((selected) => selected !== id) : [...current, id]);
  }

  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Select</th>
            <th>Name</th>
            <th>Company</th>
            <th>Email / Phone</th>
            <th>Status</th>
            <th>Tags</th>
            <th>Conf.</th>
            <th>Enriched</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((contact) => {
            const enrichData = parseEnrichment(contact.enriched_json);
            const isEnriching = enrichingId === contact.id;
            const isExpanded = expandedEnrichId === contact.id;
            return (
              <>
                <tr key={contact.id} className={isExpanded ? "rowExpanded" : ""}>
                  <td><input type="checkbox" checked={selectedIds.includes(contact.id)} onChange={() => toggle(contact.id)} /></td>
                  <td>
                    <strong>{contact.name || `${contact.first_name} ${contact.last_name}`}</strong>
                    <br />{contact.title}
                  </td>
                  <td>
                    {contact.company}
                    {contact.linkedin_url ? <><br /><a href={contact.linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a></> : null}
                  </td>
                  <td>{contact.email}<br />{contact.mobile || contact.phone}</td>
                  <td>
                    {contact.status}
                    {contact.salesforce_id ? <><br /><span className="badge">SF ✓</span></> : null}
                  </td>
                  <td>{contact.tags.map((tag) => <span className="badge" key={tag}>{tag}</span>)}</td>
                  <td className={confidenceClass(contact.confidence)}>{contact.confidence}%</td>
                  <td>
                    {enrichData ? (
                      <button
                        className="enrichBadge"
                        onClick={() => onToggleEnrich(contact.id)}
                        title={enrichData.headline || "View enrichment"}
                      >
                        🧠 {isExpanded ? "▲" : "▼"}
                      </button>
                    ) : (
                      <span className="enrichBadge empty">—</span>
                    )}
                  </td>
                  <td>
                    <div className="actions">
                      <a className="btn ghost" href={`/api/exports/vcard?ids=${contact.id}`}>vCard</a>
                      <a className="btn ghost" href={`/api/exports/qr/${contact.id}`} target="_blank" rel="noreferrer">QR</a>
                      {contact.enriched_json ? (
                        <a className="btn ghost" href={`/api/exports/enrichment?id=${contact.id}`} target="_blank" rel="noreferrer">JSON</a>
                      ) : null}
                      {!compact ? (
                        <button
                          className={`btn ghost ${isEnriching ? "enriching" : ""}`}
                          onClick={() => onEnrich(contact.id)}
                          disabled={isEnriching}
                          title="Enrich via NinjaPear (3 credits)"
                        >
                          {isEnriching ? "⏳…" : enrichData ? "Re-enrich" : "Enrich"}
                        </button>
                      ) : null}
                      {!compact ? <button className="btn danger" onClick={() => onDelete(contact.id)}>Delete</button> : null}
                    </div>
                  </td>
                </tr>
                {isExpanded ? (
                  <tr key={`${contact.id}-enrich`} className="enrichRow">
                    <td colSpan={9} style={{ padding: 0 }}>
                      <EnrichmentPanel enriched_json={contact.enriched_json} />
                    </td>
                  </tr>
                ) : null}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
