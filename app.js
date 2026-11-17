/* VICORA School frontend — live Apps Script API client.
 * Keep the deployment URL public; never place administrator secrets here.
 */
const VICORA_API_URL = "https://script.google.com/macros/s/AKfycbzq7ZRam-CV8o2b5B1fOJjUQmCjug37SZ9yp95YuvCwAwf5MaGYbq0fB_PpHdJSAKoy/exec";
const TOKEN_KEY = "vicora_school_session";
let sessionToken = sessionStorage.getItem(TOKEN_KEY) || "";
let currentPrincipal = null;
let liveSchools = [];
let liveFeatures = [];
let livePlans = [];
let liveApplications = [];
let selectedSchoolId = "";

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

async function api(action, payload = {}, authenticated = true) {
  const body = { action, ...payload };
  if (authenticated) {
    if (!sessionToken) throw new Error("Your session has ended. Please sign in again.");
    body.sessionToken = sessionToken;
  }
  let response;
  try {
    response = await fetch(VICORA_API_URL, {
      method: "POST",
      mode: "cors",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new Error("Could not reach the VICORA backend. Check the deployment access setting and internet connection.");
  }
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); }
  catch (_) { throw new Error("The backend did not return JSON. Confirm that the Apps Script Web App is deployed for the intended users and that the URL is correct."); }
  if (!result || result.ok !== true) {
    const err = new Error(result?.message || result?.error || "The request failed.");
    err.code = result?.error || "API_ERROR";
    if (err.code === "UNAUTHENTICATED" || err.code === "SESSION_EXPIRED") signOut(false);
    throw err;
  }
  return result.data;
}

function ensureLoginScreen() {
  if ($("vicoraLogin")) return;
  const screen = document.createElement("section");
  screen.id = "vicoraLogin";
  screen.innerHTML = `
    <div class="login-card">
      <div class="login-brand"><span class="brand-mark">V</span><span><strong>VICORA</strong><small>SCHOOL PLATFORM</small></span></div>
      <p class="eyebrow">SECURE PLATFORM ACCESS</p>
      <h1>Welcome back.</h1>
      <p class="login-intro">Sign in with your VICORA Platform Super Admin account.</p>
      <form id="vicoraLoginForm">
        <label>Email address<input id="loginEmail" type="email" autocomplete="username" required placeholder="admin@example.com"></label>
        <label>Password<input id="loginPassword" type="password" autocomplete="current-password" required placeholder="Your password"></label>
        <button class="primary-button" id="loginButton" type="submit">Sign in securely <span>→</span></button>
        <p id="loginError" class="login-error" role="alert"></p>
      </form>
      <small class="login-foot">Veehicee Telecommunications and Services · VICORA School</small>
    </div>`;
  document.body.prepend(screen);
  $("vicoraLoginForm").addEventListener("submit", login);
}

function showLogin(message = "") {
  ensureLoginScreen();
  $("vicoraLogin").style.display = "grid";
  const shell = document.querySelector(".app-shell");
  if (shell) shell.style.display = "none";
  $("loginError").textContent = message;
}
function hideLogin() {
  $("vicoraLogin")?.remove();
  const shell = document.querySelector(".app-shell");
  if (shell) shell.style.display = "";
}
async function login(event) {
  event.preventDefault();
  const button = $("loginButton"), error = $("loginError");
  button.disabled = true; button.textContent = "Signing in…"; error.textContent = "";
  try {
    const result = await api("auth.login", { email: $("loginEmail").value.trim(), password: $("loginPassword").value }, false);
    if (result.role !== "SUPER_ADMIN") {
      sessionToken = result.token;
      await api("auth.logout");
      sessionToken = "";
      throw new Error("This console is for the Platform Super Admin. Use the school administrator portal for school accounts.");
    }
    sessionToken = result.token;
    sessionStorage.setItem(TOKEN_KEY, sessionToken);
    currentPrincipal = await api("auth.me");
    if (currentPrincipal.role !== "SUPER_ADMIN") throw new Error("This account does not have Platform Super Admin access.");
    hideLogin();
    await loadPlatform();
  } catch (e) {
    sessionToken = "";
    sessionStorage.removeItem(TOKEN_KEY);
    error.textContent = e.message;
  } finally {
    button.disabled = false; button.innerHTML = 'Sign in securely <span>→</span>';
  }
}

async function signOut(callServer = true) {
  const token = sessionToken;
  sessionToken = ""; currentPrincipal = null;
  sessionStorage.removeItem(TOKEN_KEY);
  if (callServer && token) {
    try {
      await fetch(VICORA_API_URL, { method:"POST", mode:"cors", redirect:"follow",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body:JSON.stringify({action:"auth.logout",sessionToken:token}) });
    } catch (_) {}
  }
  showLogin("You have been signed out.");
}

function setStatus(message, isError = false) {
  let el = $("connectionStatus");
  if (!el) {
    el = document.createElement("div");
    el.id = "connectionStatus";
    el.className = "connection-status";
    document.querySelector(".topbar")?.append(el);
  }
  el.textContent = message;
  el.classList.toggle("error", isError);
}

async function loadPlatform() {
  setStatus("Connecting to live registry…");
  try {
    const [schools, features, plans, applications, audit] = await Promise.all([
      api("platform.schools"),
      api("platform.features.list"),
      api("platform.plans.list"),
      api("platform.applications.list"),
      api("platform.audit.list", { limit: 30 })
    ]);
    liveSchools = Array.isArray(schools) ? schools : [];
    liveFeatures = Array.isArray(features) ? features : [];
    livePlans = Array.isArray(plans) ? plans : [];
    liveApplications = Array.isArray(applications) ? applications : [];
    renderOverview(audit);
    renderSchools();
    renderFeatures();
    renderPlans();
    renderAudit(audit);
    setStatus("Connected to VICORA registry");
    const banner = document.querySelector(".demo-banner");
    if (banner) banner.innerHTML = "<strong>Live backend connected</strong><span>Records shown here are retrieved from the VICORA Apps Script registry. School operations remain subject to backend permissions and feature availability.</span>";
    document.querySelectorAll(".profile small").forEach(x => x.textContent = "Authenticated · Super Admin");
    const profile = document.querySelector(".profile");
    if (profile && !$("logoutButton")) {
      const b = document.createElement("button"); b.id="logoutButton"; b.className="logout-button"; b.textContent="Sign out"; b.onclick=()=>signOut(true); profile.append(b);
    }
  } catch (e) {
    setStatus(e.message, true);
    if (e.code === "UNAUTHENTICATED" || e.code === "SESSION_EXPIRED") showLogin(e.message);
  }
}

function renderOverview(audit = []) {
  if ($("statSchools")) $("statSchools").textContent = liveSchools.length;
  if ($("statActive")) $("statActive").textContent = liveSchools.filter(s => String(s.status).toUpperCase() === "ACTIVE").length;
  if ($("statFeatures")) $("statFeatures").textContent = liveFeatures.length;
  const pending = liveApplications.filter(a => ["PENDING","SUBMITTED","UNDER_REVIEW"].includes(String(a.review_status).toUpperCase())).length;
  const pendingNode = document.querySelector(".stat-card:nth-child(4) > strong");
  if (pendingNode) pendingNode.textContent = pending;
  document.querySelectorAll(".stat-card small").forEach((el,i)=>{if(i===0)el.textContent="Live registry";if(i===1)el.textContent="Registry status";if(i===2)el.textContent="Backend feature catalogue";if(i===3)el.textContent="Awaiting review";});
  const intro = document.querySelector(".welcome-row .intro");
  if (intro) intro.textContent = "Live platform registry, school onboarding and access governance.";
}

function renderSchools() {
  const body = $("schoolRows"); if (!body) return;
  const q = ($("schoolSearch")?.value || "").toLowerCase();
  const status = $("schoolStatus")?.value || "all";
  const rows = liveSchools.filter(s => (status === "all" || String(s.status).toLowerCase() === status.toLowerCase()) &&
    `${s.display_name||s.legal_name||""} ${s.school_id||""}`.toLowerCase().includes(q));
  body.replaceChildren();
  rows.forEach(s => {
    const tr=document.createElement("tr");
    const name=s.display_name||s.legal_name||"Unnamed school";
    const values=[name,s.school_id||"—",s.school_type||"—",s.status||"UNKNOWN","—"];
    values.forEach((v,i)=>{
      const td=document.createElement("td");
      if(i===0){td.className="school-cell";td.textContent=v;}
      else if(i===1){td.className="mono";td.textContent=v;}
      else if(i===3){const p=document.createElement("span");p.className="status-pill "+String(v).toLowerCase();p.textContent=v;td.append(p);}
      else td.textContent=v;
      tr.append(td);
    });
    const action=document.createElement("td");
    const b=document.createElement("button");b.className="row-action";b.textContent="View access";
    b.onclick=()=>{selectedSchoolId=String(s.school_id||"");showView("features");loadSchoolFeatures();};
    action.append(b);tr.append(action);body.append(tr);
  });
  if(!rows.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=6;td.textContent="No matching schools found in the live registry.";tr.append(td);body.append(tr);}
}

async function loadSchoolFeatures() {
  const list=$("featureList"); if(!list)return;
  if(!selectedSchoolId){list.textContent="Select a school from the registry to inspect its feature access.";return;}
  list.textContent="Loading live feature access…";
  try {
    const data=await api("platform.school.features.list",{schoolId:selectedSchoolId});
    const selector=$("featureSchool");
    if(selector){selector.replaceChildren();const o=document.createElement("option");o.value=selectedSchoolId;o.textContent=data.school?.name||selectedSchoolId;selector.append(o);}
    list.replaceChildren();
    (data.features||[]).forEach(f=>{
      const row=document.createElement("article");row.className="feature-row";
      const info=document.createElement("div");info.className="feature-info";
      const group=document.createElement("small");group.textContent=f.category||"Platform feature";
      const title=document.createElement("strong");title.textContent=f.name||f.featureId;
      const desc=document.createElement("p");desc.textContent=f.description||"";
      const state=document.createElement("span");state.className="capability-state "+(f.allowed?"ready":"planned");
      state.textContent=f.allowed?"Enabled for this school":(f.reason||f.implementationStatus||"Not enabled");
      info.append(group,title,desc,state);row.append(info);list.append(row);
    });
    $("accessSummary").textContent=`Live access evaluation for ${data.school?.name||selectedSchoolId}. Access is determined by platform status, subscription, plan entitlement and school assignment.`;
  } catch(e){list.textContent=e.message;}
}
function renderFeatures() {
  const list=$("featureList");if(!list)return;
  list.replaceChildren();
  const hint=document.createElement("p");hint.className="table-note";hint.textContent="Choose “View access” beside a school in the registry to load its actual server-evaluated feature access.";
  list.append(hint);
}
function renderPlans() {
  const section=$("view-plans");if(!section)return;
  const old=section.querySelector(".live-plans");if(old)old.remove();
  const wrap=document.createElement("div");wrap.className="live-plans";
  if(!livePlans.length){const p=document.createElement("p");p.className="table-note";p.textContent="No plans are configured in the live registry yet.";wrap.append(p);}
  livePlans.forEach(p=>{
    const card=document.createElement("article");card.className="feature-row";
    const info=document.createElement("div");info.className="feature-info";
    const title=document.createElement("strong");title.textContent=p.name||p.plan_id;
    const desc=document.createElement("p");desc.textContent=`${p.billing_period||"Custom"} · ${p.status||"Unknown"} · ${(p.features||[]).filter(x=>x.included).length} included features`;
    info.append(title,desc);card.append(info);wrap.append(card);
  });
  section.append(wrap);
  const empty=section.querySelector(".empty-state");if(empty)empty.hidden=livePlans.length>0;
}
function renderAudit(audit) {
  const section=$("view-audit");if(!section)return;
  const empty=section.querySelector(".empty-state");if(empty)empty.hidden=Array.isArray(audit)&&audit.length>0;
  let table=section.querySelector(".audit-table-wrap");if(table)table.remove();
  if(!Array.isArray(audit)||!audit.length)return;
  table=document.createElement("div");table.className="table-wrap audit-table-wrap";
  const t=document.createElement("table");t.innerHTML="<thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Outcome</th></tr></thead>";
  const tb=document.createElement("tbody");
  audit.forEach(a=>{const tr=document.createElement("tr");[a.occurred_at,a.actor_user_id,a.action,a.target_type+" · "+a.target_id,a.outcome].forEach(v=>{const td=document.createElement("td");td.textContent=v||"—";tr.append(td);});tb.append(tr);});
  t.append(tb);table.append(t);section.append(table);
}

function showView(name) {
  document.querySelectorAll(".page-content[id^='view-']").forEach(v=>v.hidden=v.id!==`view-${name}`);
  document.querySelectorAll(".nav-item").forEach(n=>{const active=n.dataset.view===name;n.classList.toggle("active",active);n.setAttribute("aria-current",active?"page":"false");});
  const active=document.querySelector(`.nav-item[data-view="${name}"]`);
  if(active&&$("crumbCurrent"))$("crumbCurrent").textContent=active.textContent.trim();
  $("sidebar")?.classList.remove("open");
  if(name==="schools")renderSchools();
  if(name==="features")renderFeatures();
  if(name==="plans")renderPlans();
}
document.querySelectorAll(".nav-item").forEach(n=>n.addEventListener("click",()=>showView(n.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.go)));
$("menuButton")?.addEventListener("click",()=>$("sidebar")?.classList.toggle("open"));
document.addEventListener("click",e=>{if(innerWidth<=760&&$("sidebar")?.classList.contains("open")&&!$("sidebar").contains(e.target)&&!$("menuButton")?.contains(e.target))$("sidebar").classList.remove("open");});
$("schoolSearch")?.addEventListener("input",renderSchools);
$("schoolStatus")?.addEventListener("change",renderSchools);
$("featureSchool")?.addEventListener("change",e=>{selectedSchoolId=e.target.value;loadSchoolFeatures();});
$("newSchoolButton")?.addEventListener("click",()=>loadPlatform());
$("year") && ($("year").textContent=new Date().getFullYear());

async function start() {
  ensureLoginScreen();
  if (!sessionToken) { showLogin(); return; }
  try {
    currentPrincipal=await api("auth.me");
    if(currentPrincipal.role!=="SUPER_ADMIN"){await signOut(true);return;}
    hideLogin();await loadPlatform();
  } catch(e) {
    sessionToken="";sessionStorage.removeItem(TOKEN_KEY);showLogin("Please sign in again. "+e.message);
  }
}
start();
