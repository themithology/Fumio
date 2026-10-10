(function () {
  if (window.__fumioLivePlayer) return;
  window.__fumioLivePlayer = true;

  var native = window.FumioNative;
  if (!native || !native.openWatch) return;

  var style = document.createElement("style");
  style.textContent =
    'iframe[src*="vidsrc"],iframe[src*="videasy"],iframe[src*="vidfast"],iframe[src*="vidstuck"],iframe[src*="bingr"],iframe[src*="zxcstream"],iframe[src*="nxsha"],iframe[src*="2embed"],iframe[src*="multiembed"],iframe[src*="autoembed"],iframe[src*="smashy"],iframe[src*="vidlink"],iframe[src*="embed.su"],iframe[src*="tgvid"],iframe[src*="megaplay"],iframe[src*="zoko"],iframe[src*="4animo"]{display:none!important}';
  document.documentElement.appendChild(style);

  function parseWatch(href) {
    if (!href) return null;
    var url;
    try {
      url = new URL(href, location.origin);
    } catch (e) {
      return null;
    }
    var path = url.pathname || "";
    if (/^\/live-tv\b/i.test(path)) return null;
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

  function openWatch(info) {
    if (!info || !info.id) return false;
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
    if (url && openWatch(parseWatch(url))) return;
    return push.apply(this, arguments);
  };
  history.replaceState = function (state, title, url) {
    if (url && openWatch(parseWatch(url))) return;
    return replace.apply(this, arguments);
  };

  document.addEventListener(
    "click",
    function (event) {
      if (/^\/live-tv\b/i.test(location.pathname || "")) return;
      var link = event.target.closest && event.target.closest("a[href]");
      if (link && openWatch(parseWatch(link.href))) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      var btn = event.target.closest && event.target.closest("a,button,[role='button']");
      if (!btn) return;
      var label = ((btn.getAttribute("aria-label") || "") + " " + (btn.textContent || "")).toLowerCase();
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
})();
