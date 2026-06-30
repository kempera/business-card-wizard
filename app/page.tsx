"use client";

import React, { useEffect, useMemo, useState } from "react";
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

/** Parsed enrichment data from NinjaPear API (actual field names from live response) */
interface EnrichmentData {
  fullName?: string;
  headline?: string;
  location?: string;
  photo?: string;
  bio?: string;
  currentRole?: string;
  currentCompany?: string;
  currentCompanyWebsite?: string;
  currentSince?: string;
  currentDescription?: string;
  pastRoles: { role: string; company: string; period: string; description?: string }[];
  education: { school: string; major?: string; period?: string }[];
  website?: string;
  xHandle?: string;
  provider?: string;
  fetchedAt?: string;
  enrichmentStatus?: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Parse NinjaPear enrichment payload — handles actual field names from live API */
function parseEnrichment(enriched_json: Record<string, unknown> | null): EnrichmentData | null {
  if (!enriched_json) return null;
  const profile = (enriched_json.profile ?? enriched_json) as Record<string, unknown>;
  if (!profile || typeof profile !== "object") return null;

  // Location: city/state/country_name from NinjaPear
  const locationParts = [
    str(profile.city_name || profile.city),
    str(profile.state_name || profile.state),
    str(profile.country_name || profile.country)
  ].filter(Boolean);
  const location = locationParts.length ? locationParts.join(", ") : str(profile.location_display);

  // Work experience uses `work_experience` array, current = is_current true
  const workExp = Array.isArray(profile.work_experience)
    ? (profile.work_experience as Record<string, unknown>[])
    : [];
  const current = workExp.find((e) => e.is_current === true) || workExp[0];
  const past = workExp.filter((e) => e !== current);

  function formatPeriod(e: Record<string, unknown>): string {
    const start = str(e.start_date).slice(0, 7);
    const end = e.is_current ? "present" : str(e.end_date).slice(0, 7);
    if (!start && !end) return "";
    if (!start) return end;
    if (!end) return start;
    return `${start} – ${end}`;
  }

  // Education uses `education` array with `school`, `major`
  const eduRaw = Array.isArray(profile.education)
    ? (profile.education as Record<string, unknown>[])
    : [];

  return {
    fullName: str(profile.full_name),
    headline: str(profile.headline),
    location: location || undefined,
    photo: str(profile.profile_pic_url) || undefined,
    bio: str(profile.bio) || undefined,
    currentRole: current ? str(current.role) : undefined,
    currentCompany: current ? str(current.company_name) : undefined,
    currentCompanyWebsite: current ? str(current.company_website) : undefined,
    currentSince: current ? str(current.start_date).slice(0, 7) : undefined,
    currentDescription: current ? str(current.description) : undefined,
    pastRoles: past.map((e) => ({
      role: str(e.role),
      company: str(e.company_name),
      period: formatPeriod(e),
      description: str(e.description) || undefined
    })).filter((e) => e.role || e.company),
    education: eduRaw.map((e) => ({
      school: str(e.school),
      major: str(e.major) || undefined,
      period: (() => {
        const s = str(e.start_date).slice(0, 4);
        const en = str(e.end_date).slice(0, 4);
        return s || en ? [s, en].filter(Boolean).join(" – ") : undefined;
      })()
    })).filter((e) => e.school),
    website: str(profile.personal_website) || undefined,
    xHandle: str(profile.x_handle) || undefined,
    provider: str(enriched_json.provider) || undefined,
    fetchedAt: str(enriched_json.fetched_at).slice(0, 10) || undefined,
    enrichmentStatus: str(enriched_json.enrichment_status) || undefined,
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

            {/* ── Multi-source upload zone ── */}
            <UploadZone files={files} setFiles={setFiles} />

            <div className="actions" style={{ marginTop: 14 }}>
              <button className="btn" disabled={processing || !files.length} onClick={processCards}>
                🚀 Process {files.length > 0 ? `${files.length} card${files.length > 1 ? "s" : ""}` : "cards"}
              </button>
              <button className="btn secondary" disabled={processing} onClick={() => { setDrafts([]); setFiles([]); }}>Clear all</button>
            </div>
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

      <footer className="ipFooter" aria-label="Intellectual property notice">
        <strong>© 2026 Dr. Andreas Kemper.</strong> All rights reserved. Business Card Wizard and its CRM/OCR/enrichment workflows are intellectual property of Dr. Andreas Kemper.
      </footer>
    </main>
  );
}

function EnrichmentPanel({ enriched_json }: { enriched_json: Record<string, unknown> | null }) {
  const p = parseEnrichment(enriched_json);
  if (!p) return <div className="enrichPanel empty">No enrichment data yet.</div>;

  return (
    <div className="enrichPanel">

      {/* ── Header row: photo + name + meta badges ── */}
      <div className="enrichHeader">
        {p.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="enrichPhoto" src={p.photo} alt="Profile" width={52} height={52} />
        ) : (
          <div className="enrichPhotoPlaceholder">👤</div>
        )}
        <div className="enrichHeaderText">
          {p.fullName ? <div className="enrichName">{p.fullName}</div> : null}
          {p.headline ? <div className="enrichHeadline">{p.headline}</div> : null}
          {p.location ? <div className="enrichMeta">📍 {p.location}</div> : null}
        </div>
        <div className="enrichBadgeGroup">
          {p.provider ? <span className="badge enrichProviderBadge">{p.provider}</span> : null}
          {p.fetchedAt ? <span className="badge">{p.fetchedAt}</span> : null}
          {p.enrichmentStatus === "pending" ? <span className="badge badgeWarn">⏳ pending</span> : null}
        </div>
      </div>

      {/* ── Key facts overview table ── */}
      <table className="enrichTable">
        <tbody>

          {/* Current position */}
          {(p.currentRole || p.currentCompany) ? (
            <tr>
              <th>💼 Current role</th>
              <td>
                <strong>{p.currentRole || "—"}</strong>
                {p.currentCompany ? (
                  <span>
                    {" "}at {p.currentCompanyWebsite
                      ? <a href={`https://${p.currentCompanyWebsite}`} target="_blank" rel="noreferrer">{p.currentCompany} ↗</a>
                      : p.currentCompany}
                  </span>
                ) : null}
                {p.currentSince ? <span className="enrichMeta"> · since {p.currentSince}</span> : null}
                {p.currentDescription ? <div className="enrichDesc">{p.currentDescription}</div> : null}
              </td>
            </tr>
          ) : null}

          {/* Location */}
          {p.location ? (
            <tr>
              <th>📍 Location</th>
              <td>{p.location}</td>
            </tr>
          ) : null}

          {/* Career history */}
          {p.pastRoles.length > 0 ? (
            <tr>
              <th>📋 Career</th>
              <td>
                <div className="enrichCareerList">
                  {p.pastRoles.map((role, i) => (
                    <div key={i} className="enrichCareerItem">
                      <span className="enrichCareerRole">{role.role}</span>
                      {role.company ? <span className="enrichCareerCompany"> · {role.company}</span> : null}
                      {role.period ? <span className="enrichCareerPeriod"> ({role.period})</span> : null}
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          ) : null}

          {/* Education */}
          {p.education.length > 0 ? (
            <tr>
              <th>🎓 Education</th>
              <td>
                <div className="enrichCareerList">
                  {p.education.map((edu, i) => (
                    <div key={i} className="enrichCareerItem">
                      <span className="enrichCareerRole">{edu.school}</span>
                      {edu.major ? <span className="enrichCareerCompany"> · {edu.major}</span> : null}
                      {edu.period ? <span className="enrichCareerPeriod"> ({edu.period})</span> : null}
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          ) : null}

          {/* Bio */}
          {p.bio ? (
            <tr>
              <th>📝 Bio</th>
              <td className="enrichBioCell">{p.bio}</td>
            </tr>
          ) : null}

          {/* Online */}
          {(p.website || p.xHandle) ? (
            <tr>
              <th>🔗 Online</th>
              <td>
                {p.website ? <a href={p.website} target="_blank" rel="noreferrer">{p.website}</a> : null}
                {p.xHandle ? <span style={{ marginLeft: 12 }}>𝕏 @{p.xHandle}</span> : null}
              </td>
            </tr>
          ) : null}

        </tbody>
      </table>

      {/* ── Raw JSON collapsible ── */}
      <details className="enrichRawWrap">
        <summary className="enrichToggle">Raw enrichment JSON</summary>
        <pre className="rawText" style={{ maxHeight: 240 }}>{JSON.stringify(enriched_json, null, 2)}</pre>
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

/** UploadZone — drag-and-drop + gallery picker + live camera capture.
 *  Files are ACCUMULATED across selections; each pick adds to the stack.
 *  Thumbnails shown with individual ✕ remove buttons.
 */
function UploadZone({
  files,
  setFiles
}: {
  files: File[];
  setFiles: (files: File[] | ((prev: File[]) => File[])) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const galleryRef = React.useRef<HTMLInputElement>(null);
  const cameraRef = React.useRef<HTMLInputElement>(null);

  function addFiles(incoming: FileList | null) {
    if (!incoming || !incoming.length) return;
    const newFiles = Array.from(incoming).filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => {
      // Deduplicate by name+size
      const existing = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...newFiles.filter((f) => !existing.has(`${f.name}:${f.size}`))];
    });
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  return (
    <div className="uploadZoneWrap">
      {/* Drop target */}
      <div
        className={`uploadDropZone ${dragging ? "dragging" : ""} ${files.length ? "hasFiles" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => galleryRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Drop images here or click to browse"
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") galleryRef.current?.click(); }}
      >
        {files.length === 0 ? (
          <>
            <div className="uploadDropIcon">📂</div>
            <div className="uploadDropText">Drop images here or click to browse</div>
            <div className="uploadDropSub">JPEG · PNG · WEBP · HEIC</div>
          </>
        ) : (
          <div className="uploadDropText" style={{ fontSize: 13 }}>
            Drop more images here or click to add from gallery
          </div>
        )}
      </div>

      {/* Hidden inputs */}
      {/* Gallery / existing photos picker — multiple, no capture constraint */}
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => addFiles(e.target.files)}
        onClick={(e) => { (e.target as HTMLInputElement).value = ""; }}
      />
      {/* Camera capture — takes one photo at a time, adds to stack */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => addFiles(e.target.files)}
        onClick={(e) => { (e.target as HTMLInputElement).value = ""; }}
      />

      {/* Source buttons */}
      <div className="uploadSources">
        <button
          type="button"
          className="btn ghost uploadSourceBtn"
          onClick={(e) => { e.stopPropagation(); galleryRef.current?.click(); }}
        >
          🖼️ Add from gallery
        </button>
        <button
          type="button"
          className="btn ghost uploadSourceBtn"
          onClick={(e) => { e.stopPropagation(); cameraRef.current?.click(); }}
        >
          📷 Take photo
        </button>
      </div>

      {/* Thumbnail queue */}
      {files.length > 0 ? (
        <div className="uploadThumbGrid">
          {files.map((file, index) => (
            <div key={`${file.name}:${file.size}:${index}`} className="uploadThumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={URL.createObjectURL(file)} alt={file.name} />
              <div className="uploadThumbName" title={file.name}>{file.name}</div>
              <button
                type="button"
                className="uploadThumbRemove"
                aria-label={`Remove ${file.name}`}
                onClick={(e) => { e.stopPropagation(); removeFile(index); }}
              >✕</button>
            </div>
          ))}
          {/* Add-more tile */}
          <div
            className="uploadThumb uploadThumbAdd"
            onClick={() => galleryRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="Add more images"
            onKeyDown={(e) => { if (e.key === "Enter") galleryRef.current?.click(); }}
          >
            <span>＋</span>
            <div className="uploadThumbName">Add more</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
