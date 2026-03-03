# API Field Omission Tester (Nested + Minimal Persistence)

Streamlit app to automatically omit one field/path at a time from a base payload,
send an HTTP request, and log pass/fail with a best-effort "why".

## Key features
- Paste or upload payload (JSON, XML, CSV)
- Auto-detect payload type
- Dynamic field discovery:
  - JSON supports nested paths (e.g., contacts[0].email)
  - XML supports element paths (root/child[0]/sub[1]) and attributes (path@attr)
  - CSV supports column omission
- Checkbox UI to mark Protected fields (never omitted)
- Omit-one-field suite over all other discovered paths
- Result downloads: CSV and JSON
- **Minimal persistence** via SQLite (`field_tester.db`):
  - Each run is stored and viewable in "Run History"
  - Any prior run can be exported again

## Setup
```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
streamlit run app.py
