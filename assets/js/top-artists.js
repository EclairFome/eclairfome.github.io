/**
 * Dynamically renders the "Top Artists" TIDAL widget
 * from assets/data/top-artists.json (updated automatically via GitHub Actions).
 */
(function () {
  const FALLBACK_DATA = {
    updated_at: "2026-11-15",
    period_label: "Favorite Artists",
    source: "TIDAL",
    artists: [
      {
        rank: 1,
        name: "Candelabro",
        avatar: "https://resources.tidal.com/images/419daa1f/a9c0/4e2e/99ab/9199b8e083ab/750x750.jpg",
        genre: "Alternative",
        popular_track: "Domingo de ramos",
        url: "https://tidal.com/browse/artist/16486302"
      },
      {
        rank: 2,
        name: "isaac moises",
        avatar: "https://cdn-images.dzcdn.net/images/artist/af292ce8af6616bc75bfaa2c4030a5c9/1000x1000-000000-80-0-0.jpg",
        genre: "Urbano latino",
        popular_track: "ROCKSTAR (feat. NUTTYRN)",
        url: "https://tidal.com/browse/artist/39790502"
      },
      {
        rank: 3,
        name: "Estamos Perdidos",
        avatar: "https://cdn-images.dzcdn.net/images/artist/4974bd9746e43a4dfa23cf0cb991a237/1000x1000-000000-80-0-0.jpg",
        genre: "Indie Rock",
        popular_track: "Mil veces agosto",
        url: "https://tidal.com/browse/artist/47505603"
      },
      {
        rank: 4,
        name: "Residente",
        avatar: "https://resources.tidal.com/images/9ef41330/b86c/452f/99a8/1e8db257907b/750x750.jpg",
        genre: "Urbano latino",
        popular_track: "Bellacoso",
        url: "https://tidal.com/browse/artist/4504807"
      },
      {
        rank: 5,
        name: "AJR",
        avatar: "https://resources.tidal.com/images/aa49e7ec/fc6d/4075/ac8a/d8b9014d042a/750x750.jpg",
        genre: "Pop",
        popular_track: "Weak",
        url: "https://tidal.com/browse/artist/5073699"
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

  function renderTopArtists(data) {
    const listEl = document.getElementById("top-artists-list");
    const subtitleEl = document.getElementById("top-artists-subtitle");
    if (!listEl) return;

    const artists = Array.isArray(data.artists) ? data.artists.slice(0, 5) : [];
    if (subtitleEl) {
      subtitleEl.textContent = `${data.period_label || "Favorite Artists"} • Synced from TIDAL`;
    }

    listEl.innerHTML = artists
      .map((artist, idx) => {
        const rank = artist.rank || idx + 1;
        const delayMs = idx * 80;
        const artistUrl = artist.url || `https://tidal.com/search?q=${encodeURIComponent(artist.name)}`;
        const popularTrack = artist.popular_track
          ? `<span class="artist-meta"><span class="artist-meta-label">Popular:</span> <span class="artist-meta-value">${escapeHtml(artist.popular_track)}</span></span>`
          : "";
        const genreBadge = artist.genre
          ? `<span class="artist-genre-badge">${escapeHtml(artist.genre)}</span>`
          : "";

        return `
          <a class="artist-row" href="${escapeHtml(artistUrl)}" target="_blank" rel="noopener noreferrer" data-rank="${rank}" style="animation-delay: ${delayMs}ms;" title="Open ${escapeHtml(artist.name)} on TIDAL">
            <div class="artist-rank">#${rank}</div>
            <div class="artist-avatar-wrap">
              <img class="artist-avatar" src="${escapeHtml(artist.avatar)}" alt="${escapeHtml(artist.name)}" loading="lazy" />
            </div>
            <div class="artist-info">
              <div class="artist-top-line">
                <h6 class="artist-name">${escapeHtml(artist.name)}</h6>
                ${genreBadge}
              </div>
              ${popularTrack}
            </div>
          </a>
        `;
      })
      .join("");
  }

  document.addEventListener("DOMContentLoaded", function () {
    fetch("assets/data/top-artists.json", { cache: "no-cache" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch top-artists.json");
        return res.json();
      })
      .then((data) => renderTopArtists(data))
      .catch(() => renderTopArtists(FALLBACK_DATA));
  });
})();
