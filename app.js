/* ------------------------------------------------------------------
   USRC-CPS Copy Tool
   Reads templates.json and builds one card per template.
   To add/edit/remove templates, edit templates.json only.
------------------------------------------------------------------- */

/* ---------- Message building (pure logic, no DOM) ---------- */

function todayString() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// Starting values for a template's options
function defaultState(template) {
  const state = {};
  (template.options || []).forEach((opt) => {
    if (opt.type === "toggle") state[opt.id] = false;
    else if (opt.type === "choice") state[opt.id] = opt.default || opt.choices[0].value;
    else if (opt.type === "multi") state[opt.id] = opt.choices.map((c) => c.value); // all selected
    else state[opt.id] = opt.default === "today" ? todayString() : opt.default || "";
  });
  return state;
}

// Does a "when"/"showWhen" condition match the current state?
// { id: value }  or  { id: [value1, value2] }  - all keys must match.
function matches(cond, state) {
  if (!cond) return true;
  return Object.keys(cond).every((id) => {
    const want = cond[id];
    if (want === "*") {
      const v = state[id];
      return Array.isArray(v) ? v.length > 0 : Boolean((v || "").trim());
    }
    return Array.isArray(want) ? want.includes(state[id]) : state[id] === want;
  });
}

// Is an option currently showing? (showWhen must match; unless must NOT match)
function isVisible(opt, state) {
  return matches(opt.showWhen, state) && !(opt.unless && matches(opt.unless, state));
}

// Returns { text, missing } - the final message and any blank fields still showing placeholders
function buildMessage(template, state) {
  const options = template.options || [];
  const missing = [];

  const fill = (str) =>
    str.replace(/\{\{(\w+)\}\}/g, (_, id) => {
      const opt = options.find((o) => o.id === id);
      let value;
      if (opt && opt.type === "multi") {
        value = opt.choices
          .filter((c) => (state[id] || []).includes(c.value))
          .map((c) => c.value)
          .join(", ");
      } else {
        value = (state[id] || "").trim();
      }
      if (value) return value;
      const fallback = (opt && opt.fallback) || `[${opt ? opt.label : id}]`;
      if (!missing.includes(opt ? opt.label : id)) missing.push(opt ? opt.label : id);
      return fallback;
    });

  // Static templates can just use "text" with no parts
  const parts = template.parts || [{ text: template.text || "" }];
  const text = parts
    .filter((p) => matches(p.when, state) && !(p.unless && matches(p.unless, state)))
    .map((p) => fill(p.text))
    .join("");

  return { text, missing };
}

/* ---------- Copy to clipboard ---------- */

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for older browsers / non-secure contexts
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
    } catch (err) {
      reject(err);
    } finally {
      document.body.removeChild(ta);
    }
  });
}

/* ---------- Rendering ---------- */

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  });
  (children || []).forEach((c) => node.appendChild(c));
  return node;
}

function renderTemplate(template, number) {
  const state = defaultState(template);
  const options = template.options || [];
  const controls = {}; // id -> wrapper element, so we can show/hide

  const card = el("div", { class: "card" });
  card.appendChild(el("h3", { text: `${number}. ${template.title}` }));

  const preview = el("div", {
    class: options.length ? "preview-area" : "static-preview",
    "aria-live": "polite",
  });
  const note = el("div", { class: "missing-note", role: "status" });
  const button = el("button", {
    class: "btn-copy",
    type: "button",
    text: template.copyLabel || "Copy",
  });

  function refresh() {
    options.forEach((opt) => {
      controls[opt.id].hidden = !isVisible(opt, state);
    });
    const { text, missing } = buildMessage(template, state);
    preview.textContent = text;
    note.textContent = missing.length ? `Still to fill in: ${missing.join(", ")}` : "";
  }

  // Option controls
  if (options.length) {
    const group = el("div", { class: "input-group" });
    const choiceGroup = el("div", { class: "choice-stack" });

    options.forEach((opt) => {
      const wrap = el("div", { class: "input-field" });

      if (opt.type === "field") {
        const inputId = `${template.id}-${opt.id}`;
        wrap.appendChild(el("label", { for: inputId, text: opt.label }));
        const input = el("input", {
          type: "text",
          id: inputId,
          placeholder: opt.placeholder || "",
          autocomplete: "off",
        });
        input.value = state[opt.id];
        input.addEventListener("input", () => {
          state[opt.id] = input.value;
          refresh();
        });
        wrap.appendChild(input);
        controls[opt.id] = wrap;
        group.appendChild(wrap);
      } else if (opt.type === "toggle") {
        const btn = el("button", {
          type: "button",
          class: "toggle",
          "aria-pressed": "false",
          text: opt.label,
        });
        btn.addEventListener("click", () => {
          state[opt.id] = !state[opt.id];
          btn.setAttribute("aria-pressed", String(state[opt.id]));
          refresh();
        });
        wrap.appendChild(btn);
        controls[opt.id] = wrap;
        choiceGroup.appendChild(wrap);
      } else if (opt.type === "multi") {
        wrap.appendChild(el("span", { class: "option-label", text: opt.label }));
        const row = el("div", { class: "choice-row", role: "group", "aria-label": opt.label });
        opt.choices.forEach((c) => {
          const btn = el("button", {
            type: "button",
            class: "toggle",
            "aria-pressed": String(state[opt.id].includes(c.value)),
            text: c.label || c.value,
          });
          btn.addEventListener("click", () => {
            const on = state[opt.id].includes(c.value);
            state[opt.id] = on
              ? state[opt.id].filter((v) => v !== c.value)
              : state[opt.id].concat(c.value);
            btn.setAttribute("aria-pressed", String(!on));
            refresh();
          });
          row.appendChild(btn);
        });
        wrap.appendChild(row);
        controls[opt.id] = wrap;
        choiceGroup.appendChild(wrap);
      } else if (opt.type === "choice") {
        wrap.appendChild(el("span", { class: "option-label", text: opt.label }));
        const row = el("div", { class: "choice-row", role: "group", "aria-label": opt.label });
        opt.choices.forEach((c) => {
          const btn = el("button", {
            type: "button",
            class: "toggle",
            "aria-pressed": String(state[opt.id] === c.value),
            text: c.label,
          });
          btn.addEventListener("click", () => {
            state[opt.id] = c.value;
            row.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));
            btn.setAttribute("aria-pressed", "true");
            refresh();
          });
          row.appendChild(btn);
        });
        wrap.appendChild(row);
        controls[opt.id] = wrap;
        choiceGroup.appendChild(wrap);
      }
    });

    // Order on screen: yes/no and pick-one options first, then text fields
    card.appendChild(choiceGroup);
    card.appendChild(group);
  }

  card.appendChild(preview);
  card.appendChild(note);
  card.appendChild(button);

  button.addEventListener("click", () => {
    const { text } = buildMessage(template, state);
    const original = template.copyLabel || "Copy";
    copyToClipboard(text)
      .then(() => {
        button.textContent = "Copied!";
        button.classList.add("copied");
        setTimeout(() => {
          button.textContent = original;
          button.classList.remove("copied");
        }, 1500);
      })
      .catch((err) => {
        console.error("Failed to copy:", err);
        alert("Failed to copy text. Please copy manually.");
      });
  });

  refresh();
  return card;
}

function renderApp(data) {
  document.title = data.title;
  document.getElementById("app-title").textContent = data.title;

  const root = document.getElementById("templates");
  root.textContent = "";

  let n = 0;
  data.categories.forEach((cat) => {
    root.appendChild(el("h2", { class: "category", text: cat.name }));
    cat.templates.forEach((t) => {
      n += 1;
      root.appendChild(renderTemplate(t, n));
    });
  });
}

/* ---------- Start up (browser only) ---------- */

if (typeof document !== "undefined") {
  fetch("templates.json")
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(renderApp)
    .catch((err) => {
      console.error(err);
      document.getElementById("templates").textContent =
        "Could not load templates.json. If you opened this file directly from your computer, " +
        "use the published GitHub Pages link instead (browsers block loading it from a local file).";
    });
}

// Lets the test script load the logic without a browser
if (typeof module !== "undefined") {
  module.exports = { buildMessage, defaultState, todayString, matches, isVisible };
}
