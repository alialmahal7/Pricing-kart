// Firebase layer for the pricing page (GitHub Pages version).
// It gives the page the same small API it uses inside Claude: claude.use("db") -> doc(path).get()/set(),
// and claude.use("downloads") -> save({filename, data}).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, get, set } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const EDITOR_DOCS = ["fares", "iata", "log"]; // an editor may change only fares and IATA taxes (and the change log)
const ready = firebaseConfig && firebaseConfig.apiKey && firebaseConfig.databaseURL;

function showLogin(msg, kind) { $("fbLogin").hidden = false; $("fbMsg").textContent = msg || ""; $("fbMsg").className = "fb-msg " + (kind || ""); }
if (!ready) {
  const miss = !firebaseConfig || !firebaseConfig.apiKey ? "apiKey" : "databaseURL";
  $("fbForm").hidden = true; $("fbNote").hidden = false;
  $("fbNote").innerHTML = `<b>ملف firebase-config.js ناقص: ${miss}</b><br>` + (miss === "databaseURL"
    ? "افتح Firebase Console ← Realtime Database ← Data، وانسخ الرابط الفوق الجدول (بيبدأ بـ https:// وبينتهي بـ firebasedatabase.app أو firebaseio.com)، وحطّو في databaseURL."
    : "افتح Firebase Console ← Project settings ← Your apps ← Web، وانسخ قيم firebaseConfig.");
}
else {
  const app = initializeApp(firebaseConfig); const auth = getAuth(app); const rtdb = getDatabase(app);
  let me = null; let role = null; const known = {};

  const blockMsg = "ما عندك صلاحية تعدّل القسم ده";
  const dbShim = {
    doc(path) {
      const r = ref(rtdb, path);
      return {
        async get() {
          const s = await get(r); const v = s.exists() ? s.val() : null;
          known[path] = v ? v.t : null;
          return { exists: !!(v && v.json), data: () => JSON.parse(v.json) };
        },
        async set(value) {
          const name = path.split("/")[1];
          if (role !== "owner" && !(role === "editor" && EDITOR_DOCS.includes(name))) throw { code: blockMsg };
          const cur = (await get(r)).val();
          if (name === "log" && cur && cur.json) { // two people can save at once: keep both sides of the log
            const mine = value.entries || []; const theirs = JSON.parse(cur.json).entries || []; const seen = new Set();
            value = { entries: [...mine, ...theirs].filter((e) => { const k = e.t + "|" + e.doc + "|" + (e.by || ""); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b.t - a.t).slice(0, 250) };
            if (window.__S()) window.__S().log = value.entries;
          } else if (cur && known[path] !== undefined && cur.t !== known[path]) {
            throw { code: "في زول تاني عدّل البيانات دي بعد ما فتحت الصفحة. اعمل Refresh وجرّب تاني" };
          }
          const t = Date.now(); await set(r, { json: JSON.stringify(value), t, by: me }); known[path] = t;
        },
      };
    },
  };
  const dl = { async save({ filename, data }) { const a = document.createElement("a"); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data])); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); } };

  $("fbForm").addEventListener("submit", async (e) => { e.preventDefault(); $("fbBtn").disabled = true; showLogin("بيدخل…");
    try { await signInWithEmailAndPassword(auth, $("fbEmail").value.trim(), $("fbPass").value); }
    catch (er) { showLogin("الإيميل أو كلمة السر غلط.", "bad"); } finally { $("fbBtn").disabled = false; } });
  $("fbReset").addEventListener("click", async () => { const em = $("fbEmail").value.trim(); if (!em) { showLogin("اكتب الإيميل أول.", "bad"); return; }
    try { await sendPasswordResetEmail(auth, em); showLogin("اترسل ليك إيميل لتغيير كلمة السر.", "good"); } catch (er) { showLogin("ما قدرت أرسل الإيميل.", "bad"); } });
  $("fbOut").addEventListener("click", () => signOut(auth).then(() => location.reload()));

  let started = false;
  onAuthStateChanged(auth, async (user) => {
    if (!user) { showLogin(""); return; }
    try {
      const u = (await get(ref(rtdb, "users/" + user.uid))).val();
      if (!u || !["owner", "editor"].includes(u.role)) { showLogin(`الحساب ده (${user.email}) ما عندو صلاحية. المالك لازم يضيفو في users.`, "bad"); await signOut(auth); return; }
      role = u.role; me = u.name || user.email;
    } catch (er) { showLogin("ما قدرت أقرا الصلاحيات (" + (er.code || er) + ").", "bad"); return; }
    $("fbLogin").hidden = true; document.body.dataset.role = role;
    $("fbUser").textContent = me + (role === "owner" ? " · مالك" : " · أسعار وضرايب"); $("fbBar").hidden = false;
    if (started) return; started = true;
    window.claude = { use: async (n) => (n === "db" ? dbShim : n === "downloads" ? dl : null) };
    window.__S().me = me; window.__S().role = role;
    await window.__appInit();
    if (role === "editor") document.querySelectorAll("#h_roeOut, #h_roeIn, #e_sdgRate").forEach((x) => { x.readOnly = true; x.title = "المالك بس بيغيّر الريت"; });
    // changes made by other people since my last visit
    const key = "fb_seen_" + user.uid; const seen = Number(localStorage.getItem(key) || 0);
    const news = (window.__S().log || []).filter((e) => e.by && e.by !== me && e.t > seen);
    if (news.length) { const who = [...new Set(news.map((e) => e.by))].join("، ");
      $("fbNews").innerHTML = `<b>${news.length}</b> تعديل جديد من ${who} من آخر مرة فتحت فيها. <a href="#log">افتح سجل التعديلات</a>`; $("fbNews").hidden = false; }
    const markSeen = () => { if (location.hash === "#log") { localStorage.setItem(key, String(Date.now())); $("fbNews").hidden = true; } };
    window.addEventListener("hashchange", markSeen); markSeen();
  });
}
