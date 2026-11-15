#!/usr/bin/env python3
"""
Fetches your top 5 tracks and top 5 favorite artists from TIDAL using `tidalapi`
and updates `assets/data/top-songs.json` and `assets/data/top-artists.json`.

Environment Variables:
  TIDAL_SESSION_JSON         (Required in CI) JSON string with token_type, access_token, refresh_token
  TIDAL_MIX_OR_PLAYLIST_ID   (Optional) Specific TIDAL Mix ID or Playlist UUID to pull tracks from
"""
import datetime as dt
import json
import os
import urllib.parse
from pathlib import Path
import requests
import tidalapi

ROOT_DIR = Path(__file__).resolve().parent.parent
TOP_SONGS_JSON = ROOT_DIR / "assets" / "data" / "top-songs.json"
TOP_ARTISTS_JSON = ROOT_DIR / "assets" / "data" / "top-artists.json"
LOCAL_SESSION_FILE = ROOT_DIR / ".tidal_session.json"

# Default playlist ID if TIDAL_MIX_OR_PLAYLIST_ID is not provided in env
DEFAULT_PLAYLIST_ID = "99ccf688-a0e0-4a5d-b7c5-8bcc52c4ce67"


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


def fetch_itunes_song_info(title: str, artist: str) -> tuple[str, str]:
    """Looks up a 30-second m4a preview URL and primary genre via the iTunes Search API."""
    if not title:
        return "", ""
    try:
        query = f"{title} {artist}"
        url = f"https://itunes.apple.com/search?term={urllib.parse.quote(query)}&entity=song&limit=5"
        resp = requests.get(url, timeout=6)
        if resp.ok:
            results = resp.json().get("results", [])
            artist_lower = artist.strip().lower()
            title_lower = title.strip().lower()
            # Prefer a result matching both artist and track title
            ordered = [
                r for r in results
                if artist_lower in (r.get("artistName", "") or "").lower()
                and title_lower in (r.get("trackName", "") or "").lower()
            ] + [
                r for r in results
                if artist_lower in (r.get("artistName", "") or "").lower()
            ] + results
            preview = next((r.get("previewUrl") for r in ordered if r.get("previewUrl")), "")
            genre = next((r.get("primaryGenreName") for r in ordered if r.get("primaryGenreName")), "")
            return preview or "", genre or ""
    except Exception:
        pass
    return "", ""


def fetch_itunes_preview(title: str, artist: str) -> str:
    """Looks up a permanent 30-second m4a preview URL via the iTunes Search API."""
    preview, _ = fetch_itunes_song_info(title, artist)
    return preview


DEEZER_PLACEHOLDER_HASHES = {
    "4974bd9746e43a4dfa23cf0cb991a237",
    "d41d8cd98f00b204e9800998ecf8427e",
}


def is_valid_deezer_picture(pic_url: str) -> bool:
    if not pic_url or "/artist//" in pic_url or "default" in pic_url.lower():
        return False
    return not any(h in pic_url for h in DEEZER_PLACEHOLDER_HASHES)


def get_artist_avatar(name: str, tidal_img: str, fallback_cover: str = "") -> str:
    """Returns a high-res artist avatar, falling back to Deezer or release cover art if generic."""
    # Check if TIDAL provided a real artist image (1e01cdb6 is TIDAL's generic placeholder silhouette)
    if tidal_img and "1e01cdb6" not in tidal_img:
        return tidal_img

    try:
        url = f"https://api.deezer.com/search/artist?q={urllib.parse.quote(name)}"
        resp = requests.get(url, timeout=4)
        if resp.ok:
            data = resp.json().get("data", [])
            name_lower = name.strip().lower()
            exact = [d for d in data if (d.get("name") or "").strip().lower() == name_lower]
            for candidate in exact + data:
                pic = candidate.get("picture_xl") or ""
                if is_valid_deezer_picture(pic):
                    return pic
    except Exception:
        pass

    if fallback_cover:
        return fallback_cover

    return "https://tidal.com/favicon.ico"


def get_artist_genre(name: str) -> str:
    """Fetches artist primary genre name via iTunes Search API."""
    try:
        url = f"https://itunes.apple.com/search?term={urllib.parse.quote(name)}&entity=musicArtist&limit=1"
        resp = requests.get(url, timeout=4)
        if resp.ok:
            results = resp.json().get("results", [])
            if results and results[0].get("primaryGenreName"):
                return results[0]["primaryGenreName"]
    except Exception:
        pass
    return ""


def get_deezer_genre(track_title: str, artist_name: str) -> str:
    """Backup genre lookup via Deezer track/album or artist album metadata."""
    try:
        if track_title:
            q = f"{track_title} {artist_name}"
            resp = requests.get(
                f"https://api.deezer.com/search?q={urllib.parse.quote(q)}&limit=3",
                timeout=4,
            )
            if resp.ok:
                for item in resp.json().get("data", []):
                    album_id = (item.get("album") or {}).get("id")
                    if album_id:
                        alb_resp = requests.get(f"https://api.deezer.com/album/{album_id}", timeout=4)
                        if alb_resp.ok:
                            genres = ((alb_resp.json().get("genres") or {}).get("data") or [])
                            if genres and genres[0].get("name"):
                                return genres[0]["name"]

        art_resp = requests.get(
            f"https://api.deezer.com/search/artist?q={urllib.parse.quote(artist_name)}&limit=3",
            timeout=4,
        )
        if art_resp.ok:
            artists_data = art_resp.json().get("data", [])
            if artists_data:
                art_id = artists_data[0].get("id")
                if art_id:
                    albs_resp = requests.get(
                        f"https://api.deezer.com/artist/{art_id}/albums?limit=3",
                        timeout=4,
                    )
                    if albs_resp.ok:
                        for alb in albs_resp.json().get("data", []):
                            album_id = alb.get("id")
                            if album_id:
                                full_alb = requests.get(f"https://api.deezer.com/album/{album_id}", timeout=4)
                                if full_alb.ok:
                                    genres = ((full_alb.json().get("genres") or {}).get("data") or [])
                                    if genres and genres[0].get("name"):
                                        return genres[0]["name"]
    except Exception:
        pass
    return ""


def resolve_artist_track_genre_and_preview(track_title: str, artist_name: str) -> tuple[str, str]:
    """Returns (genre, preview_url) prioritizing top-track genre -> artist genre -> Deezer backup."""
    preview_url, song_genre = fetch_itunes_song_info(track_title, artist_name)
    genre = song_genre or get_artist_genre(artist_name) or get_deezer_genre(track_title, artist_name) or "Artist"
    return genre, preview_url


def get_mix_items(session: tidalapi.Session, mix_obj):
    """Handles both tidalapi.Mix (has .items()) and tidalapi.MixV2 (needs session.mix(id).items())."""
    if hasattr(mix_obj, "items") and callable(mix_obj.items):
        return mix_obj.items()
    mix_id = getattr(mix_obj, "id", None)
    if mix_id:
        return session.mix(mix_id).items()
    return []


def find_top_tracks(session: tidalapi.Session, limit: int = 5):
    custom_id = os.environ.get("TIDAL_MIX_OR_PLAYLIST_ID", "").strip() or DEFAULT_PLAYLIST_ID

    # 1. If a specific Mix or Playlist ID is provided, use it directly
    if custom_id:
        try:
            playlist = session.playlist(custom_id)
            return playlist.tracks(limit=limit), getattr(playlist, "name", "Updated often")
        except Exception:
            mix = session.mix(custom_id)
            return mix.items()[:limit], getattr(mix, "title", "Updated often")

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
                    return items[:limit], getattr(mix, "title", "Updated often")

    if candidate_mixes:
        first_mix = candidate_mixes[0]
        items = get_mix_items(session, first_mix)
        if items:
            return items[:limit], getattr(first_mix, "title", "TIDAL Mix")

    fav_tracks = session.user.favorites.tracks(limit=limit, order="DATE", order_direction="DESC")
    return fav_tracks[:limit], "Recent Favorites"


def find_top_artists(session: tidalapi.Session, limit: int = 5):
    """Retrieves user's top favorite artists automatically from TIDAL."""
    artists = []
    try:
        home = session.home()
        for category in getattr(home, "categories", []):
            cat_title = (getattr(category, "title", "") or "").lower()
            if "favorite artists" in cat_title or "artist" in cat_title:
                for item in getattr(category, "items", []) or []:
                    if type(item).__name__ == "Artist" or getattr(item, "name", None):
                        artists.append(item)
                if len(artists) >= limit:
                    break
    except Exception:
        pass

    if not artists:
        try:
            favs = session.user.favorites.artists(limit=limit * 2)
            artists = list(favs)
        except Exception:
            pass

    return artists[:limit]


def sync_top_songs(session: tidalapi.Session, now_str: str):
    tracks, period_label = find_top_tracks(session, limit=5)
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

    existing_date = now_str
    if TOP_SONGS_JSON.exists():
        try:
            existing_data = json.loads(TOP_SONGS_JSON.read_text(encoding="utf-8"))
            existing_tracks = [
                (tr.get("rank"), tr.get("title"), tr.get("artist"), tr.get("url"))
                for tr in existing_data.get("tracks", [])
            ]
            new_tracks = [
                (tr.get("rank"), tr.get("title"), tr.get("artist"), tr.get("url"))
                for tr in formatted_tracks
            ]
            if existing_tracks == new_tracks and existing_data.get("updated_at"):
                existing_date = existing_data["updated_at"]
        except Exception:
            pass

    output_data = {
        "updated_at": existing_date,
        "period_label": "Updated often",
        "source": "TIDAL",
        "tracks": formatted_tracks,
    }

    TOP_SONGS_JSON.parent.mkdir(parents=True, exist_ok=True)
    TOP_SONGS_JSON.write_text(json.dumps(output_data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[OK] Updated {TOP_SONGS_JSON} with {len(formatted_tracks)} tracks ({period_label}).")


def build_user_top_tracks_by_artist(session: tidalapi.Session):
    """Maps artist IDs and lowercase names to the user's most-listened track for that artist."""
    by_id = {}
    by_name = {}

    def record_tracks(tracks):
        for tr in tracks or []:
            tr_artists = list(getattr(tr, "artists", None) or [])
            primary = getattr(tr, "artist", None)
            if primary and primary not in tr_artists:
                tr_artists.insert(0, primary)
            for art in tr_artists:
                art_id = getattr(art, "id", None)
                art_name = (getattr(art, "name", "") or "").strip().lower()
                if art_id is not None and art_id not in by_id:
                    by_id[art_id] = tr
                if art_name and art_name not in by_name:
                    by_name[art_name] = tr

    history_mixes = []
    try:
        home = session.home()
        for category in getattr(home, "categories", []):
            cat_title = (getattr(category, "title", "") or "").lower()
            if "history" in cat_title:
                for item in getattr(category, "items", []) or []:
                    if getattr(item, "id", None):
                        history_mixes.append(item)
    except Exception:
        pass

    # Prioritize "My Most Listened" before monthly/other history mixes
    history_mixes.sort(
        key=lambda m: 0 if "most listened" in (getattr(m, "title", "") or "").lower() else 1
    )
    for mix in history_mixes:
        try:
            record_tracks(get_mix_items(session, mix))
        except Exception:
            pass

    try:
        record_tracks(session.user.favorites.tracks(limit=50))
    except Exception:
        pass

    return by_id, by_name


def sync_top_artists(session: tidalapi.Session, now_str: str):
    artists = find_top_artists(session, limit=5)
    user_tracks_by_id, user_tracks_by_name = build_user_top_tracks_by_artist(session)
    formatted_artists = []

    for idx, a in enumerate(artists, start=1):
        try:
            art_obj = session.artist(a.id)
        except Exception:
            art_obj = a

        name = getattr(art_obj, "name", "Unknown Artist")
        tidal_img = ""
        try:
            tidal_img = art_obj.image(750)
        except Exception:
            pass

        top_track_obj = user_tracks_by_id.get(getattr(art_obj, "id", None)) or user_tracks_by_name.get(
            name.strip().lower()
        )
        if top_track_obj is None:
            try:
                tt = art_obj.get_top_tracks(limit=1)
                if tt:
                    top_track_obj = tt[0]
            except Exception:
                pass

        popular_track = getattr(top_track_obj, "name", "") if top_track_obj else ""
        fallback_cover = ""
        if top_track_obj and getattr(top_track_obj, "album", None):
            try:
                fallback_cover = top_track_obj.album.image(640)
            except Exception:
                pass
        if not fallback_cover:
            for getter in ("get_albums", "get_ep_singles"):
                try:
                    releases = getattr(art_obj, getter)(limit=1)
                    if releases:
                        fallback_cover = releases[0].image(640)
                        break
                except Exception:
                    pass

        avatar = get_artist_avatar(name, tidal_img, fallback_cover=fallback_cover)
        genre, preview_url = resolve_artist_track_genre_and_preview(popular_track, name)

        entry = {
            "rank": idx,
            "name": name,
            "avatar": avatar,
            "genre": genre,
            "popular_track": popular_track,
            "preview_url": preview_url,
            "url": f"https://tidal.com/browse/artist/{art_obj.id}",
        }
        formatted_artists.append(entry)

    existing_date = now_str
    if TOP_ARTISTS_JSON.exists():
        try:
            existing_data = json.loads(TOP_ARTISTS_JSON.read_text(encoding="utf-8"))
            existing_artists = [
                (ar.get("rank"), ar.get("name"), ar.get("avatar"), ar.get("popular_track"), ar.get("url"))
                for ar in existing_data.get("artists", [])
            ]
            new_artists = [
                (ar.get("rank"), ar.get("name"), ar.get("avatar"), ar.get("popular_track"), ar.get("url"))
                for ar in formatted_artists
            ]
            if existing_artists == new_artists and existing_data.get("updated_at"):
                existing_date = existing_data["updated_at"]
        except Exception:
            pass

    output_data = {
        "updated_at": existing_date,
        "period_label": "Favorite Artists",
        "source": "TIDAL",
        "artists": formatted_artists,
    }

    TOP_ARTISTS_JSON.parent.mkdir(parents=True, exist_ok=True)
    TOP_ARTISTS_JSON.write_text(json.dumps(output_data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[OK] Updated {TOP_ARTISTS_JSON} with {len(formatted_artists)} artists.")


def main():
    session = load_session()
    now_str = dt.date.today().isoformat()
    sync_top_songs(session, now_str)
    sync_top_artists(session, now_str)


if __name__ == "__main__":
    main()
