/**
 * Dynamically renders the "Current Top Artists" TIDAL widget
 * from assets/data/top-artists.json (updated automatically via GitHub Actions)
 * with interactive 30-second audio previews of each artist's top track.
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
        popular_track: "Señales",
        preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/51/17/95/51179581-e249-e52a-5bce-744ac2982678/mzaf_17860899489840587041.plus.aac.p.m4a",
        url: "https://tidal.com/browse/artist/16486302"
      },
      {
        rank: 2,
        name: "isaac moises",
        avatar: "https://cdn-images.dzcdn.net/images/artist/af292ce8af6616bc75bfaa2c4030a5c9/1000x1000-000000-80-0-0.jpg",
        genre: "Urbano latino",
        popular_track: "ME GUSTA LA PLATA",
        preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/24/47/e5/2447e593-b0d6-41b5-b678-2bd036ee20fb/mzaf_13212010029208402187.plus.aac.p.m4a",
        url: "https://tidal.com/browse/artist/39790502"
      },
      {
        rank: 3,
        name: "Estamos Perdidos",
        avatar: "https://resources.tidal.com/images/156cbd43/3c70/4ad8/afdd/bf7b6992a820/640x640.jpg",
        genre: "Alternative",
        popular_track: "Puchinbolo",
        preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/0a/7e/32/0a7e3220-08a3-eb3d-7acd-b6e0bec80f95/mzaf_4675849502556714915.plus.aac.p.m4a",
        url: "https://tidal.com/browse/artist/47505603"
      },
      {
        rank: 4,
        name: "Residente",
        avatar: "https://resources.tidal.com/images/9ef41330/b86c/452f/99a8/1e8db257907b/750x750.jpg",
        genre: "Urbano latino",
        popular_track: "Hijos del Cañaveral",
        preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/9d/be/eb/9dbeeb87-546e-ede8-873a-b712bb079d9a/mzaf_17027572938236075387.plus.aac.p.m4a",
        url: "https://tidal.com/browse/artist/4504807"
      },
      {
        rank: 5,
        name: "AJR",
        avatar: "https://resources.tidal.com/images/aa49e7ec/fc6d/4075/ac8a/d8b9014d042a/750x750.jpg",
        genre: "Alternative",
        popular_track: "Karma",
        preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/f5/19/86/f51986a2-05be-c18a-ebb8-601dcbecab93/mzaf_14477918538204274045.plus.aac.p.m4a",
        url: "https://tidal.com/browse/artist/5073699"
      }
    ]
  };

  let currentAudio = null;
  let currentRow = null;

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fetchDeezerJsonp(query) {
    return new Promise((resolve) => {
      const cbName = "dz_art_cb_" + Math.random().toString(36).slice(2, 9);
      const script = document.createElement("script");
      const timer = setTimeout(() => {
        cleanup();
        resolve("");
      }, 4500);

      function cleanup() {
        clearTimeout(timer);
        delete window[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[cbName] = function (data) {
        cleanup();
        if (data && Array.isArray(data.data) && data.data.length > 0 && data.data[0].preview) {
          resolve(data.data[0].preview);
        } else {
          resolve("");
        }
      };

      script.src = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1&output=jsonp&callback=${cbName}`;
      script.onerror = function () {
        cleanup();
        resolve("");
      };
      document.body.appendChild(script);
    });
  }

  function resolvePreviewUrl(artist) {
    if (artist.preview_url) {
      return Promise.resolve(artist.preview_url);
    }

    const query = artist.popular_track ? `${artist.popular_track} ${artist.name}` : artist.name;
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`;

    return fetch(itunesUrl)
      .then((r) => r.json())
      .then((res) => {
        if (res.results && res.results.length > 0 && res.results[0].previewUrl) {
          artist.preview_url = res.results[0].previewUrl;
          return artist.preview_url;
        }
        return fetchDeezerJsonp(query);
      })
      .catch(() => fetchDeezerJsonp(query));
  }

  function stopCurrentPlayback() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    if (currentRow) {
      currentRow.classList.remove("is-playing");
      const timerEl = currentRow.querySelector(".artist-timer");
      if (timerEl) timerEl.textContent = "";
      const fillEl = currentRow.querySelector(".artist-bar-fill");
      if (fillEl) fillEl.style.setProperty("--bar-width", "0%");
      currentRow = null;
    }
  }

  function toggleArtistPreview(rowEl, artist) {
    if (currentRow === rowEl && currentAudio) {
      stopCurrentPlayback();
      return;
    }

    stopCurrentPlayback();
    window.dispatchEvent(new CustomEvent("retro-audio-play", { detail: { source: "top-artists" } }));
    rowEl.classList.add("is-playing");
    currentRow = rowEl;

    const timerEl = rowEl.querySelector(".artist-timer");
    const fillEl = rowEl.querySelector(".artist-bar-fill");
    if (timerEl) timerEl.textContent = "Loading...";

    resolvePreviewUrl(artist).then((previewUrl) => {
      if (currentRow !== rowEl) return;

      if (!previewUrl) {
        stopCurrentPlayback();
        const fallbackUrl = artist.url || `https://tidal.com/search?q=${encodeURIComponent(artist.name)}`;
        window.open(fallbackUrl, "_blank", "noopener");
        return;
      }

      const audio = new Audio(previewUrl);
      audio.volume = 0.75;
      currentAudio = audio;

      audio.addEventListener("timeupdate", function () {
        if (currentRow !== rowEl || !audio.duration) return;
        const pct = Math.min(100, Math.max(5, (audio.currentTime / audio.duration) * 100));
        if (fillEl) fillEl.style.setProperty("--bar-width", `${pct}%`);
        const remaining = Math.max(0, Math.ceil(audio.duration - audio.currentTime));
        if (timerEl) timerEl.textContent = `0:${String(remaining).padStart(2, "0")}`;
      });

      audio.addEventListener("ended", function () {
        stopCurrentPlayback();
      });

      audio.addEventListener("error", function () {
        const query = artist.popular_track ? `${artist.popular_track} ${artist.name}` : artist.name;
        fetchDeezerJsonp(query).then((fallbackUrl) => {
          if (fallbackUrl && fallbackUrl !== previewUrl && currentRow === rowEl) {
            artist.preview_url = fallbackUrl;
            audio.src = fallbackUrl;
            audio.play().catch(() => stopCurrentPlayback());
          } else {
            stopCurrentPlayback();
          }
        });
      });

      audio.play().catch(() => {
        stopCurrentPlayback();
      });
    });
  }

  function renderTopArtists(data) {
    const listEl = document.getElementById("top-artists-list");
    const subtitleEl = document.getElementById("top-artists-subtitle");
    if (!listEl) return;

    const artists = Array.isArray(data.artists) ? data.artists.slice(0, 5) : [];
    if (subtitleEl) {
      subtitleEl.textContent = "Click an artist for 30s preview";
    }

    listEl.innerHTML = artists
      .map((artist, idx) => {
        const rank = artist.rank || idx + 1;
        const delayMs = idx * 80;
        const artistUrl = artist.url || `https://tidal.com/search?q=${encodeURIComponent(artist.name)}`;
        const popularTrack = artist.popular_track
          ? `<span class="artist-meta"><span class="artist-meta-label">Top Track:</span> <span class="artist-meta-value">${escapeHtml(artist.popular_track)}</span></span>`
          : "";
        const genreBadge = artist.genre
          ? `<span class="artist-genre-badge">${escapeHtml(artist.genre)}</span>`
          : "";

        return `
          <div class="artist-row" role="button" tabindex="0" data-index="${idx}" data-rank="${rank}" style="animation-delay: ${delayMs}ms;" title="Click to play 30s preview">
            <div class="artist-rank">#${rank}</div>
            <div class="artist-avatar-wrap">
              <img class="artist-avatar" src="${escapeHtml(artist.avatar)}" alt="${escapeHtml(artist.name)}" loading="lazy" />
              <div class="artist-avatar-overlay">
                <svg class="icon-play" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                <svg class="icon-pause" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              </div>
            </div>
            <div class="artist-info">
              <div class="artist-top-line">
                <div class="artist-name-wrap">
                  <h6 class="artist-name">${escapeHtml(artist.name)}</h6>
                  <span class="retro-eq" aria-hidden="true">
                    <span class="eq-bar eq-1"></span>
                    <span class="eq-bar eq-2"></span>
                    <span class="eq-bar eq-3"></span>
                    <span class="eq-bar eq-4"></span>
                    <span class="eq-bar eq-5"></span>
                  </span>
                </div>
                <div class="artist-meta-actions">
                  <span class="artist-timer"></span>
                  ${genreBadge}
                  <a class="artist-tidal-link" href="${escapeHtml(artistUrl)}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(artist.name)} on TIDAL">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/>
                      <path fill-rule="evenodd" d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"/>
                    </svg>
                  </a>
                </div>
              </div>
              ${popularTrack}
              <div class="artist-bar-track">
                <div class="artist-bar-fill" style="--bar-width: 0%;"></div>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    const rows = listEl.querySelectorAll(".artist-row");
    rows.forEach((row) => {
      const idx = Number(row.dataset.index);
      const artist = artists[idx];
      const tidalLink = row.querySelector(".artist-tidal-link");
      if (tidalLink) {
        tidalLink.addEventListener("click", function (e) {
          e.stopPropagation();
        });
      }
      row.addEventListener("click", function () {
        toggleArtistPreview(row, artist);
      });
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleArtistPreview(row, artist);
        }
      });
    });
  }

  window.addEventListener("retro-audio-play", function (e) {
    if (!e.detail || e.detail.source !== "top-artists") {
      stopCurrentPlayback();
    }
  });

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
