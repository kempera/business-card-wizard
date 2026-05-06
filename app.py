import streamlit as st
import pandas as pd
import sqlite3
import re
import uuid
import requests
from PIL import Image
from io import BytesIO

st.set_page_config(page_title="Business Card Wizard", layout="wide")

DB = "contacts.db"

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


def ocr_space_image(image_bytes):
    api_key = st.secrets.get("OCR_SPACE_API_KEY", "helloworld")

    response = requests.post(
        "https://api.ocr.space/parse/image",
        files={"file": ("card.jpg", image_bytes)},
        data={
            "apikey": api_key,
            "language": "eng",
            "isOverlayRequired": False,
            "OCREngine": 2
        },
        timeout=30
    )

    result = response.json()

    if result.get("IsErroredOnProcessing"):
        return ""

    parsed = result.get("ParsedResults", [])
    if not parsed:
        return ""

    return parsed[0].get("ParsedText", "")


def parse_contact(raw_text, event_name, source):
    lines = [x.strip() for x in raw_text.splitlines() if x.strip()]
    text = " ".join(lines)

    email_match = re.search(r"[\w\.-]+@[\w\.-]+\.\w+", text)
    phone_match = re.search(r"\+?\d[\d\s\-().]{7,}", text)

    email = email_match.group(0) if email_match else ""
    phone = phone_match.group(0) if phone_match else ""

    name = lines[0] if len(lines) > 0 else ""
    company = lines[1] if len(lines) > 1 else ""

    confidence = 90 if email and phone else 70 if email else 45

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


def save_contact(contact):
    cursor.execute("""
    INSERT OR REPLACE INTO contacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, tuple(contact.values()))
    conn.commit()


def load_contacts():
    return pd.read_sql_query("SELECT * FROM contacts", conn)


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


st.title("📇 Business Card Wizard")
st.caption("Stable Streamlit MVP: upload/email-ready photos → OCR → lead database → Excel cube → Salesforce-ready mapping")

event_name = st.text_input("Event name", value="GB AI Innovation Day")

tab1, tab2, tab3 = st.tabs([
    "Upload Cards",
    "Dashboard",
    "Salesforce Demo"
])

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
                image_bytes = file.getvalue()
                raw_text = ocr_space_image(image_bytes)
                contact = parse_contact(raw_text, event_name, "Upload")
                save_contact(contact)

            st.success(f"{len(files)} card(s) processed.")

with tab2:
    df = load_contacts()

    st.subheader("Event / Contact Dashboard")

    if df.empty:
        st.info("No contacts yet.")
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

with tab3:
    df = load_contacts()

    st.subheader("Salesforce-ready field mapping")

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
            st.success("Demo push successful. In production this connects to Salesforce via OAuth/API.")
