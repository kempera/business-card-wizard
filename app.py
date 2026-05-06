import streamlit as st
import pandas as pd
import easyocr
from PIL import Image
import sqlite3
import re
import uuid
import numpy as np

st.set_page_config(page_title="Business Card Wizard", layout="wide")

# Database
conn = sqlite3.connect("contacts.db", check_same_thread=False)
cursor = conn.cursor()

cursor.execute("""
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT,
    name TEXT,
    company TEXT,
    email TEXT,
    phone TEXT,
    raw_text TEXT
)
""")

# OCR
reader = easyocr.Reader(['en'])

def extract_data(image):
    img_array = np.array(image)
    result = reader.readtext(img_array)
    text = " ".join([r[1] for r in result])

    email = re.findall(r'[\w\.-]+@[\w\.-]+', text)
    phone = re.findall(r'\+?\d[\d\s\-]{7,}', text)
    words = text.split()

    return {
        "id": str(uuid.uuid4())[:8],
        "name": " ".join(words[:2]) if len(words) >= 2 else "",
        "company": words[2] if len(words) >= 3 else "",
        "email": email[0] if email else "",
        "phone": phone[0] if phone else "",
        "raw_text": text
    }

st.title("📇 Business Card Wizard")
st.caption("We don’t just read business cards — we understand them")

uploaded_file = st.file_uploader("Upload business card", type=["png","jpg","jpeg"])

if uploaded_file:
    image = Image.open(uploaded_file)
    st.image(image)

    if st.button("🚀 Process"):
        data = extract_data(image)

        cursor.execute("INSERT INTO contacts VALUES (?, ?, ?, ?, ?, ?)", tuple(data.values()))
        conn.commit()

        st.success("Contact captured")
        st.json(data)

st.subheader("📊 Contacts")

df = pd.read_sql_query("SELECT * FROM contacts", conn)
st.dataframe(df)

if not df.empty:
    df.to_excel("contacts.xlsx", index=False)
    with open("contacts.xlsx", "rb") as f:
        st.download_button("Download Excel", f, "contacts.xlsx")