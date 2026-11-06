/**
 * Dynamically renders the "My top songs of the month" TIDAL widget
 * with interactive 30-second audio previews and spinning 70s vinyl animation.
 */
(function () {
  const FALLBACK_DATA = {
    updated_at: "2026-11-06",
    period_label: "My Most Listened",
    source: "TIDAL",
    tracks: [
      {
        rank: 1,
        title: "the cops are coming",
        artist: "Junior Mesa",
        album: "the cops are coming",
        cover: "https://resources.tidal.com/images/7305e25c/45ca/44a6/bc26/d2ee0d5895c1/640x640.jpg",
        url: "https://tidal.com/browse/track/549286222",
        duration_label: "3:14",
        preview_url: ""
      },
      {
        rank: 2,
        title: "bray fool",
        artist: "campthehills",
        album: "bray fool",
        cover: "https://resources.tidal.com/images/78888ff7/46d7/44eb/864a/b9e09972bb47/640x640.jpg",
        url: "https://tidal.com/browse/track/557243119",
        duration_label: "2:52",
        preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/50/c2/45/50c2454e-32eb-ecd0-4ff4-ac1e81d2eacc/mzaf_11243209844020897804.plus.aac.p.m4a"
      },
      {
        rank: 3,
        title: "27a Pitfield St",
        artist: "bassvictim",
        album: "Forever",
        cover: "https://resources.tidal.com/images/2377a080/a18b/4bc6/8e79/4fbce2ba1348/640x640.jpg",
        url: "https://tidal.com/browse/track/529703645",
        duration_label: "2:47",
        preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/75/ef/d8/75efd8ef-ea00-ffa8-eb69-4184d418415a/mzaf_8664352154715662537.plus.aac.p.m4a"
      },
      {
        rank: 4,
        title: "Anova",
        artist: "Hesse Kassel",
        album: "La Brea",
        cover: "https://resources.tidal.com/images/8da40ea6/abbd/473e/b557/1debb120247b/640x640.jpg",
        url: "https://tidal.com/browse/track/418440494",
        duration_label: "7:22",
        preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/14/df/a1/14dfa13f-f913-c60d-bc6c-fd7d19a1db58/mzaf_8407304920528146714.plus.aac.p.m4a"
      },
      {
        rank: 5,
        title: "Contigo",
        artist: "Niños Del Cerro",
        album: "Lance",
        cover: "https://resources.tidal.com/images/e16411f7/4009/44dd/9b05/65be4008d8bc/640x640.jpg",
        url: "https://tidal.com/browse/track/419603222",
        duration_label: "3:44",
        preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/62/22/f9/6222f900-42c2-3a89-6328-66197484f3ba/mzaf_12272904292340460203.plus.aac.p.m4a"
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

  /**
   * Resolves a 30-second preview URL using cached preview_url, iTunes API, or Deezer JSONP API.
   */
  function resolvePreviewUrl(track) {
    if (track.preview_url) {
      return Promise.resolve(track.preview_url);
    }

    const query = `${track.title} ${track.artist}`;
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`;

    return fetch(itunesUrl)
      .then((r) => r.json())
      .then((res) => {
        if (res.results && res.results.length > 0 && res.results[0].previewUrl) {
          track.preview_url = res.results[0].previewUrl;
          return track.preview_url;
        }
        return fetchDeezerJsonp(query);
      })
      .catch(() => fetchDeezerJsonp(query));
  }

  function fetchDeezerJsonp(query) {
    return new Promise((resolve) => {
      const cbName = "dz_cb_" + Math.random().toString(36).slice(2, 9);
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

  function stopCurrentPlayback() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    if (currentRow) {
      currentRow.classList.remove("is-playing");
      const card = currentRow.closest(".top-songs-card");
      if (card) card.classList.remove("has-playing");
      const badge = currentRow.querySelector(".song-plays");
      if (badge && badge.dataset.originalLabel) {
        badge.textContent = badge.dataset.originalLabel;
      }
      const fill = currentRow.querySelector(".song-bar-fill");
      if (fill && fill.dataset.originalWidth) {
        fill.style.setProperty("--bar-width", fill.dataset.originalWidth);
      }
      currentRow = null;
    }
  }

  function toggleTrackPreview(rowEl, track) {
    if (currentRow === rowEl && currentAudio) {
      stopCurrentPlayback();
      return;
    }

    stopCurrentPlayback();
    rowEl.classList.add("is-playing");
    const card = rowEl.closest(".top-songs-card");
    if (card) card.classList.add("has-playing");
    currentRow = rowEl;

    const badge = rowEl.querySelector(".song-plays");
    const fill = rowEl.querySelector(".song-bar-fill");
    if (badge) badge.textContent = "Loading...";

    resolvePreviewUrl(track).then((previewUrl) => {
      if (currentRow !== rowEl) return;

      if (!previewUrl) {
        stopCurrentPlayback();
        window.open(track.url, "_blank", "noopener");
        return;
      }

      const audio = new Audio(previewUrl);
      audio.volume = 0.75;
      currentAudio = audio;

      audio.addEventListener("timeupdate", function () {
        if (currentRow !== rowEl || !audio.duration) return;
        const pct = Math.min(100, Math.max(5, (audio.currentTime / audio.duration) * 100));
        if (fill) fill.style.setProperty("--bar-width", `${pct}%`);
        const remaining = Math.max(0, Math.ceil(audio.duration - audio.currentTime));
        if (badge) badge.textContent = `0:${String(remaining).padStart(2, "0")}`;
      });

      audio.addEventListener("ended", function () {
        stopCurrentPlayback();
      });

      audio.addEventListener("error", function () {
        // If cached preview failed, try fresh Deezer JSONP once
        fetchDeezerJsonp(`${track.title} ${track.artist}`).then((fallbackUrl) => {
          if (fallbackUrl && fallbackUrl !== previewUrl && currentRow === rowEl) {
            track.preview_url = fallbackUrl;
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

  function renderTopSongs(data) {
    const listEl = document.getElementById("top-songs-list");
    const subtitleEl = document.getElementById("top-songs-subtitle");
    if (!listEl) return;

    const tracks = Array.isArray(data.tracks) ? data.tracks.slice(0, 5) : [];
    if (subtitleEl) {
      subtitleEl.textContent = "Updated often • Click a track for 30s preview";
    }

    const maxPlays = tracks.reduce((max, t) => Math.max(max, Number(t.plays) || 0), 0);

    listEl.innerHTML = tracks
      .map((track, idx) => {
        const rank = track.rank || idx + 1;
        const plays = Number(track.plays) || 0;
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
          <div class="song-row" role="button" tabindex="0" data-index="${idx}" data-rank="${rank}" style="animation-delay: ${delayMs}ms;" title="Click to play 30s preview">
            <div class="song-rank">#${rank}</div>
            <div class="song-sleeve-group">
              <div class="song-vinyl" aria-hidden="true">
                <div class="song-vinyl-label"></div>
              </div>
              <div class="song-cover-wrap">
                <img class="song-cover" src="${escapeHtml(track.cover)}" alt="${escapeHtml(track.title)}" loading="lazy" />
                <div class="song-cover-overlay">
                  <svg class="icon-play" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  <svg class="icon-pause" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                  </svg>
                </div>
              </div>
            </div>
            <div class="song-info">
              <div class="song-top-line">
                <div class="song-title-wrap">
                  <h6 class="song-title">${escapeHtml(track.title)}</h6>
                  <span class="retro-eq" aria-hidden="true">
                    <span class="eq-bar eq-1"></span>
                    <span class="eq-bar eq-2"></span>
                    <span class="eq-bar eq-3"></span>
                    <span class="eq-bar eq-4"></span>
                    <span class="eq-bar eq-5"></span>
                  </span>
                </div>
                <div class="song-meta-actions">
                  <span class="song-plays" data-original-label="${escapeHtml(playsLabel)}">${escapeHtml(playsLabel)}</span>
                  <a class="song-tidal-link" href="${escapeHtml(trackUrl)}" target="_blank" rel="noopener noreferrer" title="Open full track in TIDAL">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/>
                      <path fill-rule="evenodd" d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"/>
                    </svg>
                  </a>
                </div>
              </div>
              <div class="song-artist">${escapeHtml(track.artist)}${track.album ? ` • <span style="opacity:0.65">${escapeHtml(track.album)}</span>` : ""}</div>
              <div class="song-bar-track">
                <div class="song-bar-fill" data-original-width="${barPercent}%" style="--bar-width: ${barPercent}%;"></div>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    // Attach click & keyboard handlers for 30s audio preview
    const rows = listEl.querySelectorAll(".song-row");
    rows.forEach((row) => {
      const idx = Number(row.dataset.index);
      const track = tracks[idx];
      const tidalLink = row.querySelector(".song-tidal-link");
      if (tidalLink) {
        tidalLink.addEventListener("click", function (e) {
          e.stopPropagation();
        });
      }
      row.addEventListener("click", function () {
        toggleTrackPreview(row, track);
      });
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleTrackPreview(row, track);
        }
      });
    });
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
