(function () {
  if (window.__fumioLivePlayer) return;
  window.__fumioLivePlayer = true;

  var native = window.FumioNative;

  function killSmartlink() {
    try {
      document.documentElement.setAttribute("data-smartlink-off", "true");
    } catch (e) {
      /* ignore */
    }
    try {
      sessionStorage.setItem(
        "sl-hotspot-state-v1",
        JSON.stringify({
          total: 99,
          byKind: { cta: 9, text: 9, image: 9, back: 9, download: 9 },
          lastFireAt: Date.now(),
        }),
      );
    } catch (e) {
      /* private */
    }
    var rawOpen = window.open;
    window.open = function (url, name, features) {
      try {
        if (url == null || url === "" || url === "about:blank") return null;
        var parsed = new URL(String(url), location.href);
        var path = parsed.pathname || "";
        if (parsed.origin === location.origin && /^\/download\b/i.test(path)) return null;
        var host = (parsed.hostname || "").toLowerCase();
        if (
          host.indexOf("accounts.google") >= 0 ||
          host.indexOf("google.com") >= 0 ||
          host.indexOf("firebaseapp.com") >= 0 ||
          host.indexOf("discord.") >= 0
        ) {
          if (typeof rawOpen === "function") return rawOpen.call(window, url, name, features);
        }
      } catch (e) {
        /* drop */
      }
      return null;
    };
    function stripSmartlink() {
      var nodes = document.querySelectorAll("[data-smartlink]");
      for (var i = 0; i < nodes.length; i += 1) nodes[i].removeAttribute("data-smartlink");
    }
    stripSmartlink();
    try {
      new MutationObserver(stripSmartlink).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-smartlink"],
      });
    } catch (e) {
      /* observer optional */
    }
  }
  killSmartlink();

  if (!native || !native.openWatch) return;

  var style = document.createElement("style");
  style.textContent =
    'html:not([data-fumio-download]) iframe[src*="vidsrc"]:not([src*="vidsrc.party"]),iframe[src*="videasy"],iframe[src*="vidfast"],iframe[src*="vidstuck"],iframe[src*="bingr"],iframe[src*="zxcstream"],iframe[src*="2embed"],iframe[src*="multiembed"],iframe[src*="autoembed"],iframe[src*="smashy"],iframe[src*="vidlink"],iframe[src*="embed.su"],iframe[src*="tgvid.lovable"],iframe[src*="megaplay"],iframe[src*="zoko"],iframe[src*="4animo"]{display:none!important}' +
    'a[href*="watch-party"],a[href*="watchparty"],[data-nav="watch-party"],a[href*="/download"],a[href*="download?"]{display:none!important}';
  document.documentElement.appendChild(style);

  function isDownloadHref(href) {
    try {
      return /^\/download\b/i.test(new URL(href, location.origin).pathname || "");
    } catch (e) {
      return /download/i.test(String(href || ""));
    }
  }

  function hideAppOnlyChrome() {
    var nodes = document.querySelectorAll("a,button,span");
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var text = (node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      var href = node.getAttribute && node.getAttribute("href");
      var hide =
        text === "watch party" ||
        text === "download" ||
        /^download episode\b/.test(text) ||
        (href && isDownloadHref(href));
      if (!hide) continue;
      var el = node.closest("a,button,li") || node;
      el.style.display = "none";
    }
  }
  hideAppOnlyChrome();
  try {
    new MutationObserver(hideAppOnlyChrome).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {
    /* observer optional */
  }
  if (/^\/download\b/i.test(location.pathname || "")) {
    try {
      location.replace("/");
    } catch (e) {
      /* stay */
    }
  }

  function parseWatch(href) {
    if (!href) return null;
    var url;
    try {
      url = new URL(href, location.origin);
    } catch (e) {
      return null;
    }
    var path = url.pathname || "";
    if (/^\/live-tv\b/i.test(path) || /^\/download\b/i.test(path)) return null;
    if (/^\/player\/?$/i.test(path)) {
      var playerId = url.searchParams.get("id");
      if (!playerId) return null;
      var playerType = (url.searchParams.get("type") || "movie").toLowerCase();
      return {
        type: playerType === "movie" ? "movie" : "tv",
        id: String(playerId),
        season: String(Number(url.searchParams.get("season") || url.searchParams.get("s") || 1) || 1),
        episode: String(Number(url.searchParams.get("episode") || url.searchParams.get("e") || 1) || 1),
      };
    }
    var match = path.match(/\/watch\/(movie|tv|anime)\/(\d+)(?:\/(\d+)(?:\/(\d+))?)?/i);
    if (!match) match = path.match(/\/(movie|tv|anime)\/(?:details\/)?(\d+)\/watch(?:\/(\d+)(?:\/(\d+))?)?/i);
    if (!match) return null;
    var type = match[1].toLowerCase() === "movie" ? "movie" : "tv";
    var season = Number(url.searchParams.get("season") || url.searchParams.get("s") || match[3] || 1) || 1;
    var episode = Number(url.searchParams.get("episode") || url.searchParams.get("e") || match[4] || 1) || 1;
    return { type: type, id: String(match[2]), season: String(season), episode: String(episode) };
  }

  function parseDetails() {
    var path = location.pathname || "";
    if (/^\/live-tv\b/i.test(path)) return null;
    var match = path.match(/\/(movie|tv|anime)\/details\/(\d+)/i) || path.match(/\/details\/(movie|tv|anime)\/(\d+)/i);
    if (!match) return null;
    return {
      type: match[1].toLowerCase() === "movie" ? "movie" : "tv",
      id: String(match[2]),
      season: String(Number((location.search.match(/[?&]season=(\d+)/) || [])[1] || 1) || 1),
      episode: String(Number((location.search.match(/[?&]episode=(\d+)/) || [])[1] || 1) || 1),
    };
  }

  function episodeFrom(node) {
    var season = "1";
    var episode = "1";
    var el = node;
    while (el && el !== document) {
      var ds = el.getAttribute && (el.getAttribute("data-season") || el.getAttribute("data-s"));
      var de = el.getAttribute && (el.getAttribute("data-episode") || el.getAttribute("data-e"));
      if (ds) season = String(Number(ds) || 1);
      if (de) episode = String(Number(de) || 1);
      if (ds || de) break;
      el = el.parentElement;
    }
    return { season: season, episode: episode };
  }

  function pageMeta() {
    var title = "";
    var image = "";
    var ogTitle = document.querySelector('meta[property="og:title"]');
    var ogImage = document.querySelector('meta[property="og:image"]');
    if (ogTitle) title = ogTitle.getAttribute("content") || "";
    if (ogImage) image = ogImage.getAttribute("content") || "";
    if (!title) {
      var heading = document.querySelector("h1");
      if (heading) title = (heading.textContent || "").replace(/\s+/g, " ").trim();
    }
    if (!title) title = (document.title || "").replace(/\s*[|—\-].*$/, "").trim();
    var posterPath = null;
    var posterMatch = String(image).match(/\/t\/p\/\w+(\/[A-Za-z0-9]+\.(?:jpg|png|webp))/i);
    if (posterMatch) posterPath = posterMatch[1];
    return { title: title, poster_path: posterPath };
  }

  function saveContinue(info) {
    try {
      var list = [];
      try {
        list = JSON.parse(localStorage.getItem("continueWatching") || "[]");
      } catch (e) {
        list = [];
      }
      if (!Array.isArray(list)) list = [];
      var meta = pageMeta();
      var id = Number(info.id);
      var type = info.type === "movie" ? "movie" : "tv";
      var item = {
        id: id,
        type: type,
        media_type: type,
        title: meta.title || ("Title " + id),
        poster_path: meta.poster_path,
        backdrop_path: meta.poster_path,
        lastUpdated: Date.now(),
      };
      if (type !== "movie") {
        item.season = Number(info.season) || 1;
        item.episode = Number(info.episode) || 1;
      }
      list = list.filter(function (row) {
        return row && String(row.id) !== String(id);
      });
      list.unshift(item);
      localStorage.setItem("continueWatching", JSON.stringify(list.slice(0, 10)));
      window.dispatchEvent(new Event("history-updated"));
      window.dispatchEvent(new Event("history-progress"));
    } catch (e) {
      /* playback still opens */
    }
  }

  function openWatch(info) {
    if (!info || !info.id) return false;
    saveContinue(info);
    try {
      native.openWatch(info.type || "tv", info.id, info.season || "1", info.episode || "1");
      return true;
    } catch (e) {
      return false;
    }
  }

  function fromEmbed(src) {
    if (!src) return null;
    var url;
    try {
      url = new URL(src, location.origin);
    } catch (e) {
      return null;
    }
    var match = (url.pathname || "").match(/\/(movie|tv|anime)\/(\d+)(?:\/(\d+)(?:\/(\d+))?)?/i);
    if (!match) return null;
    return {
      type: match[1].toLowerCase() === "movie" ? "movie" : "tv",
      id: String(match[2]),
      season: String(Number(match[3] || 1) || 1),
      episode: String(Number(match[4] || 1) || 1),
    };
  }

  var push = history.pushState;
  var replace = history.replaceState;
  history.pushState = function (state, title, url) {
    if (url && isDownloadHref(url)) return;
    if (url && openWatch(parseWatch(url))) return;
    return push.apply(this, arguments);
  };
  history.replaceState = function (state, title, url) {
    if (url && isDownloadHref(url)) return;
    if (url && openWatch(parseWatch(url))) return;
    return replace.apply(this, arguments);
  };

  document.addEventListener(
    "click",
    function (event) {
      var btn = event.target.closest && event.target.closest("a,button,[role='button']");
      var label = btn
        ? ((btn.getAttribute("aria-label") || "") + " " + (btn.textContent || "")).toLowerCase()
        : "";
      if (btn && /google/.test(label) && native.signInWithGoogle) {
        event.preventDefault();
        event.stopPropagation();
        native.signInWithGoogle();
        return;
      }
      if (btn && /watch party/.test(label)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      var link = event.target.closest && event.target.closest("a[href]");
      var nested = event.target.closest && event.target.closest("button,[aria-label]");
      if (nested && link && nested !== link && /remove|close|clear|delete|dismiss/i.test((nested.getAttribute("aria-label") || "") + " " + (nested.textContent || ""))) {
        return;
      }
      if (nested && nested.tagName === "BUTTON" && link && nested !== link) return;
      if (link && isDownloadHref(link.href)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (btn && /\bdownload\b/.test(label) && !/email|mail|donate|support/i.test(label)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (link) {
        var href = "";
        try {
          href = new URL(link.href, location.origin).href;
        } catch (e) {
          href = link.href || "";
        }
        var scheme = href.split(":")[0].toLowerCase();
        if (scheme === "mailto" || scheme === "tel" || scheme === "sms" || scheme === "smsto") {
          event.preventDefault();
          event.stopPropagation();
          try {
            if (native.openBrowser) native.openBrowser(href);
          } catch (e) {
            /* ignore */
          }
          return;
        }
        var target = (link.getAttribute("target") || "").toLowerCase();
        if ((target === "_blank" || target === "_new") && native.openBrowser) {
          event.preventDefault();
          event.stopPropagation();
          try {
            native.openBrowser(href);
          } catch (e) {
            /* ignore */
          }
          return;
        }
      }
      if (/^\/live-tv\b/i.test(location.pathname || "")) return;
      if (link && openWatch(parseWatch(link.href))) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!btn) return;
      if (/\btrailer\b/.test(label)) return;
      if (!/\b(play|watch now|watch episode)\b/.test(label) && !/^\s*watch\s*$/.test(label)) return;
      var details = parseDetails();
      if (!details) return;
      var ep = episodeFrom(btn);
      details.season = ep.season;
      details.episode = ep.episode;
      event.preventDefault();
      event.stopPropagation();
      openWatch(details);
    },
    true,
  );

  function stealFrames() {
    if (/^\/download\b/i.test(location.pathname || "")) return;
    var frames = document.querySelectorAll("iframe[src]");
    for (var i = 0; i < frames.length; i += 1) {
      var info = fromEmbed(frames[i].src);
      if (!info) continue;
      frames[i].removeAttribute("src");
      frames[i].remove();
      openWatch(info);
      break;
    }
  }

  stealFrames();
  var observer = new MutationObserver(stealFrames);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });

  if (parseWatch(location.href)) openWatch(parseWatch(location.href));

  var API_KEY = "AIzaSyDapNgnKdO8l_t7BJPCO8IsbL73aILA1cI";

  function putAuthUser(user) {
    return new Promise(function (resolve) {
      try {
        localStorage.setItem("firebase:authUser:" + API_KEY + ":[DEFAULT]", JSON.stringify(user));
      } catch (e) {
        /* private */
      }
      try {
        var req = indexedDB.open("firebaseLocalStorageDb");
        req.onerror = function () {
          resolve(false);
        };
        req.onsuccess = function () {
          try {
            var db = req.result;
            if (!db.objectStoreNames.contains("firebaseLocalStorage")) {
              resolve(true);
              return;
            }
            var tx = db.transaction("firebaseLocalStorage", "readwrite");
            tx.objectStore("firebaseLocalStorage").put({
              fbase_key: "firebase:authUser:" + API_KEY + ":[DEFAULT]",
              value: user,
            });
            tx.oncomplete = function () {
              resolve(true);
            };
            tx.onerror = function () {
              resolve(true);
            };
          } catch (e) {
            resolve(true);
          }
        };
      } catch (e) {
        resolve(true);
      }
    });
  }

  window.__fumioApplyGoogleToken = function (idToken) {
    if (!idToken) return false;
    fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=" + API_KEY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        postBody: "id_token=" + encodeURIComponent(idToken) + "&providerId=google.com",
        requestUri: location.origin,
        returnIdpCredential: true,
        returnSecureToken: true,
      }),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.idToken || !data.localId) throw new Error((data && data.error && data.error.message) || "sign-in failed");
        var expires = (Number(data.expiresIn) || 3600) * 1000;
        var raw = {};
        try {
          raw = data.rawUserInfo ? JSON.parse(data.rawUserInfo) : {};
        } catch (e) {
          raw = {};
        }
        var user = {
          uid: data.localId,
          email: data.email || "",
          emailVerified: Boolean(data.emailVerified),
          displayName: data.displayName || "",
          photoURL: data.photoUrl || "",
          phoneNumber: null,
          isAnonymous: false,
          tenantId: null,
          providerData: [
            {
              uid: raw.sub || data.federatedId || data.localId,
              displayName: data.displayName || "",
              email: data.email || "",
              photoURL: data.photoUrl || "",
              providerId: "google.com",
            },
          ],
          apiKey: API_KEY,
          appName: "[DEFAULT]",
          authDomain: "ogpb-331d5.firebaseapp.com",
          stsTokenManager: {
            refreshToken: data.refreshToken,
            accessToken: data.idToken,
            expirationTime: Date.now() + expires,
          },
          createdAt: String(Date.now()),
          lastLoginAt: String(Date.now()),
        };
        return putAuthUser(user);
      })
      .then(function () {
        location.reload();
      })
      .catch(function () {
        /* overlay already closed; user can retry */
      });
    return true;
  };

  window.addEventListener("fumio-native-auth", function (event) {
    var token = event && event.detail && event.detail.idToken;
    if (token) window.__fumioApplyGoogleToken(token);
  });
})();
