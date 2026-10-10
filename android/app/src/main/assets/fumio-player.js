(function () {
  if (window.__fumioLivePlayer) return;
  window.__fumioLivePlayer = true;

  var TG_AUDIO = "hi";
  var SOURCES = [
    {
      id: "tgvid",
      name: "TG Vid · Ad-Free",
      movie: function (id) {
        return "https://tgvid.lovable.app/embed/movie/" + id + "?color=ffffff&back=true&lang=" + TG_AUDIO;
      },
      tv: function (id, season, episode) {
        return (
          "https://tgvid.lovable.app/embed/tv/" +
          id +
          "/" +
          season +
          "/" +
          episode +
          "?color=ffffff&back=true&lang=" +
          TG_AUDIO +
          "&episodeSelector=false&autoplayNextEp=false"
        );
      },
    },
    {
      id: "vidstuck",
      name: "VidStuck",
      movie: function (id) {
        return "https://vidstuck.xyz/embed/movie/" + id + "?branding=TheOGPirateBot&server=centaurus&overlay=true&color=ffffff&dubLang=hi&subtitle=english&loading=2";
      },
      tv: function (id, season, episode) {
        return "https://vidstuck.xyz/embed/tv/" + id + "/" + season + "/" + episode + "?branding=TheOGPirateBot&server=centaurus&overlay=true&color=ffffff&dubLang=hi&subtitle=english&loading=2";
      },
    },
    {
      id: "vidfast",
      name: "VidFast",
      movie: function (id) {
        return "https://vidfast.vc/movie/" + id + "?autoPlay=true";
      },
      tv: function (id, season, episode) {
        return "https://vidfast.vc/tv/" + id + "/" + season + "/" + episode + "?autoPlay=true";
      },
    },
    {
      id: "bingr",
      name: "Bingr",
      movie: function (id) {
        return "https://bingr.one/watch/movie/" + id;
      },
      tv: function (id, season, episode) {
        return "https://bingr.one/watch/tv/" + id + "/" + season + "/" + episode;
      },
    },
    {
      id: "roxy",
      name: "Roxy",
      movie: function (id) {
        return "https://zxcstream.xyz/player/movie/" + id + "?dubLang=en&server=0";
      },
      tv: function (id, season, episode) {
        return "https://zxcstream.xyz/player/tv/" + id + "/" + season + "/" + episode + "?dubLang=en&server=0";
      },
    },
    {
      id: "nxsha",
      name: "NXSHA",
      movie: function (id) {
        return "https://nxsha.space/embed/movie/" + id + "?lang=hi&disable_app_ad=true";
      },
      tv: function (id, season, episode) {
        return "https://nxsha.space/embed/tv/" + id + "/" + season + "/" + episode + "?lang=hi&disable_app_ad=true";
      },
    },
  ];

  var overlay = null;
  var frame = null;
  var current = null;
  var activeSource = "tgvid";

  function parseWatch(href) {
    if (!href) return null;
    var url;
    try {
      url = new URL(href, location.origin);
    } catch (e) {
      return null;
    }
    if (url.origin !== location.origin) return null;
    var path = url.pathname || "";
    var match = path.match(/^\/watch\/(movie|tv|anime)\/(\d+)(?:\/(\d+)(?:\/(\d+))?)?\/?$/i);
    if (!match) return null;
    var type = match[1].toLowerCase() === "movie" ? "movie" : "tv";
    var season = Number(url.searchParams.get("season") || match[3] || 1) || 1;
    var episode = Number(url.searchParams.get("episode") || match[4] || 1) || 1;
    return { type: type, id: match[2], season: season, episode: episode, title: document.title || "" };
  }

  function sourceUrl(source, info) {
    if (info.type === "movie") return source.movie(info.id);
    return source.tv(info.id, info.season, info.episode);
  }

  function saveHistory(info) {
    try {
      var list = JSON.parse(localStorage.getItem("continueWatching") || "[]");
      if (!Array.isArray(list)) list = [];
      var type = info.type;
      var id = Number(info.id);
      var og = document.querySelector('meta[property="og:image"]');
      var image = og && og.content ? og.content : "";
      var poster = "";
      var posterMatch = image.match(/\/t\/p\/\w+(\/.+)$/);
      if (posterMatch) poster = posterMatch[1];
      var next = {
        id: id,
        type: type,
        media_type: type,
        title: (info.title || "").replace(/\s+[|\-–].*$/, "").trim(),
        poster_path: poster || null,
        backdrop_path: poster || null,
        season: type === "tv" ? info.season : undefined,
        episode: type === "tv" ? info.episode : undefined,
        lastUpdated: Date.now(),
      };
      list = list.filter(function (item) {
        return !(item && Number(item.id) === id && (item.type || item.media_type) === type);
      });
      list.unshift(next);
      localStorage.setItem("continueWatching", JSON.stringify(list.slice(0, 10)));
      window.dispatchEvent(new CustomEvent("history-updated"));
    } catch (e) {
      /* private mode */
    }
  }

  function closePlayer() {
    if (!overlay) return false;
    overlay.remove();
    overlay = null;
    frame = null;
    current = null;
    try {
      if (window.FumioNative && window.FumioNative.unlockOrientation) window.FumioNative.unlockOrientation();
    } catch (e) {
      /* native lock is optional */
    }
    return true;
  }

  function setSource(id) {
    if (!current || !frame) return;
    activeSource = id;
    var source = SOURCES.filter(function (item) {
      return item.id === id;
    })[0] || SOURCES[0];
    frame.src = sourceUrl(source, current);
    var buttons = overlay.querySelectorAll("[data-fumio-source]");
    for (var i = 0; i < buttons.length; i += 1) {
      var on = buttons[i].getAttribute("data-fumio-source") === id;
      buttons[i].style.background = on ? "#fff" : "rgba(255,255,255,0.08)";
      buttons[i].style.color = on ? "#000" : "#fff";
    }
  }

  function openPlayer(info) {
    if (!info || !info.id) return;
    current = info;
    activeSource = "tgvid";
    saveHistory(info);
    try {
      if (window.FumioNative && window.FumioNative.lockLandscape) window.FumioNative.lockLandscape();
    } catch (e) {
      /* rotate guard still shows */
    }
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.setAttribute("id", "fumio-adfree-player");
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483646;background:#000;display:flex;flex-direction:column;";
      overlay.innerHTML =
        '<div style="position:relative;flex:1;min-height:0;background:#000;">' +
        '<iframe allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="no-referrer" style="position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;"></iframe>' +
        "</div>" +
        '<div style="display:flex;gap:8px;overflow:auto;padding:10px 12px 16px;background:#000;">' +
        SOURCES.map(function (source) {
          return (
            '<button type="button" data-fumio-source="' +
            source.id +
            '" style="flex:0 0 auto;height:36px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.15);font:700 11px/1 system-ui;letter-spacing:.02em;">' +
            source.name +
            "</button>"
          );
        }).join("") +
        "</div>" +
        '<button type="button" data-fumio-close="1" aria-label="Close player" style="position:absolute;top:12px;right:12px;z-index:2;width:40px;height:40px;border-radius:999px;border:0;background:rgba(0,0,0,.65);color:#fff;font:700 16px/1 system-ui;">✕</button>';
      document.documentElement.appendChild(overlay);
      frame = overlay.querySelector("iframe");
      overlay.addEventListener("click", function (event) {
        var close = event.target.closest("[data-fumio-close]");
        if (close) {
          closePlayer();
          return;
        }
        var button = event.target.closest("[data-fumio-source]");
        if (button) setSource(button.getAttribute("data-fumio-source"));
      });
    }
    setSource(activeSource);
  }

  window.__fumioClosePlayer = closePlayer;
  window.__fumioOpenFromUrl = function (href) {
    var parsed = parseWatch(href);
    if (!parsed) return false;
    openPlayer(parsed);
    return true;
  };

  function shouldCapture(url) {
    return Boolean(parseWatch(url));
  }

  var push = history.pushState;
  var replace = history.replaceState;
  history.pushState = function (state, title, url) {
    if (url && shouldCapture(url)) {
      openPlayer(parseWatch(url));
      return;
    }
    return push.apply(this, arguments);
  };
  history.replaceState = function (state, title, url) {
    if (url && shouldCapture(url)) {
      openPlayer(parseWatch(url));
      return;
    }
    return replace.apply(this, arguments);
  };

  document.addEventListener(
    "click",
    function (event) {
      var link = event.target.closest && event.target.closest("a[href]");
      if (!link) return;
      var parsed = parseWatch(link.href);
      if (!parsed) return;
      event.preventDefault();
      event.stopPropagation();
      openPlayer(parsed);
    },
    true,
  );

  if (parseWatch(location.href)) {
    var info = parseWatch(location.href);
    try {
      history.replaceState(history.state, "", "/");
    } catch (e) {
      /* stay */
    }
    openPlayer(info);
  }
})();
