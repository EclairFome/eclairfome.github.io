(function(exports, jsxRuntime) {
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var PLUGIN_VERSION = "1.8.0";
    var APP_ID = "1054951789318909972";
    var PC_VENCORD_APP_ID = "1108588077900898414";
    var MOBILE_SOCKET_ID = "Multi-Scrobbler@Vendetta";
    var MOBILE_PID = 2312;
    var TIDAL_LOGO_URL = "https://cdn.rcd.gg/PreMiD/websites/T/Tidal/assets/logo.png";
    var DEFAULT_COVER_HASH = "2a96cbd8b46e442fc41c2b86b821562f";
    var PAUSE_GRACE_MS = 1800000; // 30 minutes
    var PC_HOLDOFF_MS = 45000; // 45s holdoff after PC activity seen while desktop is online
    var PC_HEAD_START_MS = 15000; // 15s head start for PC to post activity when desktop is online

    var defaultSettings = {
        username: "EclairFome",
        apiKey: "48257fff1da36374e5522726402608c7",
        appName: "{{artist}} - {{name}}",
        timeInterval: 5,
        showTimestamp: true,
        listeningTo: true,
        showLargeText: true,
        showAlbumInTooltip: true,
        showDurationInTooltip: true,
        ignoreList: []
    };

    var assetCache = new Map();
    var fallbackArtCache = new Map();
    var httpModule = null;
    var assetUtilsModule = null;

    var state = {
        stopped: true,
        isUpdating: false,
        updateStartedAt: 0,
        updateTimer: null,
        lastTrackKey: null,
        lastActivity: null,
        lastActiveTrack: null,
        lastActiveTime: 0,
        pcActivityLastSeenAt: 0,
        scrobbleWithoutPcSince: 0,
        latestFluxSessions: null,
        lastError: null,
        lastUpdateAt: null
    };

    var storageRef = null;
    var liveSettings = Object.assign({}, defaultSettings);

    function withTimeout(promise, ms, fallbackValue) {
        var hasFallback = arguments.length >= 3;
        return new Promise(function(resolve, reject) {
            var timer = setTimeout(function() {
                if (hasFallback) {
                    resolve(fallbackValue);
                } else {
                    reject(new Error("Request timed out after " + ms + "ms"));
                }
            }, ms);
            Promise.resolve(promise).then(
                function(val) {
                    clearTimeout(timer);
                    resolve(val);
                },
                function(err) {
                    clearTimeout(timer);
                    if (hasFallback) {
                        resolve(fallbackValue);
                    } else {
                        reject(err);
                    }
                }
            );
        });
    }

    function getSettings() {
        var cached = (storageRef && storageRef.cache) || {};
        return Object.assign({}, defaultSettings, liveSettings, cached);
    }

    function getDispatcher() {
        try {
            if (typeof valenced !== "undefined" && valenced?.discord?.common?.flux?.Dispatcher) {
                return valenced.discord.common.flux.Dispatcher;
            }
            if (typeof vendetta !== "undefined" && vendetta?.metro?.common?.FluxDispatcher) {
                return vendetta.metro.common.FluxDispatcher;
            }
        } catch (e) {}
        return null;
    }

    var storeCache = {};
    var storePropHints = {
        SessionsStore: ["getSessions", "getRemoteActivities"],
        SelfPresenceStore: ["getLocalPresence", "getActivities"],
        AuthenticationStore: ["getId", "getToken"],
        UserStore: ["getCurrentUser", "getUser"]
    };

    function getStore(name) {
        if (storeCache[name]) return storeCache[name];
        try {
            if (typeof valenced !== "undefined" && valenced?.discord?.flux?.Stores?.[name]) {
                storeCache[name] = valenced.discord.flux.Stores[name];
                return storeCache[name];
            }
            if (typeof vendetta !== "undefined" && vendetta?.metro?.findByStoreName) {
                var s = vendetta.metro.findByStoreName(name);
                if (s) {
                    storeCache[name] = s;
                    return s;
                }
            }
            if (typeof valenced !== "undefined" && valenced?.modules?.finders?.lookupModule) {
                if (valenced?.discord?.flux?.withStoreName) {
                    var byStoreName = valenced.modules.finders.lookupModule(valenced.discord.flux.withStoreName(name));
                    if (byStoreName && byStoreName[0]) {
                        storeCache[name] = byStoreName[0];
                        return byStoreName[0];
                    }
                }
                var f = valenced.modules.finders.filters;
                var hints = storePropHints[name];
                if (hints && f && f.withProps) {
                    var byProps = valenced.modules.finders.lookupModule(f.withProps.apply(f, hints));
                    if (byProps && byProps[0]) {
                        storeCache[name] = byProps[0];
                        return byProps[0];
                    }
                }
                if (f && f.withName) {
                    var found = valenced.modules.finders.lookupModule(f.withName(name));
                    if (found && found[0]) {
                        storeCache[name] = found[0];
                        return found[0];
                    }
                }
            }
        } catch (e) {}
        return null;
    }

    function resolveDiscordModules() {
        try {
            if (!httpModule && typeof valenced !== "undefined" && valenced?.modules?.finders?.lookupModule) {
                var f = valenced.modules.finders.filters;
                var m1 = valenced.modules.finders.lookupModule(f.withProps("HTTP", "post"));
                if (m1 && m1[0] && m1[0].HTTP) httpModule = m1[0].HTTP;
                if (!httpModule) {
                    var m2 = valenced.modules.finders.lookupModule(f.withProps("getAPIBaseURL", "post"));
                    if (m2 && m2[0]) httpModule = m2[0];
                }
            }
            if (!httpModule && typeof vendetta !== "undefined" && vendetta?.metro?.findByProps) {
                httpModule = vendetta.metro.findByProps("getAPIBaseURL", "get");
            }
        } catch (e) {}

        try {
            if (!assetUtilsModule && typeof valenced !== "undefined" && valenced?.modules?.finders?.lookupModule) {
                var f2 = valenced.modules.finders.filters;
                var a1 = valenced.modules.finders.lookupModule(f2.withProps("fetchAssetIds"));
                if (a1 && a1[0]) assetUtilsModule = a1[0];
                if (!assetUtilsModule) {
                    var a2 = valenced.modules.finders.lookupModule(f2.withProps("getAssetIds"));
                    if (a2 && a2[0]) assetUtilsModule = a2[0];
                }
            }
            if (!assetUtilsModule && typeof vendetta !== "undefined" && vendetta?.metro?.findByProps) {
                assetUtilsModule = vendetta.metro.findByProps("getAssetIds") || vendetta.metro.findByProps("fetchAssetIds");
            }
        } catch (e) {}
    }

    function dispatchActivity(activity) {
        if (state.stopped) activity = null;
        state.lastActivity = activity;
        if (!activity) state.lastTrackKey = null;
        var dispatcher = getDispatcher();
        if (dispatcher && typeof dispatcher.dispatch === "function") {
            var payload = {
                type: "LOCAL_ACTIVITY_UPDATE",
                activity: activity,
                pid: MOBILE_PID,
                socketId: MOBILE_SOCKET_ID
            };
            if (typeof dispatcher.isDispatching === "function" && dispatcher.isDispatching()) {
                setTimeout(function() {
                    try { dispatcher.dispatch(payload); } catch (e) {}
                }, 0);
            } else {
                try { dispatcher.dispatch(payload); } catch (e) {}
            }
        }
    }

    function clearActivity() {
        state.lastTrackKey = null;
        state.lastActivity = null;
        dispatchActivity(null);
    }

    async function resolveExternalAsset(url) {
        if (!url || (!url.startsWith("http:") && !url.startsWith("https:"))) return null;
        if (assetCache.has(url)) return assetCache.get(url);

        resolveDiscordModules();

        // 1. Try assetUtilsModule.fetchAssetIds
        if (assetUtilsModule && typeof assetUtilsModule.fetchAssetIds === "function") {
            try {
                var ids = await withTimeout(assetUtilsModule.fetchAssetIds(APP_ID, [url]), 5000, null);
                if (Array.isArray(ids) && ids[0]) {
                    assetCache.set(url, ids[0]);
                    return ids[0];
                }
            } catch (e) {}
        }

        // 2. Try Discord HTTP module POST to /applications/{APP_ID}/external-assets
        if (httpModule && typeof httpModule.post === "function") {
            var endpoints = ["/applications/" + APP_ID + "/external-assets"];
            try {
                var base = typeof httpModule.getAPIBaseURL === "function" ? httpModule.getAPIBaseURL() : "";
                if (base) endpoints.push(base + "/applications/" + APP_ID + "/external-assets");
            } catch (e) {}

            for (var i = 0; i < endpoints.length; i++) {
                try {
                    var res = await withTimeout(httpModule.post({
                        url: endpoints[i],
                        body: { urls: [url] },
                        oldFormErrors: true,
                        rejectWithError: false
                    }), 5000, null);
                    var body = res && res.body;
                    if (Array.isArray(body) && body[0] && body[0].external_asset_path) {
                        var mp = "mp:" + body[0].external_asset_path;
                        assetCache.set(url, mp);
                        return mp;
                    }
                } catch (e) {}
            }
        }

        return null;
    }

    function formatDuration(sec) {
        if (!sec || sec < 0) return "0:00";
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = Math.floor(sec % 60);
        if (h > 0) {
            return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
        }
        return m + ":" + String(s).padStart(2, "0");
    }

    function isActivityFromPc(a) {
        if (!a) return false;
        var appId = a.application_id || a.applicationId;
        return appId === PC_VENCORD_APP_ID;
    }

    function isSessionShowingPcActivity(s) {
        if (!s || s.status === "offline" || s.status === "unknown") return false;
        var acts = [];
        if (Array.isArray(s.activities)) acts = acts.concat(s.activities);
        if (Array.isArray(s.hiddenActivities)) acts = acts.concat(s.hiddenActivities);
        if (acts.length === 0) return false;
        if (acts.some(isActivityFromPc)) return true;
        var ci = s.clientInfo || s.client_info;
        if (ci && ci.client === "desktop") {
            return acts.some(function(a) {
                var appId = a && (a.application_id || a.applicationId);
                return a && a.type === 2 && appId !== APP_ID;
            });
        }
        return false;
    }

    function hasDesktopSession() {
        var sessList = getSessionsList();
        for (var i = 0; i < sessList.length; i++) {
            var s = sessList[i];
            if (!s || s.status === "offline" || s.status === "unknown") continue;
            var ci = s.clientInfo || s.client_info;
            if (ci && ci.client === "desktop") return true;
        }
        return false;
    }

    function getSessionsList() {
        var list = [];
        try {
            var SessionsStore = getStore("SessionsStore");
            if (SessionsStore && typeof SessionsStore.getSessions === "function") {
                var sessions = SessionsStore.getSessions();
                if (sessions) {
                    if (typeof sessions.values === "function") {
                        sessions = Array.from(sessions.values());
                    } else if (!Array.isArray(sessions) && typeof sessions === "object") {
                        sessions = Object.values(sessions);
                    }
                    if (Array.isArray(sessions)) {
                        for (var i = 0; i < sessions.length; i++) {
                            if (sessions[i]) list.push(sessions[i]);
                        }
                    }
                }
            }
            if (list.length === 0 && Array.isArray(state.latestFluxSessions)) {
                return state.latestFluxSessions;
            }
        } catch (e) {}
        return list;
    }

    function getSessionsSummary() {
        try {
            var SessionsStore = getStore("SessionsStore");
            var list = getSessionsList();
            if (!SessionsStore && !list.length) return "SessionsStore not loaded yet";
            if (!list.length) return "Only local mobile session";
            return list.map(function(s) {
                var ci = s.clientInfo || s.client_info || {};
                var client = ci.client || ci.os || "unknown";
                var status = s.status || "?";
                var acts = Array.isArray(s.activities) ? s.activities : [];
                var types = acts.map(function(a) {
                    if (!a) return "?";
                    if (isActivityFromPc(a)) return "PC-RPC";
                    if ((a.application_id || a.applicationId) === APP_ID) return "Mob-RPC";
                    return String(a.type);
                }).join("+");
                return client + " (" + status + ", " + acts.length + " act" + (types ? " [" + types + "]" : "") + ")";
            }).join(", ");
        } catch (e) {
            return "Error reading sessions";
        }
    }

    function isPcActivityShowing() {
        try {
            var SessionsStore = getStore("SessionsStore");
            if (SessionsStore) {
                if (typeof SessionsStore.getRemoteApplicationActivity === "function") {
                    if (SessionsStore.getRemoteApplicationActivity(PC_VENCORD_APP_ID)) {
                        state.pcActivityLastSeenAt = Date.now();
                        return true;
                    }
                }
                if (typeof SessionsStore.getRemoteActivities === "function") {
                    var rActs = SessionsStore.getRemoteActivities();
                    if (Array.isArray(rActs) && rActs.some(isActivityFromPc)) {
                        state.pcActivityLastSeenAt = Date.now();
                        return true;
                    }
                }
            }
            var sessList = getSessionsList();
            for (var i = 0; i < sessList.length; i++) {
                if (isSessionShowingPcActivity(sessList[i])) {
                    state.pcActivityLastSeenAt = Date.now();
                    return true;
                }
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    function shouldYieldToPc(isScrobbling) {
        if (isPcActivityShowing()) {
            state.pcActivityLastSeenAt = Date.now();
            state.scrobbleWithoutPcSince = 0;
            return true;
        }

        if (!hasDesktopSession()) {
            state.pcActivityLastSeenAt = 0;
            state.scrobbleWithoutPcSince = 0;
            return false;
        }

        // Desktop session is online in SessionsStore:
        // 1. If PC was showing music activity within the last 45s, keep yielding (prevents contesting on track changes)
        if (state.pcActivityLastSeenAt > 0 && (Date.now() - state.pcActivityLastSeenAt) < PC_HOLDOFF_MS) {
            return true;
        }

        // 2. If nothing is currently scrobbling on Last.fm, yield to PC since Desktop is online
        if (!isScrobbling) {
            state.scrobbleWithoutPcSince = 0;
            return true;
        }

        // 3. Music is scrobbling on Last.fm while Desktop is online, but PC hasn't posted activity yet:
        // Give PC a 15s head start to poll Last.fm, fetch cover art, and broadcast before Mobile steps in.
        if (!state.scrobbleWithoutPcSince) {
            state.scrobbleWithoutPcSince = Date.now();
        }
        if ((Date.now() - state.scrobbleWithoutPcSince) < PC_HEAD_START_MS) {
            return true;
        }

        return false;
    }

    function getModeLabel() {
        if (isPcActivityShowing()) {
            return "Yielding to PC (PC Activity Showing)";
        }
        if (hasDesktopSession()) {
            var isScrobbling = !!(state.lastActiveTrack && (Date.now() - (state.lastActiveTime || 0)) < PAUSE_GRACE_MS);
            if (shouldYieldToPc(isScrobbling)) {
                return "Yielding to PC (Desktop is Online)";
            }
            return "Active on Mobile (Stepped In — No PC Activity)";
        }
        return "Active on Mobile (PC is Offline)";
    }

    async function fetchJsonWithTimeout(url, options, timeoutMs) {
        var res = await withTimeout(fetch(url, options || {}), timeoutMs || 6000);
        if (!res || !res.ok) {
            throw new Error("HTTP " + (res ? res.status : "timeout"));
        }
        return await withTimeout(res.json(), timeoutMs || 6000);
    }

    async function fetchLatestLastFmTrack(cfg, skipExtras) {
        if (!cfg.username || !cfg.apiKey) {
            throw new Error("Last.fm username or API key not set");
        }
        var qs = "method=user.getrecenttracks&user=" + encodeURIComponent(cfg.username) +
                 "&api_key=" + encodeURIComponent(cfg.apiKey) +
                 "&limit=1&extended=1&format=json&_=" + Date.now();
        var url = "https://ws.audioscrobbler.com/2.0/?" + qs;
        var json = await fetchJsonWithTimeout(url, {
            headers: {
                "Cache-Control": "no-cache, no-store",
                "Pragma": "no-cache"
            }
        }, 6000);
        if (json.error) throw new Error(json.message || ("Last.fm Error " + json.error));

        var track = json?.recenttracks?.track?.[0];
        if (!track) return null;

        var rawNowPlaying = !!(track["@attr"] && track["@attr"].nowplaying);
        var uts = track.date && track.date.uts ? parseInt(track.date.uts, 10) : Math.floor(Date.now() / 1000);
        var isRecentScrobble = (track.date && track.date.uts) ? ((Date.now() - (uts * 1000)) < PAUSE_GRACE_MS) : false;
        var nowPlaying = rawNowPlaying || isRecentScrobble;

        var extractText = function(obj, fallbackKey) {
            if (!obj) return "";
            if (typeof obj === "string") return obj;
            return obj["#text"] || obj[fallbackKey || "name"] || "";
        };

        var trackName = track.name || "Unknown Track";
        var artistName = extractText(track.artist, "name") || "Unknown Artist";
        var albumName = extractText(track.album, "title") || "";

        var cleanArt = function(artUrl) {
            if (!artUrl || typeof artUrl !== "string") return null;
            if (artUrl.includes(DEFAULT_COVER_HASH)) return null;
            return artUrl;
        };

        var durationSec = null;
        var endTimestamp = null;
        var trackInfoArt = null;

        if (nowPlaying && !skipExtras) {
            try {
                var infoQs = "method=track.getInfo&track=" + encodeURIComponent(trackName) +
                             "&artist=" + encodeURIComponent(artistName) +
                             "&autocorrect=1&api_key=" + encodeURIComponent(cfg.apiKey) +
                             "&format=json&_=" + Date.now();
                var infoJson = await fetchJsonWithTimeout("https://ws.audioscrobbler.com/2.0/?" + infoQs, {}, 4000);
                var durMs = infoJson?.track?.duration ? parseInt(infoJson.track.duration, 10) : 0;
                if (durMs > 0) {
                    durationSec = Math.floor(durMs / 1000);
                    endTimestamp = uts + durationSec;
                }
                var tImgs = infoJson?.track?.album?.image;
                if (Array.isArray(tImgs)) {
                    var lg = tImgs.find(function(x) { return x.size === "extralarge"; }) || tImgs.find(function(x) { return x.size === "large"; });
                    if (lg) trackInfoArt = cleanArt(lg["#text"]);
                }
            } catch (e) {}
        }

        var imgArr = Array.isArray(track.image) ? track.image : [];
        var primaryImg = imgArr.find(function(x) { return x.size === "extralarge"; }) || imgArr.find(function(x) { return x.size === "large"; });
        var albumArt = cleanArt(primaryImg && primaryImg["#text"]) || trackInfoArt;

        // iTunes high-res cover & duration fallback (when Last.fm is missing cover art OR duration)
        if ((!albumArt || !durationSec) && nowPlaying && !skipExtras) {
            var cKey = (artistName + "\0" + trackName + "\0" + albumName).toLowerCase();
            var cachedItunes = fallbackArtCache.get(cKey);
            if (! cachedItunes) {
                cachedItunes = { art: null, durationSec: null };
                try {
                    var term = encodeURIComponent(artistName + " " + trackName);
                    var itJson = await fetchJsonWithTimeout("https://itunes.apple.com/search?term=" + term + "&entity=song&limit=5", {}, 4000);
                    var aLow = artistName.toLowerCase();
                    var tLow = trackName.toLowerCase();
                    var results = Array.isArray(itJson?.results) ? itJson.results : [];
                    var aMatches = results.filter(function(r) {
                        var rA = (r.artistName || "").toLowerCase();
                        return rA && (rA.includes(aLow) || aLow.includes(rA));
                    });
                    var match = aMatches.find(function(r) { return (r.trackName || "").toLowerCase() === tLow; })
                        || aMatches[0]
                        || results.find(function(r) { return (r.trackName || "").toLowerCase() === tLow; });
                    if (match?.artworkUrl100) {
                        cachedItunes.art = match.artworkUrl100.replace("100x100bb", "512x512bb");
                    }
                    if (match?.trackTimeMillis > 0) {
                        cachedItunes.durationSec = Math.floor(match.trackTimeMillis / 1000);
                    }
                } catch (e) {}
                fallbackArtCache.set(cKey, cachedItunes);
            }
            if (!albumArt && cachedItunes.art) {
                albumArt = cachedItunes.art;
            }
            if (!durationSec && cachedItunes.durationSec > 0) {
                durationSec = cachedItunes.durationSec;
                endTimestamp = uts + durationSec;
            }
        }

        return {
            name: trackName,
            artist: artistName,
            album: albumName,
            albumArt: albumArt,
            url: track.url || (artistName + " - " + trackName),
            nowPlaying: nowPlaying,
            rawNowPlaying: rawNowPlaying,
            from: uts,
            to: endTimestamp,
            duration: durationSec
        };
    }

    async function updateActivity() {
        if (state.stopped) return;
        if (state.isUpdating && (Date.now() - (state.updateStartedAt || 0)) < 12000) return;
        state.isUpdating = true;
        state.updateStartedAt = Date.now();
        try {
            var pcAlreadyShowing = isPcActivityShowing();
            if (pcAlreadyShowing && state.lastActivity) {
                console.log("[Tidal-RPC] PC activity is showing; clearing mobile presence");
                clearActivity();
            }

            var cfg = getSettings();
            var track = await fetchLatestLastFmTrack(cfg, pcAlreadyShowing);

            if (state.stopped) return;

            // If a song was paused before scrobbling, prevent Last.fm's older completed scrobble from overwriting the paused song
            if (
                track &&
                !track.rawNowPlaying &&
                state.lastActiveTrack &&
                (track.name !== state.lastActiveTrack.name || track.artist !== state.lastActiveTrack.artist) &&
                track.from &&
                state.lastActiveTrack.from &&
                track.from < state.lastActiveTrack.from - 5
            ) {
                track = null;
            }

            if (track && track.nowPlaying) {
                var isSameSong = state.lastActiveTrack && state.lastActiveTrack.artist === track.artist && state.lastActiveTrack.name === track.name;
                if (isSameSong) {
                    if (!track.albumArt && state.lastActiveTrack.albumArt) track.albumArt = state.lastActiveTrack.albumArt;
                    if (!track.duration && state.lastActiveTrack.duration) {
                        track.duration = state.lastActiveTrack.duration;
                        track.to = state.lastActiveTrack.to;
                    }
                }
                if (!isSameSong || track.rawNowPlaying) {
                    state.lastActiveTime = Date.now();
                }
                state.lastActiveTrack = track;
            } else if (state.lastActiveTrack && (Date.now() - (state.lastActiveTime || 0)) < PAUSE_GRACE_MS) {
                track = Object.assign({}, state.lastActiveTrack, { nowPlaying: true });
            }

            state.lastUpdateAt = new Date().toLocaleTimeString();

            if (!track || !track.nowPlaying) {
                state.lastActiveTrack = null;
                state.lastActiveTime = 0;
                shouldYieldToPc(false);
                if (state.lastActivity) clearActivity();
                return;
            }

            if (shouldYieldToPc(true)) {
                if (state.lastActivity) {
                    console.log("[Tidal-RPC] Yielding to PC; clearing mobile presence");
                    clearActivity();
                }
                return;
            }

            var trackKey = track.artist + "\0" + track.name + "\0" + (track.album || "") + "\0" + (cfg.showTimestamp ? "ts1" : "ts0") + "\0" + (cfg.listeningTo !== false ? "l1" : "l0") + "\0" + (cfg.showLargeText !== false ? "lt1" : "lt0");
            if (state.lastTrackKey === trackKey && state.lastActivity) {
                return;
            }

            var appName = cfg.appName || "{{artist}} - {{name}}";
            if (appName.includes("{{")) {
                appName = appName
                    .replace(/\{\{artist\}\}/g, track.artist || "")
                    .replace(/\{\{name\}\}/g, track.name || "")
                    .replace(/\{\{album\}\}/g, track.album || "")
                    .replace(/\{\{service\}\}/g, "Last.fm");
            }

            var activity = {
                name: appName,
                flags: 0,
                type: cfg.listeningTo !== false ? 2 : 0,
                details: track.name,
                state: track.artist,
                application_id: APP_ID
            };

            if (cfg.showTimestamp && track.from) {
                var nowSec = Math.floor(Date.now() / 1000);
                var startSec = track.from;
                if (startSec < nowSec - 3600) startSec = nowSec;
                activity.timestamps = { start: startSec * 1000 };
                if (track.to) activity.timestamps.end = track.to * 1000;
            }

            var largeAsset = track.albumArt ? await resolveExternalAsset(track.albumArt) : null;
            var tidalAsset = await resolveExternalAsset(TIDAL_LOGO_URL);

            if (state.stopped) return;
            // Re-check if Mobile should yield to PC after async asset resolution
            if (shouldYieldToPc(true)) {
                if (state.lastActivity) clearActivity();
                return;
            }

            var largeText = "";
            if (cfg.showLargeText !== false) {
                if (cfg.showAlbumInTooltip !== false && track.album) {
                    largeText += track.album;
                }
                if (cfg.showDurationInTooltip !== false && track.duration) {
                    var dStr = formatDuration(track.duration);
                    largeText = largeText ? (largeText + " \u2022 " + dStr) : dStr;
                }
            }

            var assets = {};
            if (largeAsset) {
                assets.large_image = largeAsset;
                if (largeText) assets.large_text = largeText;
                if (tidalAsset) {
                    assets.small_image = tidalAsset;
                    assets.small_text = "TIDAL";
                }
            } else {
                if (tidalAsset) assets.large_image = tidalAsset;
                if (largeText) assets.large_text = largeText;
            }

            if (Object.keys(assets).length > 0) {
                activity.assets = assets;
            }

            dispatchActivity(activity);
            state.lastTrackKey = trackKey;
            state.lastError = null;
            state.lastUpdateAt = new Date().toLocaleTimeString();
        } catch (err) {
            state.lastError = err?.message || String(err);
            console.error("[Tidal-RPC] Update error:", err);
        } finally {
            state.isUpdating = false;
        }
    }

    function onSessionsChangedEvent(event) {
        if (state.stopped) return event;
        if (event && Array.isArray(event.sessions)) {
            state.latestFluxSessions = event.sessions;
        }
        setTimeout(function() {
            if (state.stopped) return;
            try {
                var pcNowActive = false;
                if (event && Array.isArray(event.sessions)) {
                    for (var sIdx = 0; sIdx < event.sessions.length; sIdx++) {
                        if (isSessionShowingPcActivity(event.sessions[sIdx])) {
                            pcNowActive = true;
                            state.pcActivityLastSeenAt = Date.now();
                            state.scrobbleWithoutPcSince = 0;
                            break;
                        }
                    }
                }
                if (!pcNowActive) {
                    pcNowActive = isPcActivityShowing();
                }

                var isScrobbling = !!(state.lastActiveTrack && (Date.now() - (state.lastActiveTime || 0)) < PAUSE_GRACE_MS);

                if (pcNowActive || shouldYieldToPc(isScrobbling)) {
                    if (state.lastActivity) {
                        console.log("[Tidal-RPC] Instant handoff: Yielding to PC -> clearing mobile presence");
                        clearActivity();
                    }
                } else {
                    if (!state.lastActivity) {
                        console.log("[Tidal-RPC] Instant handoff: Mobile active -> updating mobile presence");
                        updateActivity();
                    }
                }
            } catch (e) {}
        }, 0);
        return event;
    }

    function startPolling() {
        stopPolling();
        state.stopped = false;
        var dispatcher = getDispatcher();
        if (dispatcher && typeof dispatcher.subscribe === "function") {
            try {
                dispatcher.subscribe("SESSIONS_REPLACE", onSessionsChangedEvent);
                dispatcher.subscribe("CONNECTION_OPEN", onSessionsChangedEvent);
            } catch (e) {}
        }
        updateActivity();
        var cfg = getSettings();
        var intervalMs = Math.max((Number(cfg.timeInterval) || 5) * 1000, 3000);
        state.updateTimer = setInterval(updateActivity, intervalMs);
    }

    function stopPolling() {
        state.stopped = true;
        if (state.updateTimer) {
            clearInterval(state.updateTimer);
            state.updateTimer = null;
        }
        var dispatcher = getDispatcher();
        if (dispatcher && typeof dispatcher.unsubscribe === "function") {
            try {
                dispatcher.unsubscribe("SESSIONS_REPLACE", onSessionsChangedEvent);
                dispatcher.unsubscribe("CONNECTION_OPEN", onSessionsChangedEvent);
            } catch (e) {}
        }
        clearActivity();
    }

    async function testLastFmConnection(username, apiKey) {
        if (!username || !apiKey) return false;
        try {
            var json = await fetchJsonWithTimeout("https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=" + encodeURIComponent(username) + "&api_key=" + encodeURIComponent(apiKey) + "&format=json&_=" + Date.now(), {}, 5000);
            return !json.error;
        } catch (e) {
            return false;
        }
    }

    function SettingsComponent(props) {
        var R = (typeof valenced !== "undefined" && valenced?.react?.React)
            || (typeof vendetta !== "undefined" && vendetta?.metro?.common?.React)
            || (typeof window !== "undefined" && window.React);
        var RN = (typeof valenced !== "undefined" && valenced?.react?.ReactNative)
            || (typeof vendetta !== "undefined" && vendetta?.metro?.common?.ReactNative)
            || (typeof window !== "undefined" && window.ReactNative) || {};

        var js = (props && props.api && props.api.jsonStorage) || storageRef;
        var hooked = (js && typeof js.use === "function") ? js.use() : {};
        var current = Object.assign({}, defaultSettings, liveSettings, hooked);

        var userState = R.useState(current.username || "EclairFome");
        var username = userState[0], setUsername = userState[1];

        var keyState = R.useState(current.apiKey || "48257fff1da36374e5522726402608c7");
        var apiKey = keyState[0], setApiKey = keyState[1];

        var listenState = R.useState(current.listeningTo !== false);
        var listeningTo = listenState[0], setListeningTo = listenState[1];

        var timeState = R.useState(!!current.showTimestamp);
        var showTimestamp = timeState[0], setShowTimestamp = timeState[1];

        var textState = R.useState(current.showLargeText !== false);
        var showLargeText = textState[0], setShowLargeText = textState[1];

        var msgState = R.useState("");
        var statusMsg = msgState[0], setStatusMsg = msgState[1];

        var tickState = R.useState(0);
        var setTick = tickState[1];
        if (typeof R.useEffect === "function") {
            R.useEffect(function() {
                var iv = setInterval(function() {
                    setTick(function(n) { return n + 1; });
                }, 2000);
                return function() { clearInterval(iv); };
            }, []);
        }

        var updateSetting = function(key, val) {
            liveSettings[key] = val;
            if (js && typeof js.set === "function") {
                try { js.set({ [key]: val }); } catch (e) {}
            }
            state.lastTrackKey = null;
            if (!state.stopped) {
                updateActivity();
            }
        };

        var Design = (typeof valenced !== "undefined" && valenced?.discord?.design?.Design) || {};
        var Page = (typeof valenced !== "undefined" && valenced?.components?.Page) || function(e) { return e.children; };
        var ScrollView = RN.ScrollView || function(e) { return e.children; };
        var Stack = Design.Stack || function(e) { return e.children; };
        var TableRowGroup = Design.TableRowGroup || function(e) { return e.children; };
        var TableRow = Design.TableRow || function(e) { return e.children; };
        var TableSwitchRow = Design.TableSwitchRow;
        var TextInput = Design.TextInput;
        var Button = Design.Button;

        var currentTrackLabel = state.lastActiveTrack
            ? (state.lastActiveTrack.artist + " - " + state.lastActiveTrack.name)
            : "None detected yet";

        var broadcastedLabel = state.lastActivity
            ? (state.lastActivity.state + " - " + state.lastActivity.details)
            : "None (Cleared)";

        return R.createElement(ScrollView, { keyboardShouldPersistTaps: "handled" },
            R.createElement(Page, null,
                R.createElement(Stack, { spacing: 20 },
                    R.createElement(TableRowGroup, { title: "Last.fm Credentials" },
                        TextInput ? R.createElement(TextInput, {
                            label: "Last.fm Username",
                            placeholder: "e.g. EclairFome",
                            defaultValue: username,
                            onChange: function(val) {
                                setUsername(val);
                                updateSetting("username", val);
                            }
                        }) : null,
                        TextInput ? R.createElement(TextInput, {
                            label: "Last.fm API Key",
                            placeholder: "API Key",
                            defaultValue: apiKey,
                            onChange: function(val) {
                                setApiKey(val);
                                updateSetting("apiKey", val);
                            }
                        }) : null
                    ),
                    R.createElement(TableRowGroup, { title: "Display Options" },
                        TableSwitchRow ? R.createElement(TableSwitchRow, {
                            label: "Display as Listening to",
                            subLabel: "Show 'Listening to Artist - Song' on your profile",
                            value: listeningTo,
                            onValueChange: function(val) {
                                setListeningTo(val);
                                updateSetting("listeningTo", val);
                            }
                        }) : null,
                        TableSwitchRow ? R.createElement(TableSwitchRow, {
                            label: "Show Song Progress / Elapsed",
                            subLabel: "Show time elapsed in status",
                            value: showTimestamp,
                            onValueChange: function(val) {
                                setShowTimestamp(val);
                                updateSetting("showTimestamp", val);
                            }
                        }) : null,
                        TableSwitchRow ? R.createElement(TableSwitchRow, {
                            label: "Show Album & Duration Text",
                            subLabel: "Display album name and track length on activity",
                            value: showLargeText,
                            onValueChange: function(val) {
                                setShowLargeText(val);
                                updateSetting("showLargeText", val);
                            }
                        }) : null
                    ),
                    R.createElement(TableRowGroup, { title: "Status & Diagnostics" },
                        R.createElement(TableRow, {
                            label: "Account & Version",
                            subLabel: (username ? ("Connected as: " + username) : "No username set") + " (v" + PLUGIN_VERSION + ")"
                        }),
                        R.createElement(TableRow, {
                            label: "Mode",
                            subLabel: getModeLabel()
                        }),
                        R.createElement(TableRow, {
                            label: "Active Sessions",
                            subLabel: getSessionsSummary()
                        }),
                        R.createElement(TableRow, {
                            label: "Latest Scrobble",
                            subLabel: currentTrackLabel + (state.lastUpdateAt ? (" (" + state.lastUpdateAt + ")") : "")
                        }),
                        R.createElement(TableRow, {
                            label: "Broadcasted RPC",
                            subLabel: broadcastedLabel
                        }),
                        state.lastError ? R.createElement(TableRow, {
                            label: "Last Error",
                            subLabel: String(state.lastError)
                        }) : null,
                        statusMsg ? R.createElement(TableRow, {
                            label: "Diagnostic",
                            subLabel: statusMsg
                        }) : null,
                        Button ? R.createElement(Button, {
                            text: "Test Last.fm & Refresh Now",
                            variant: "primary",
                            onPress: async function() {
                                setStatusMsg("Testing Last.fm & refreshing presence...");
                                var ok = await testLastFmConnection(username, apiKey);
                                if (ok) {
                                    state.lastTrackKey = null;
                                    state.isUpdating = false;
                                    await updateActivity();
                                    setStatusMsg("✅ Connected & refreshed! Track: " + (state.lastActiveTrack ? (state.lastActiveTrack.artist + " - " + state.lastActiveTrack.name) : "No active track"));
                                } else {
                                    setStatusMsg("❌ Failed to connect. Check username/API key.");
                                }
                            }
                        }) : null
                    )
                )
            )
        );
    }

    var pluginObj;
    if (typeof plugin === "function") {
        // Pure Valenced plugin registration — do NOT mutate the returned object!
        pluginObj = plugin({
            jsonStorage: {
                load: true,
                default: defaultSettings
            },
            start: function(ctx) {
                try {
                    if (ctx && ctx.jsonStorage) {
                        storageRef = ctx.jsonStorage;
                        if (ctx.jsonStorage.cache) {
                            Object.assign(liveSettings, ctx.jsonStorage.cache);
                        }
                    }
                    if (typeof valenced !== "undefined" && valenced?.discord?.flux?.getStore && ctx?.cleanup) {
                        ctx.cleanup(
                            valenced.discord.flux.getStore("SessionsStore", function(s) { if (s) storeCache.SessionsStore = s; })
                        );
                    }
                    // Pre-register Discord modules via Valenced getModules if available
                    if (typeof valenced !== "undefined" && valenced?.modules?.finders?.getModules && ctx?.cleanup) {
                        var f = valenced.modules.finders.filters;
                        ctx.cleanup(
                            valenced.modules.finders.getModules(f.withProps("HTTP", "post"), function(m) {
                                if (m && m.HTTP) httpModule = m.HTTP;
                            }),
                            valenced.modules.finders.getModules(f.withProps("fetchAssetIds"), function(m) {
                                if (m) assetUtilsModule = m;
                            })
                        );
                    }
                    startPolling();
                    if (ctx && typeof ctx.cleanup === "function") {
                        ctx.cleanup(function() {
                            stopPolling();
                        });
                    }
                } catch (e) {
                    console.error("[Tidal-RPC] Error in start:", e);
                }
            },
            stop: function() {
                stopPolling();
            },
            SettingsComponent: SettingsComponent
        });
    } else {
        // Fallback for Kettu / Vendetta
        pluginObj = {
            onLoad: function() { startPolling(); },
            onUnload: function() { stopPolling(); },
            settings: SettingsComponent
        };
    }

    exports.default = pluginObj;
    return exports;
})({}, typeof valenced !== "undefined" ? valenced.react.ReactJSXRuntime : undefined);
