import streamlit as st
import pandas as pd
import sqlite3
import re
import uuid
import requests
from PIL import Image
from io import BytesIO

# ---------------- CONFIG ----------------
st.set_page_config(page_title="Business Card Wizard", layout="wide")

DB = "contacts.db"

# ---------------- DATABASE ----------------
conn = sqlite3.connect(DB, check_same_thread=False)
cursor = conn.cursor()

cursor.execute("""
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    event_name TEXT,
    source TEXT,
    name TEXT,
    company TEXT,
    title TEXT,
    email TEXT,
    phone TEXT,
    status TEXT,
    confidence INTEGER,
    raw_text TEXT
)
""")
conn.commit()

# ---------------- OCR FUNCTION ----------------
def ocr_space_image(image_bytes):
    api_key = st.secrets.get("OCR_SPACE_API_KEY", "helloworld")

    image = Image.open(BytesIO(image_bytes)).convert("RGB")

    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=95)
    buffer.seek(0)

    response = requests.post(
        "https://api.ocr.space/parse/image",
        files={"file": ("card.jpg", buffer.getvalue())},
        data={
            "apikey": api_key,
            "language": "eng",
            "isOverlayRequired": False,
            "OCREngine": 2,
            "scale": True,
            "detectOrientation": True
        },
        timeout=45
    )

    result = response.json()

    if result.get("IsErroredOnProcessing"):
        return ""

    parsed = result.get("ParsedResults", [])
    if not parsed:
        return ""

    return parsed[0].get("ParsedText", "")

# ---------------- PARSER ----------------
def parse_contact(raw_text, event_name, source):
    lines = [x.strip() for x in raw_text.splitlines() if x.strip()]
    text = " ".join(lines)

    email_match = re.search(
        r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
        text
    )

    phone_match = re.search(
        r"(\+?\d[\d\s()./-]{7,}\d)",
        text
    )

    email = email_match.group(0) if email_match else ""
    phone = phone_match.group(0) if phone_match else ""

    company_keywords = [
        "GmbH", "AG", "LLC", "Ltd", "Inc", "Group",
        "Bank", "Capital", "Partners", "Consulting",
        "Solutions", "Technology", "Systems", "Services"
    ]

    company = ""
    for line in lines:
        if any(k.lower() in line.lower() for k in company_keywords):
            company = line
            break

    name = ""
    for line in lines:
        if (
            line != company
            and "@" not in line
            and not re.search(r"\d", line)
            and len(line.split()) <= 4
        ):
            name = line
            break

    if not company and len(lines) > 1:
        company = lines[1]

    confidence = 90 if email and phone and name else 70 if email else 40

    return {
        "id": str(uuid.uuid4())[:8],
        "event_name": event_name,
        "source": source,
        "name": name,
        "company": company,
        "title": "",
        "email": email,
        "phone": phone,
        "status": "New",
        "confidence": confidence,
        "raw_text": raw_text
    }

# ---------------- DATABASE HELPERS ----------------
def save_contact(contact):
    cursor.execute("""
    INSERT OR REPLACE INTO contacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, tuple(contact.values()))
    conn.commit()

def load_contacts():
    return pd.read_sql_query("SELECT * FROM contacts", conn)

def delete_all_contacts():
    cursor.execute("DELETE FROM contacts")
    conn.commit()

# ---------------- EXCEL EXPORT ----------------
def create_excel(df):
    buffer = BytesIO()

    sf_df = df.rename(columns={
        "name": "LastName",
        "company": "Company",
        "email": "Email",
        "phone": "Phone",
        "status": "Status"
    })[[
        "LastName",
        "Company",
        "Email",
        "Phone",
        "Status",
        "event_name",
        "confidence"
    ]]

    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Contacts", index=False)
        sf_df.to_excel(writer, sheet_name="Salesforce Mapping", index=False)

        cube = df.pivot_table(
            index="event_name",
            values="id",
            aggfunc="count"
        ).rename(columns={"id": "contacts_count"})

        cube.to_excel(writer, sheet_name="Event Cube")

    return buffer.getvalue()

# ---------------- UI ----------------
st.title("📇 Business Card Wizard")
st.caption("Upload business cards → OCR extraction → dashboard → Excel cube → Salesforce-ready mapping")

event_name = st.text_input("Event name", value="GB AI Innovation Day")

tab1, tab2, tab3 = st.tabs([
    "Upload Cards",
    "Dashboard",
    "Salesforce Demo"
])

# ---------------- TAB 1 ----------------
with tab1:
    st.subheader("Upload business card photos")

    files = st.file_uploader(
        "Upload one or more card images",
        type=["jpg", "jpeg", "png"],
        accept_multiple_files=True
    )

    if st.button("🚀 Process cards"):
        if not files:
            st.warning("Please upload at least one image.")
        else:
            for file in files:
                st.image(file, caption=f"Uploaded: {file.name}", width=350)

                image_bytes = file.getvalue()
                raw_text = ocr_space_image(image_bytes)

                st.subheader("OCR text detected")
                st.text_area(
                    f"Raw OCR result for {file.name}",
                    raw_text,
                    height=180
                )

                contact = parse_contact(raw_text, event_name, "Upload")
                save_contact(contact)

                st.subheader("Extracted contact")
                st.json(contact)

            st.success(f"{len(files)} card(s) processed and saved.")

# ---------------- TAB 2 ----------------
with tab2:
    st.subheader("Event / Contact Dashboard")

    df = load_contacts()

    if df.empty:
        st.info("No contacts yet. Upload and process a business card first.")
    else:
        c1, c2, c3, c4 = st.columns(4)

        c1.metric("Contacts", len(df))
        c2.metric("Events", df["event_name"].nunique())
        c3.metric("Avg. Confidence", f"{df['confidence'].mean():.0f}%")
        c4.metric("Salesforce-ready", df["email"].ne("").sum())

        st.dataframe(df, use_container_width=True)

        excel = create_excel(df)

        st.download_button(
            "⬇️ Download Excel Data Cube",
            data=excel,
            file_name="business_card_wizard_cube.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

        if st.button("🧹 Clear demo database"):
            delete_all_contacts()
            st.success("Demo database cleared. Please refresh the page.")

# ---------------- TAB 3 ----------------
with tab3:
    st.subheader("Salesforce-ready field mapping")

    df = load_contacts()

    if df.empty:
        st.info("No Salesforce-ready data yet.")
    else:
        sf_df = df.rename(columns={
            "name": "LastName",
            "company": "Company",
            "email": "Email",
            "phone": "Phone",
            "status": "Status"
        })[[
            "LastName",
            "Company",
            "Email",
            "Phone",
            "Status",
            "event_name",
            "confidence"
        ]]

        st.dataframe(sf_df, use_container_width=True)

        if st.button("☁️ Demo: Push to Salesforce"):
            st.success(
                "Demo push successful. In production this connects to Salesforce via OAuth/API."
            )
