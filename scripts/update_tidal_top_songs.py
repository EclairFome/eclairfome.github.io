#!/usr/bin/env python3
"""
Fetches your top 5 monthly tracks from TIDAL using `tidalapi` and updates
`assets/data/top-songs.json` (including 30-second audio preview URLs).

Environment Variables:
  TIDAL_SESSION_JSON         (Required in CI) JSON string with token_type, access_token, refresh_token
  TIDAL_MIX_OR_PLAYLIST_ID   (Optional) Specific TIDAL Mix ID or Playlist UUID to pull from
"""
import datetime as dt
import json
import os
import urllib.parse
from pathlib import Path
import requests
import tidalapi

ROOT_DIR = Path(__file__).resolve().parent.parent
OUTPUT_JSON = ROOT_DIR / "assets" / "data" / "top-songs.json"
LOCAL_SESSION_FILE = ROOT_DIR / ".tidal_session.json"


def load_session() -> tidalapi.Session:
    raw = os.environ.get("TIDAL_SESSION_JSON", "").strip()
    if not raw and LOCAL_SESSION_FILE.exists():
        raw = LOCAL_SESSION_FILE.read_text(encoding="utf-8").strip()

    if not raw:
        raise RuntimeError(
            "Missing TIDAL_SESSION_JSON environment variable (or .tidal_session.json). "
            "Run `python scripts/setup_tidal_auth.py` first."
        )

    creds = json.loads(raw)
    session = tidalapi.Session()

    expiry = None
    if creds.get("expiry_time"):
        try:
            expiry = dt.datetime.fromisoformat(creds["expiry_time"])
        except ValueError:
            expiry = None

    session.load_oauth_session(
        token_type=creds.get("token_type", "Bearer"),
        access_token=creds["access_token"],
        refresh_token=creds.get("refresh_token"),
        expiry_time=expiry,
    )

    if not session.check_login():
        raise RuntimeError("TIDAL session is invalid or expired and could not be refreshed.")

    return session


def get_track_cover(track) -> str:
    try:
        if getattr(track, "album", None):
            return track.album.image(640)
    except Exception:
        pass
    return "https://tidal.com/favicon.ico"


def fetch_itunes_preview(title: str, artist: str) -> str:
    """Looks up a permanent 30-second m4a preview URL via the iTunes Search API."""
    try:
        query = f"{title} {artist}"
        url = f"https://itunes.apple.com/search?term={urllib.parse.quote(query)}&entity=song&limit=3"
        resp = requests.get(url, timeout=6)
        if resp.ok:
            results = resp.json().get("results", [])
            artist_lower = artist.lower()
            for r in results:
                if artist_lower in (r.get("artistName", "") or "").lower() and r.get("previewUrl"):
                    return r["previewUrl"]
            if results and results[0].get("previewUrl"):
                return results[0]["previewUrl"]
    except Exception:
        pass
    return ""


def get_mix_items(session: tidalapi.Session, mix_obj):
    """Handles both tidalapi.Mix (has .items()) and tidalapi.MixV2 (needs session.mix(id).items())."""
    if hasattr(mix_obj, "items") and callable(mix_obj.items):
        return mix_obj.items()
    mix_id = getattr(mix_obj, "id", None)
    if mix_id:
        return session.mix(mix_id).items()
    return []


def find_top_tracks(session: tidalapi.Session, limit: int = 5):
    custom_id = os.environ.get("TIDAL_MIX_OR_PLAYLIST_ID", "").strip()

    # 1. If a specific Mix or Playlist ID is provided, use it directly
    if custom_id:
        try:
            mix = session.mix(custom_id)
            return mix.items()[:limit], getattr(mix, "title", "My Most Listened")
        except Exception:
            playlist = session.playlist(custom_id)
            return playlist.tracks(limit=limit), getattr(playlist, "name", "Monthly Top Songs")

    # 2. Search user's Home page ("Your listening history" -> "My Most Listened") and Mixes
    candidate_mixes = []
    try:
        home = session.home()
        for category in getattr(home, "categories", []):
            cat_title = (getattr(category, "title", "") or "").lower()
            for item in getattr(category, "items", []) or []:
                if getattr(item, "id", None) and (
                    isinstance(item, tidalapi.Mix)
                    or type(item).__name__.startswith("Mix")
                    or "history" in cat_title
                ):
                    candidate_mixes.append(item)
    except Exception:
        pass

    try:
        for m in session.mixes():
            candidate_mixes.append(m)
    except Exception:
        pass

    # Prioritize "My Most Listened" / "History" / "Monthly" mixes, then "My Mix 1"
    keywords_priority = [
        ("most listened", "month", "history"),
        ("my mix 1", "my mix"),
    ]
    for kw_group in keywords_priority:
        for mix in candidate_mixes:
            title_sub = f"{getattr(mix, 'title', '')} {getattr(mix, 'sub_title', '')}".lower()
            if any(k in title_sub for k in kw_group):
                items = get_mix_items(session, mix)
                if items:
                    return items[:limit], getattr(mix, "title", "My Most Listened")

    if candidate_mixes:
        first_mix = candidate_mixes[0]
        items = get_mix_items(session, first_mix)
        if items:
            return items[:limit], getattr(first_mix, "title", "TIDAL Mix")

    # 3. Fallback to most recently added Favorite tracks
    fav_tracks = session.user.favorites.tracks(limit=limit, order="DATE", order_direction="DESC")
    return fav_tracks[:limit], "Recent Favorites"


def main():
    session = load_session()
    tracks, period_label = find_top_tracks(session, limit=5)

    now_str = dt.date.today().isoformat()
    formatted_tracks = []

    for idx, t in enumerate(tracks, start=1):
        title = getattr(t, "name", "Unknown Track")
        artist_name = getattr(getattr(t, "artist", None), "name", "Unknown Artist")
        album_name = getattr(getattr(t, "album", None), "name", "")
        duration_sec = getattr(t, "duration", 0) or 0
        mins, secs = divmod(int(duration_sec), 60)

        preview_url = fetch_itunes_preview(title, artist_name)

        entry = {
            "rank": idx,
            "title": title,
            "artist": artist_name,
            "album": album_name,
            "cover": get_track_cover(t),
            "url": f"https://tidal.com/browse/track/{t.id}",
            "duration_label": f"{mins}:{secs:02d}" if duration_sec else f"Top #{idx}",
            "preview_url": preview_url,
        }
        if getattr(t, "play_count", None):
            entry["plays"] = int(t.play_count)

        formatted_tracks.append(entry)

    output_data = {
        "updated_at": now_str,
        "period_label": period_label,
        "source": "TIDAL",
        "tracks": formatted_tracks,
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(output_data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[OK] Updated {OUTPUT_JSON} with {len(formatted_tracks)} tracks ({period_label}).")


if __name__ == "__main__":
    main()
