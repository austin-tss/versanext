/* Ask VNXT. Gemini is called only by the Worker. Do not put an API key here. */
var ASK_VNXT_API = "https://vnxt-ask.tss-receivables.workers.dev";

(function () {
  var GREETING = "Hey, what can I help you with?";
  var DECLINE = "I can only help with questions about VersaNext. Ask me about our story, how a project works, what we build, or how to schedule a demo.";
  var UNAVAILABLE = "Ask VNXT is unavailable right now. You can reach us through Contact Us, or email austin@techsourcedsolutions.com.";
  var offTopic = /\b(weather|forecast|recipe|cook(?:ing)?|nba|nfl|mlb|nhl|super bowl|bitcoin|crypto|stock price|write (?:me )?code|python|javascript|homework|election|lyrics|movie review|sports score)\b/i;
  var onTopic = /\b(versa|vnxt|demo|security|tallahassee|kerry|process|package|story|austin|contact|support|pric(?:e|ing)|cost|hosting|account manager|tech sourced|virtual employee|software|business|backup|receipt|schedule)\b/i;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === "text") node.textContent = attrs[key];
        else if (key === "hidden") node.hidden = attrs[key];
        else node.setAttribute(key, attrs[key]);
      });
    }
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function linkify(node, text) {
    var rest = text;
    var re = /https?:\/\/[^\s<>]+/g;
    var match;
    var last = 0;
    while ((match = re.exec(text))) {
      if (match.index > last) node.appendChild(document.createTextNode(text.slice(last, match.index)));
      var href = match[0].replace(/[.,);]+$/, "");
      var a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = href;
      node.appendChild(a);
      last = match.index + match[0].length;
      if (match[0].length !== href.length) node.appendChild(document.createTextNode(match[0].slice(href.length)));
    }
    if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
    if (!node.childNodes.length) node.textContent = rest;
  }

  function init() {
    if (document.getElementById("ask-vnxt")) return;
    var history = [];
    var open = false;

    var log = el("div", { class: "ask-log", role: "log", "aria-live": "polite", "aria-relevant": "additions" });
    var input = el("textarea", { class: "ask-input", rows: "2", maxlength: "1000", placeholder: "Ask about VersaNext", "aria-label": "Your question" });
    var send = el("button", { class: "ask-send", type: "button", text: "Send" });
    var closeBtn = el("button", { class: "ask-close", type: "button", "aria-label": "Close Ask VNXT", text: "Close" });
    var title = el("strong", { id: "ask-vnxt-title", text: "Ask VNXT" });
    var panel = el("div", { id: "ask-vnxt-panel", class: "ask-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "ask-vnxt-title", hidden: true }, [
      el("div", { class: "ask-head" }, [title, closeBtn]),
      el("div", { class: "ask-accent", "aria-hidden": "true" }),
      log,
      el("form", { class: "ask-form" }, [
        input,
        send
      ]),
      el("p", { class: "ask-note", text: "Questions about VersaNext." })
    ]);
    var launcher = el("button", { class: "ask-launcher", type: "button", "aria-expanded": "false", "aria-controls": "ask-vnxt-panel" });
    launcher.appendChild(el("span", { class: "ask-launcher-mark", "aria-hidden": "true", text: "VNXT" }));
    launcher.appendChild(document.createTextNode("Ask VNXT"));
    var root = el("div", { id: "ask-vnxt", class: "ask-vnxt" }, [panel, launcher]);
    document.body.appendChild(root);

    function addBubble(role, text) {
      var bubble = el("div", { class: "ask-bubble ask-" + role });
      var speaker = el("span", { class: "ask-who", text: role === "user" ? "You" : "Ask VNXT" });
      var body = el("p", {});
      linkify(body, text);
      bubble.appendChild(speaker);
      bubble.appendChild(body);
      log.appendChild(bubble);
      log.scrollTop = log.scrollHeight;
    }

    addBubble("assistant", GREETING);

    function setOpen(next) {
      open = next;
      panel.hidden = !next;
      launcher.setAttribute("aria-expanded", next ? "true" : "false");
      if (next) input.focus();
      else launcher.focus();
    }

    function declineLocally(text) {
      addBubble("user", text);
      addBubble("assistant", DECLINE);
      history.push({ role: "user", content: text }, { role: "assistant", content: DECLINE });
    }

    function ask(text) {
      if (offTopic.test(text) && !onTopic.test(text)) {
        declineLocally(text);
        return;
      }
      addBubble("user", text);
      history.push({ role: "user", content: text });
      send.disabled = true;
      input.disabled = true;
      var pending = el("p", { class: "ask-pending", text: "One moment…" });
      log.appendChild(pending);
      log.scrollTop = log.scrollHeight;
      var payload = [{ role: "assistant", content: GREETING }].concat(history).slice(-10);
      fetch(ASK_VNXT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok || !data.reply) {
            var message = res.status === 429
              ? "Please wait a moment and try again."
              : (data.error || UNAVAILABLE);
            throw new Error(message);
          }
          return data.reply;
        });
      }).then(function (reply) {
        pending.remove();
        addBubble("assistant", reply);
        history.push({ role: "assistant", content: reply });
      }).catch(function (err) {
        pending.remove();
        var message = (err && err.name === "TypeError") || !(err && err.message) ? UNAVAILABLE : err.message;
        addBubble("assistant", message);
        history.push({ role: "assistant", content: message });
      }).then(function () {
        send.disabled = false;
        input.disabled = false;
        input.focus();
      });
    }

    function submit() {
      var text = input.value.trim();
      if (!text || send.disabled) return;
      input.value = "";
      ask(text);
    }

    launcher.addEventListener("click", function () { setOpen(!open); });
    closeBtn.addEventListener("click", function () { setOpen(false); });
    send.addEventListener("click", submit);
    panel.querySelector(".ask-form").addEventListener("submit", function (event) {
      event.preventDefault();
      submit();
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && open) setOpen(false);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
