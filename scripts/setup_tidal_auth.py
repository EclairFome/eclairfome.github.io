#!/usr/bin/env python3
"""
One-time helper to authenticate with TIDAL via OAuth Device Login
and generate the TIDAL_SESSION_JSON secret for GitHub Actions.
"""
import json
import webbrowser
from pathlib import Path
import tidalapi


def main():
    session = tidalapi.Session()
    login, future = session.login_oauth()
    url = login.verification_uri_complete
    if not url.startswith("http"):
        url = f"https://{url}"

    print("=== TIDAL OAuth Setup ===", flush=True)
    print(f"Open this link to authorize TIDAL: {url}", flush=True)
    print(f"(Code expires in {login.expires_in} seconds... waiting for you to approve in browser)", flush=True)

    try:
        webbrowser.open(url)
    except Exception:
        pass

    future.result()

    if not session.check_login():
        raise RuntimeError("TIDAL login failed. Please try again.")

    expiry = (
        session.expiry_time.isoformat()
        if getattr(session, "expiry_time", None)
        else None
    )
    payload = {
        "token_type": session.token_type,
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
        "expiry_time": expiry,
    }

    session_json = json.dumps(payload)
    local_file = Path(__file__).resolve().parent.parent / ".tidal_session.json"
    local_file.write_text(session_json, encoding="utf-8")

    print("\n[OK] Successfully authenticated with TIDAL!", flush=True)
    print(f"Saved local session to: {local_file}\n", flush=True)
    print("TIDAL_SESSION_JSON:", flush=True)
    print(session_json, flush=True)


if __name__ == "__main__":
    main()
