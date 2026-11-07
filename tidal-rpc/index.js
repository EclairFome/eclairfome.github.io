(function(exports, jsxRuntime) {
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var APP_ID = "1054951789318909972";
    var PC_VENCORD_APP_ID = "1108588077900898414";
    var MOBILE_SOCKET_ID = "tidal-rpc@mobile";
    var TIDAL_LOGO_URL = "https://cdn.rcd.gg/PreMiD/websites/T/Tidal/assets/logo.png";
    var DEFAULT_COVER_HASH = "2a96cbd8b46e442fc41c2b86b821562f";
    var PAUSE_GRACE_MS = 25000; // 25 seconds
    var PC_HOLDOFF_MS = 12000; // 12 seconds holdoff after seeing PC active

    var defaultSettings = {
        username: "EclairFome",
        apiKey: "48257fff1da36374e5522726402608c7",
        appName: "{{artist}} - {{name}}",
        timeInterval: 5,
        showTimestamp: false,
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
        updateTimer: null,
        lastTrackKey: null,
        lastActivity: null,
        lastActiveTrack: null,
        lastActiveTime: 0,
        pcLastSeenAt: 0,
        lastError: null,
        lastUpdateAt: null
    };

    var storageRef = null;
    var liveSettings = Object.assign({}, defaultSettings);

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
        SessionsStore: ["getSessions"],
        PresenceStore: ["getActivities", "getClientStatus"],
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
            dispatcher.dispatch({
                type: "LOCAL_ACTIVITY_UPDATE",
                activity: activity,
                socketId: MOBILE_SOCKET_ID
            });
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
                var ids = await assetUtilsModule.fetchAssetIds(APP_ID, [url]);
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
                    var res = await httpModule.post({
                        url: endpoints[i],
                        body: { urls: [url] },
                        oldFormErrors: true,
                        rejectWithError: false
                    });
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

    function getCurrentUserId() {
        try {
            var authStore = getStore("AuthenticationStore");
            if (authStore && typeof authStore.getId === "function") {
                var id = authStore.getId();
                if (id) return id;
            }
            var userStore = getStore("UserStore");
            if (userStore && typeof userStore.getCurrentUser === "function") {
                var u = userStore.getCurrentUser();
                if (u && u.id) return u.id;
            }
        } catch (e) {}
        return null;
    }

    function isActivityFromPc(a) {
        if (!a) return false;
        var appId = a.application_id || a.applicationId;
        return appId === PC_VENCORD_APP_ID;
    }

    function isDesktopSession(s) {
        if (!s || s.status === "offline" || s.status === "unknown") return false;
        if (Array.isArray(s.activities) && s.activities.some(isActivityFromPc)) return true;
        var ci = s.clientInfo || s.client_info;
        if (ci && ci.client === "desktop") return true;
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
        } catch (e) {}
        return list;
    }

    function getSessionsSummary() {
        try {
            var SessionsStore = getStore("SessionsStore");
            if (!SessionsStore) return "SessionsStore not loaded yet";
            var list = getSessionsList();
            if (!list.length) return "No active sessions reported";
            return list.map(function(s) {
                var ci = s.clientInfo || s.client_info || {};
                var client = ci.client || ci.os || "unknown";
                var status = s.status || "?";
                var actCount = Array.isArray(s.activities) ? s.activities.length : 0;
                return client + " (" + status + (actCount ? (", " + actCount + " act") : "") + ")";
            }).join(", ");
        } catch (e) {
            return "Error reading sessions";
        }
    }

    function isPcVencordActive() {
        try {
            var SessionsStore = getStore("SessionsStore");
            if (SessionsStore) {
                if (typeof SessionsStore.getRemoteApplicationActivity === "function") {
                    if (SessionsStore.getRemoteApplicationActivity(PC_VENCORD_APP_ID)) {
                        state.pcLastSeenAt = Date.now();
                        return true;
                    }
                }
                if (typeof SessionsStore.getRemoteActivities === "function") {
                    var rActs = SessionsStore.getRemoteActivities();
                    if (Array.isArray(rActs) && rActs.some(isActivityFromPc)) {
                        state.pcLastSeenAt = Date.now();
                        return true;
                    }
                }
                var sessList = getSessionsList();
                for (var i = 0; i < sessList.length; i++) {
                    if (isDesktopSession(sessList[i])) {
                        state.pcLastSeenAt = Date.now();
                        return true;
                    }
                }
            }
            var myUid = getCurrentUserId();
            var PresenceStore = getStore("PresenceStore");
            var SelfPresenceStore = getStore("SelfPresenceStore");
            var acts = [];
            if (PresenceStore && typeof PresenceStore.getActivities === "function" && myUid) {
                var pActs = PresenceStore.getActivities(myUid);
                if (Array.isArray(pActs)) acts.push.apply(acts, pActs);
            }
            if (SelfPresenceStore && typeof SelfPresenceStore.getActivities === "function") {
                var sActs = SelfPresenceStore.getActivities();
                if (Array.isArray(sActs)) acts.push.apply(acts, sActs);
            }
            if (acts.some(isActivityFromPc)) {
                state.pcLastSeenAt = Date.now();
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    async function fetchLatestLastFmTrack(cfg) {
        if (!cfg.username || !cfg.apiKey) {
            throw new Error("Last.fm username or API key not set");
        }
        var qs = "method=user.getrecenttracks&user=" + encodeURIComponent(cfg.username) +
                 "&api_key=" + encodeURIComponent(cfg.apiKey) +
                 "&limit=1&extended=1&format=json&_=" + Date.now();
        var url = "https://ws.audioscrobbler.com/2.0/?" + qs;
        var res = await fetch(url, {
            headers: {
                "Cache-Control": "no-cache, no-store",
                "Pragma": "no-cache"
            }
        });
        if (!res.ok) throw new Error("Last.fm HTTP " + res.status);
        var json = await res.json();
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

        if (nowPlaying) {
            try {
                var infoQs = "method=track.getInfo&track=" + encodeURIComponent(trackName) +
                             "&artist=" + encodeURIComponent(artistName) +
                             "&autocorrect=1&api_key=" + encodeURIComponent(cfg.apiKey) +
                             "&format=json&_=" + Date.now();
                var infoRes = await fetch("https://ws.audioscrobbler.com/2.0/?" + infoQs);
                if (infoRes.ok) {
                    var infoJson = await infoRes.json();
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
                }
            } catch (e) {}
        }

        var imgArr = Array.isArray(track.image) ? track.image : [];
        var primaryImg = imgArr.find(function(x) { return x.size === "extralarge"; }) || imgArr.find(function(x) { return x.size === "large"; });
        var albumArt = cleanArt(primaryImg && primaryImg["#text"]) || trackInfoArt;

        // iTunes high-res cover fallback
        if (!albumArt && nowPlaying) {
            var cKey = (artistName + "\0" + trackName + "\0" + albumName).toLowerCase();
            if (fallbackArtCache.has(cKey)) {
                albumArt = fallbackArtCache.get(cKey);
            } else {
                try {
                    var term = encodeURIComponent(artistName + " " + trackName);
                    var itRes = await fetch("https://itunes.apple.com/search?term=" + term + "&entity=song&limit=5");
                    if (itRes.ok) {
                        var itJson = await itRes.json();
                        var aLow = artistName.toLowerCase();
                        var tLow = trackName.toLowerCase();
                        var results = Array.isArray(itJson?.results) ? itJson.results : [];
                        var aMatches = results.filter(function(r) {
                            var rA = (r.artistName || "").toLowerCase();
                            return rA && (rA.includes(aLow) || aLow.includes(rA));
                        });
                        var match = aMatches.find(function(r) { return (r.trackName || "").toLowerCase() === tLow; }) || aMatches[0];
                        var art = match?.artworkUrl100 ? match.artworkUrl100.replace("100x100bb", "512x512bb") : null;
                        if (art) albumArt = art;
                    }
                } catch (e) {}
                fallbackArtCache.set(cKey, albumArt || null);
            }
        }

        return {
            name: trackName,
            artist: artistName,
            album: albumName,
            albumArt: albumArt,
            url: track.url || (artistName + " - " + trackName),
            nowPlaying: nowPlaying,
            from: uts,
            to: endTimestamp,
            duration: durationSec
        };
    }

    async function updateActivity() {
        if (state.stopped || state.isUpdating) return;
        state.isUpdating = true;
        try {
            if (isPcVencordActive()) {
                if (state.lastActivity) {
                    console.log("[Tidal-RPC] PC Vencord is active; clearing mobile presence");
                    clearActivity();
                }
                return;
            }

            var cfg = getSettings();
            var track = await fetchLatestLastFmTrack(cfg);

            if (state.stopped) return;

            if (track && track.nowPlaying) {
                state.lastActiveTrack = track;
                state.lastActiveTime = Date.now();
            } else if (state.lastActiveTrack && (Date.now() - (state.lastActiveTime || 0)) < PAUSE_GRACE_MS) {
                track = Object.assign({}, state.lastActiveTrack, { nowPlaying: true });
            }

            if (!track || !track.nowPlaying) {
                state.lastActiveTrack = null;
                state.lastActiveTime = 0;
                if (state.lastActivity) clearActivity();
                return;
            }

            var trackKey = track.artist + "\0" + track.name + "\0" + (track.albumArt || "");
            if (state.lastTrackKey === trackKey && state.lastActivity) {
                state.lastUpdateAt = new Date().toLocaleTimeString();
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
                status_display_type: 1,
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

            if (!state.lastActivity) {
                await new Promise(function(r) { setTimeout(r, 3500); });
            }

            if (state.stopped) return;
            // Re-check PC Vencord after async asset resolution / initial grace so we never collide with Desktop!
            if (isPcVencordActive()) {
                clearActivity();
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

            var tSearch = function(q) { return "https://listen.tidal.com/search?q=" + encodeURIComponent(q); };
            activity.details_url = tSearch(track.artist + " " + track.name);
            if (track.artist) activity.state_url = tSearch(track.artist);
            if (track.album && (assets.large_image || assets.large_text)) {
                assets.large_url = tSearch(track.artist + " " + track.album);
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

    function onPresenceUpdateEvent(event) {
        if (state.stopped) return;
        try {
            var myUid = getCurrentUserId();

            var pcNowActive = false;
            var eventForMe = false;
            if (event) {
                if (Array.isArray(event.sessions)) {
                    eventForMe = true;
                    for (var sIdx = 0; sIdx < event.sessions.length; sIdx++) {
                        if (isDesktopSession(event.sessions[sIdx])) {
                            pcNowActive = true;
                            break;
                        }
                    }
                } else if (myUid && event.user && event.user.id === myUid && Array.isArray(event.activities)) {
                    eventForMe = true;
                    pcNowActive = event.activities.some(isActivityFromPc);
                } else if (myUid && Array.isArray(event.updates)) {
                    for (var i = 0; i < event.updates.length; i++) {
                        var u = event.updates[i];
                        if (u && u.user && u.user.id === myUid) {
                            eventForMe = true;
                            if (Array.isArray(u.activities) && u.activities.some(isActivityFromPc)) {
                                pcNowActive = true;
                            }
                        }
                    }
                }
            }

            if (pcNowActive) {
                state.pcLastSeenAt = Date.now();
            }

            if (pcNowActive || isPcVencordActive()) {
                if (state.lastActivity) {
                    console.log("[Tidal-RPC] Instant handoff: PC session/activity active -> clearing mobile presence");
                    clearActivity();
                }
            } else if (eventForMe && !state.lastActivity && (Date.now() - (state.pcLastSeenAt || 0)) > PC_HOLDOFF_MS) {
                console.log("[Tidal-RPC] Instant handoff: PC session stopped -> restoring mobile presence");
                updateActivity();
            }
        } catch (e) {}
    }

    function startPolling() {
        stopPolling();
        state.stopped = false;
        var dispatcher = getDispatcher();
        if (dispatcher && typeof dispatcher.subscribe === "function") {
            try {
                dispatcher.subscribe("SESSIONS_REPLACE", onPresenceUpdateEvent);
                dispatcher.subscribe("PRESENCE_UPDATES", onPresenceUpdateEvent);
                dispatcher.subscribe("PRESENCE_UPDATE", onPresenceUpdateEvent);
            } catch (e) {}
        }
        if (typeof valenced !== "undefined" && valenced?.discord?.flux?.onFluxEventDispatched) {
            try {
                var unsub0 = valenced.discord.flux.onFluxEventDispatched("SESSIONS_REPLACE", onPresenceUpdateEvent);
                var unsub1 = valenced.discord.flux.onFluxEventDispatched("PRESENCE_UPDATE", onPresenceUpdateEvent);
                var unsub2 = valenced.discord.flux.onFluxEventDispatched("PRESENCE_UPDATES", onPresenceUpdateEvent);
                state.fluxUnsubs = [unsub0, unsub1, unsub2];
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
                dispatcher.unsubscribe("SESSIONS_REPLACE", onPresenceUpdateEvent);
                dispatcher.unsubscribe("PRESENCE_UPDATES", onPresenceUpdateEvent);
                dispatcher.unsubscribe("PRESENCE_UPDATE", onPresenceUpdateEvent);
            } catch (e) {}
        }
        if (Array.isArray(state.fluxUnsubs)) {
            state.fluxUnsubs.forEach(function(u) { if (typeof u === "function") u(); });
            state.fluxUnsubs = null;
        }
        clearActivity();
    }

    async function testLastFmConnection(username, apiKey) {
        if (!username || !apiKey) return false;
        try {
            var res = await fetch("https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=" + encodeURIComponent(username) + "&api_key=" + encodeURIComponent(apiKey) + "&format=json&_=" + Date.now());
            var json = await res.json();
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
                            label: "Account",
                            subLabel: username ? ("Connected as: " + username) : "No username set"
                        }),
                        R.createElement(TableRow, {
                            label: "Mode",
                            subLabel: isPcVencordActive() ? "Yielding to PC (Desktop Session Active)" : "Active on Mobile (PC is Offline)"
                        }),
                        R.createElement(TableRow, {
                            label: "Active Sessions",
                            subLabel: getSessionsSummary()
                        }),
                        R.createElement(TableRow, {
                            label: "Latest Scrobble",
                            subLabel: currentTrackLabel + (state.lastUpdateAt ? (" (" + state.lastUpdateAt + ")") : "")
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
                            valenced.discord.flux.getStore("SessionsStore", function(s) { if (s) storeCache.SessionsStore = s; }),
                            valenced.discord.flux.getStore("PresenceStore", function(s) { if (s) storeCache.PresenceStore = s; }),
                            valenced.discord.flux.getStore("SelfPresenceStore", function(s) { if (s) storeCache.SelfPresenceStore = s; }),
                            valenced.discord.flux.getStore("UserStore", function(s) { if (s) storeCache.UserStore = s; }),
                            valenced.discord.flux.getStore("AuthenticationStore", function(s) { if (s) storeCache.AuthenticationStore = s; })
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
