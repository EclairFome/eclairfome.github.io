/**
 * Dynamically renders the "My top songs of the month" TIDAL widget
 * from assets/data/top-songs.json (updated automatically via GitHub Actions).
 */
(function () {
  const FALLBACK_DATA = {
    updated_at: "2026-10-22",
    period_label: "My Most Listened",
    source: "TIDAL",
    tracks: [
      {
        rank: 1,
        title: "Evil Spawn",
        artist: "Waxahatchee",
        album: "Tigers Blood",
        cover: "https://resources.tidal.com/images/9c091147/0ed6/4cb4/8406/44029e909b5a/640x640.jpg",
        url: "https://tidal.com/browse/track/336429540",
        duration_label: "3:13"
      },
      {
        rank: 2,
        title: "Vienen A Verme (From \"El Chapo\" Soundtrack)",
        artist: "iLe",
        album: "El Chapo (Original Television Soundtrack)",
        cover: "https://resources.tidal.com/images/091a5f6f/a8a2/4922/85a0/dbf94e4920f1/640x640.jpg",
        url: "https://tidal.com/browse/track/92804095",
        duration_label: "3:21"
      },
      {
        rank: 3,
        title: "snug tug",
        artist: "Pompey",
        album: "Snug Tug (single)",
        cover: "https://resources.tidal.com/images/2dbcb70c/eabc/41fd/9b3d/f96fb5c02e48/640x640.jpg",
        url: "https://tidal.com/browse/track/417023145",
        duration_label: "2:36"
      },
      {
        rank: 4,
        title: "the cops are coming",
        artist: "Junior Mesa",
        album: "the cops are coming",
        cover: "https://resources.tidal.com/images/7305e25c/45ca/44a6/bc26/d2ee0d5895c1/640x640.jpg",
        url: "https://tidal.com/browse/track/549286222",
        duration_label: "3:14"
      },
      {
        rank: 5,
        title: "Kinder des Olymp",
        artist: "125, Rue Montmartre",
        album: "Discography",
        cover: "https://resources.tidal.com/images/7b2489ed/13d8/4dee/bf0f/4b107461919d/640x640.jpg",
        url: "https://tidal.com/browse/track/247333754",
        duration_label: "1:50"
      }
    ]
  };

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderTopSongs(data) {
    const listEl = document.getElementById("top-songs-list");
    const subtitleEl = document.getElementById("top-songs-subtitle");
    if (!listEl) return;

    const tracks = Array.isArray(data.tracks) ? data.tracks.slice(0, 5) : [];
    if (subtitleEl && data.updated_at) {
      subtitleEl.textContent = `${data.period_label || "Monthly Rotation"} • Updated ${data.updated_at}`;
    }

    const maxPlays = tracks.reduce((max, t) => Math.max(max, Number(t.plays) || 0), 0);

    listEl.innerHTML = tracks
      .map((track, idx) => {
        const rank = track.rank || idx + 1;
        const plays = Number(track.plays) || 0;
        // Calculate bar percentage based on play count, or rank curve if play counts aren't available
        const barPercent =
          maxPlays > 0 && plays > 0
            ? Math.max(18, Math.round((plays / maxPlays) * 100))
            : Math.max(25, 100 - idx * 15);

        const playsLabel =
          plays > 0
            ? `${plays} plays`
            : track.duration_label || `Top #${rank}`;

        const delayMs = idx * 80;
        const trackUrl = track.url || `https://tidal.com/search?q=${encodeURIComponent(track.title + " " + track.artist)}`;

        return `
          <a class="song-row" href="${escapeHtml(trackUrl)}" target="_blank" rel="noopener noreferrer" data-rank="${rank}" style="animation-delay: ${delayMs}ms;">
            <div class="song-rank">#${rank}</div>
            <div class="song-cover-wrap">
              <img class="song-cover" src="${escapeHtml(track.cover)}" alt="${escapeHtml(track.title)}" loading="lazy" />
              <div class="song-cover-overlay" title="Open in TIDAL">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </div>
            </div>
            <div class="song-info">
              <div class="song-top-line">
                <h6 class="song-title">${escapeHtml(track.title)}</h6>
                <span class="song-plays">${escapeHtml(playsLabel)}</span>
              </div>
              <div class="song-artist">${escapeHtml(track.artist)}${track.album ? ` • <span style="opacity:0.65">${escapeHtml(track.album)}</span>` : ""}</div>
              <div class="song-bar-track">
                <div class="song-bar-fill" style="--bar-width: ${barPercent}%;"></div>
              </div>
            </div>
          </a>
        `;
      })
      .join("");
  }

  document.addEventListener("DOMContentLoaded", function () {
    fetch("assets/data/top-songs.json", { cache: "no-cache" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch top-songs.json");
        return res.json();
      })
      .then((data) => renderTopSongs(data))
      .catch(() => renderTopSongs(FALLBACK_DATA));
  });
})();
