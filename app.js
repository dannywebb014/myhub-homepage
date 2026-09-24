// ─── today. ──────────────────────────────────────────────────────────
//
// The panel above the app cards: today's meals from food. and today's tasks
// from Craft, tickable here. Signed in with the same account as the other
// hub apps; the Craft connection URLs are kept in the database so every
// device and every app can use them after one setup.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm";

const SUPABASE_URL = "https://tvpmeysctvlhjyhotfyk.supabase.co";
// The anon key is meant to be public: every table it can reach is guarded by
// row-level security, so it only ever returns the signed-in user's own rows.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2cG1leXNjdHZsaGp5aG90ZnlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MjkxMjcsImV4cCI6MjA5MDMwNTEyN30.FyerEiT3XA6uAXH_JlFhi_v2Job4GKLWuTFmbGVIjMg";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SPACES = [
  { id: "my", label: "my space." },
  { id: "work", label: "work." },
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MEALS = ["Breakfast", "Snack 1", "Lunch", "Snack 2", "Dinner", "Snack 3"];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

let links = {};      // space id -> { url, api_key }
let tasks = [];
let meals = [];
let quote = null;

// ── Craft ──
// Only the link ID matters, so a URL pasted with or without /api/v1 works.
function apiBase(url) {
  const m = String(url || "").trim().match(/^(?:https?:\/\/)?(connect\.craft\.do\/links\/[^/?#\s]+)/i);
  return m ? `https://${m[1]}/api/v1` : String(url || "").replace(/\/+$/, "");
}

async function craft(spaceId, path, options = {}) {
  const link = links[spaceId];
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (link.api_key) headers.Authorization = `Bearer ${link.api_key}`;
  const resp = await fetch(apiBase(link.url) + path, { ...options, headers });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const err = new Error(`${resp.status} ${body.slice(0, 120)}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

// Today means anything scheduled for today or earlier: overdue still needs doing.
const isToday = (iso) => {
  if (!iso) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d) <= today;
};
const placeLabel = (loc) =>
  loc?.type === "document" ? (loc.title || "Untitled")
    : loc?.type === "dailyNote" ? "Daily note"
      : "Inbox";

async function loadTasks() {
  const spaces = SPACES.filter(s => links[s.id]?.url);
  const found = new Map();
  const failed = [];
  await Promise.all(spaces.map(async (space) => {
    try {
      // The same three scopes tasks. uses: Craft counts a task scheduled for
      // later today as upcoming, so asking for active alone misses it.
      const lists = await Promise.all(["active", "upcoming", "inbox"].map(scope => craft(space.id, `/tasks?scope=${scope}`)));
      for (const list of lists) {
        for (const item of list.items || []) {
          if (item.taskInfo?.state !== "todo" || !isToday(item.taskInfo?.scheduleDate)) continue;
          found.set(item.id, {
            id: item.id,
            text: (item.markdown || "").replace(/^\s*[-*]\s*\[[ x]\]\s*/, "").trim(),
            spaceId: space.id,
            where: placeLabel(item.location),
            late: item.taskInfo.scheduleDate.slice(0, 10) < new Date().toISOString().slice(0, 10),
          });
        }
      }
    } catch (err) {
      console.error(`Loading ${space.label} tasks failed:`, err);
      failed.push(space.label);
    }
  }));
  if (failed.length) note(`Couldn’t load tasks from ${failed.join(" and ")}.`);
  tasks = [...found.values()].sort((a, b) =>
    SPACES.findIndex(s => s.id === a.spaceId) - SPACES.findIndex(s => s.id === b.spaceId) ||
    a.text.localeCompare(b.text));
}

async function tickOff(task, row) {
  row.classList.add("done");
  try {
    await craft(task.spaceId, "/tasks", {
      method: "PUT",
      body: JSON.stringify({ tasksToUpdate: [{ id: task.id, taskInfo: { state: "done" } }] }),
    });
    setTimeout(() => { tasks = tasks.filter(t => t.id !== task.id); paint(); }, 800);
  } catch (err) {
    console.error("Ticking off failed:", err);
    row.classList.remove("done");
    note(/scope/i.test(err.message)
      ? "That task is in a document this Craft connection can’t change. Use an “All Documents” connection."
      : "Couldn’t tick that off.");
  }
}

// ── food. ──
// Every meal planned for today, in the order food. lists them.
async function loadMeals() {
  const { data: { user } } = await supabase.auth.getUser();
  const profile = check(await supabase.from("profiles").select("household_id").eq("id", user.id).maybeSingle());
  if (!profile?.household_id) return;
  const rows = check(await supabase.from("meal_plan")
    .select("meal, recipe_id, note")
    .eq("household_id", profile.household_id)
    .eq("day", DAYS[new Date().getDay()]));
  const ids = [...new Set(rows.map(r => r.recipe_id).filter(Boolean))];
  const recipes = ids.length
    ? check(await supabase.from("recipes").select("id, name, prep_time, cook_time").in("id", ids))
    : [];
  meals = MEALS.map(meal => {
    const named = rows.filter(r => r.meal === meal)
      .map(r => recipes.find(x => x.id === r.recipe_id) || { name: r.note });
    return {
      meal,
      names: named.map(r => r.name).filter(Boolean),
      minutes: named.reduce((total, r) => total + (r.prep_time || 0) + (r.cook_time || 0), 0),
    };
  }).filter(m => m.names.length);
}

// ── motivation. ──
// A different one each time the page is opened or refreshed.
async function loadQuote() {
  const rows = check(await supabase.from("motivation_quotes").select("text, author"));
  quote = rows.length ? rows[Math.floor(Math.random() * rows.length)] : null;
}

function paintQuote() {
  const box = $("quote");
  box.hidden = !quote;
  if (!quote) return;
  box.querySelector(".q-text").textContent = quote.text;
  box.querySelector(".q-author").textContent = quote.author ? `— ${quote.author}` : "";
}

// ── Painting ──
let noteTimer;
function note(message) {
  const el = $("today-note");
  el.textContent = message;
  el.hidden = !message;
  clearTimeout(noteTimer);
  if (message) noteTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

function paint() {
  const body = $("today-body");
  body.replaceChildren();

  for (const meal of meals) {
    const line = document.createElement("a");
    line.className = "t-meal-row";
    line.href = "https://food-hub-weld-five.vercel.app/";
    line.target = "_blank";
    line.rel = "noopener noreferrer";
    line.innerHTML = `<span class="t-kind"></span><span class="t-meal"></span><span class="t-mins">${meal.minutes ? `${meal.minutes} min` : ""}</span>`;
    line.querySelector(".t-kind").textContent = meal.meal.toLowerCase();
    line.querySelector(".t-meal").textContent = meal.names.join(" · ");
    body.append(line);
  }

  if (!SPACES.some(s => links[s.id]?.url)) {
    const connect = document.createElement("button");
    connect.className = "t-link";
    connect.textContent = "Connect Craft to see today’s tasks";
    connect.onclick = openSettings;
    body.append(connect);
  } else if (!tasks.length) {
    const p = document.createElement("p");
    p.className = "t-empty";
    p.textContent = meals.length ? "No tasks due today." : "Nothing due today.";
    body.append(p);
  }

  for (const task of tasks) {
    const row = document.createElement("div");
    row.className = "t-row";
    row.innerHTML = `<button class="tick" aria-label="Tick off"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>
      <div class="t-body"><div class="t-text"></div>
        <div class="t-meta"><span class="t-space ${task.spaceId}">${esc(SPACES.find(s => s.id === task.spaceId).label)}</span>
        ${task.late ? `<span class="t-late">overdue</span>` : ""}
        <span class="t-doc">${esc(task.where)}</span></div>
      </div>`;
    row.querySelector(".t-text").textContent = task.text || "(no text)";
    row.querySelector(".tick").onclick = () => tickOff(task, row);
    body.append(row);
  }
  $("today-count").textContent = tasks.length ? `${tasks.length} task${tasks.length === 1 ? "" : "s"}` : "";
}

// ── Settings ──
async function openSettings() {
  const { data: { session } } = await supabase.auth.getSession();
  $("who").textContent = session ? `Signed in as ${session.user.email}` : "Not signed in.";
  $("account-btn").textContent = session ? "Sign out" : "Sign in";
  $("craft-section").hidden = !session;
  $("save-btn").hidden = !session;
  if (session) {
    // tasks. stores its connections in this browser under the same site, so
    // offer them rather than making the URLs be pasted twice.
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("tasks.settings") || "{}").spaces || {}; } catch { /* none */ }
    $("craft-fields").replaceChildren(...SPACES.map(space => {
      const box = document.createElement("div");
      box.innerHTML = `<label class="f">${esc(space.label)} Craft API URL</label>
        <input class="field" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://connect.craft.do/links/…">`;
      const input = box.querySelector("input");
      input.value = links[space.id]?.url || saved[space.id]?.url || "";
      input.dataset.space = space.id;
      return box;
    }));
  }
  $("settings-dialog").showModal();
}

async function saveCraftLinks() {
  const rows = [...$("craft-fields").querySelectorAll("input")]
    .map(input => ({ space: input.dataset.space, url: input.value.trim() }))
    .filter(row => row.url);
  if (!rows.length) return;
  try {
    check(await supabase.from("craft_links")
      .upsert(rows.map(r => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: "user_id,space" }));
    await loadLinks();
    await loadTasks();
    paint();
  } catch (err) {
    console.error("Saving Craft links failed:", err);
    note(`Couldn’t save the Craft connections: ${err.message}`);
  }
}

async function loadLinks() {
  links = {};
  for (const row of check(await supabase.from("craft_links").select("space, url, api_key"))) links[row.space] = row;
}

// ── Start ──
function showSignedOut() {
  $("today").hidden = false;
  $("today-count").textContent = "";
  $("refresh").hidden = true;
  $("today-body").innerHTML = `<p class="t-empty">Sign in from <b>settings</b>, at the bottom of the page, to see today’s meals and tasks.</p>`;
}

async function start() {
  $("today").hidden = false;
  $("refresh").hidden = false;
  $("today-body").innerHTML = `<p class="t-empty">Loading…</p>`;
  try { await loadLinks(); } catch (err) { console.error(err); note("Couldn’t load your Craft connections."); }
  await Promise.all([
    loadTasks(),
    loadMeals().catch(err => { console.error("Loading meals failed:", err); note("Couldn’t load today’s meals."); }),
    loadQuote().catch(err => console.error("Loading a quote failed:", err)),
  ]);
  paint();
  paintQuote();
}

$("settings-open").addEventListener("click", openSettings);
$("account-btn").addEventListener("click", async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) { await supabase.auth.signOut(); location.reload(); return; }
  $("settings-dialog").close();
  $("login-dialog").showModal();
});
$("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  $("settings-dialog").close();
  saveCraftLinks();
});
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  $("login-error").textContent = "";
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
    if (error) throw error;
    $("login-dialog").close();
    start();
  } catch (err) {
    $("login-error").textContent = err.message === "Invalid login credentials" ? "That email and password don’t match." : err.message;
  }
});
$("refresh").addEventListener("click", async () => {
  await Promise.all([loadTasks(), loadQuote().catch(() => { /* keep the old one */ })]);
  paint();
  paintQuote();
});

const { data: { session } } = await supabase.auth.getSession();
session ? start() : showSignedOut();
