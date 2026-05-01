<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>SINELEC OS v2.0</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js"></script>
<script src="config-v2.js"></script>

<style>
:root {
  --bg: #fdfbf7; --glass: rgba(255,255,255,0.75); --border: rgba(218,165,32,0.18);
  --text: #1a1410; --text-2: #6b5d52; --text-3: #9d8f7f;
  --accent: #d4a574; --gold: #daa520;
  --success: #10b981; --warning: #f59e0b; --error: #ef4444;
  --sidebar-width: 260px;
}
[data-theme="dark"] {
  --bg: #0a0a0a; --glass: rgba(18,18,18,0.75); --border: rgba(218,165,32,0.22);
  --text: #fff; --text-2: #a8a8a8; --text-3: #6b6b6b;
}
* { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
body {
  font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,sans-serif;
  background:var(--bg); color:var(--text); transition:background 0.3s;
  padding-bottom:80px;
}
.fab-lead {
  position:fixed; bottom:90px; right:16px; width:52px; height:52px;
  border-radius:50%; background:linear-gradient(135deg,#D4A017,#f5c842);
  border:none; cursor:pointer; display:flex; align-items:center; justify-content:center;
  font-size:22px; box-shadow:0 4px 16px rgba(212,160,23,0.5); z-index:8000; transition:all 0.2s;
}
@media(min-width:768px){ .fab-lead { bottom:24px; right:80px; } }
.sidebar {
  position:fixed; left:0; top:0; width:var(--sidebar-width); height:100vh;
  background:var(--glass); backdrop-filter:blur(24px) saturate(180%);
  -webkit-backdrop-filter:blur(24px) saturate(180%);
  border-right:1px solid var(--border); z-index:100;
  display:flex; flex-direction:column; box-shadow:4px 0 20px rgba(26,20,16,0.04);
}
.sidebar-logo { padding:24px 20px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:12px; }
.sidebar-logo-icon { width:42px; height:42px; background:linear-gradient(135deg,var(--accent),var(--gold)); border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:22px; animation:float 4s ease-in-out infinite; }
.sidebar-logo-text h1 { font-size:19px; font-weight:900; letter-spacing:-0.5px; background:linear-gradient(135deg,var(--text),var(--text-2)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.sidebar-logo-text span { font-size:10px; font-weight:600; color:var(--text-3); letter-spacing:0.5px; text-transform:uppercase; }
.sidebar-nav { flex:1; padding:16px 12px; overflow-y:auto; scrollbar-width:thin; }
.sidebar-item { display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:12px; cursor:pointer; transition:all 0.2s; margin-bottom:4px; font-size:14px; font-weight:600; color:var(--text-2); user-select:none; }
.sidebar-item:hover { background:rgba(212,165,116,0.1); color:var(--text); }
.sidebar-item.active { background:linear-gradient(135deg,var(--accent),var(--gold)); color:#fff; box-shadow:0 4px 12px rgba(212,165,116,0.3); }
.sidebar-item-icon { font-size:20px; width:24px; text-align:center; }
.sidebar-footer { padding:16px 20px; border-top:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
.mobile-tabs { display:none; position:fixed; bottom:0; left:0; right:0; z-index:100; background:var(--glass); backdrop-filter:blur(24px) saturate(180%); -webkit-backdrop-filter:blur(24px) saturate(180%); border-top:1px solid var(--border); padding:8px 0; box-shadow:0 -4px 20px rgba(26,20,16,0.06); }
.mobile-tabs-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:4px; padding:0 8px; }
.mobile-tab { display:flex; flex-direction:column; align-items:center; gap:4px; padding:8px 4px; border-radius:12px; cursor:pointer; transition:all 0.2s; }
.mobile-tab-icon { font-size:22px; }
.mobile-tab-label { font-size:10px; font-weight:700; color:var(--text-3); }
.mobile-tab.active { background:rgba(212,165,116,0.15); }
.mobile-tab.active .mobile-tab-icon { transform:scale(1.15); }
.mobile-tab.active .mobile-tab-label { color:var(--accent); }
.main-content { margin-left:var(--sidebar-width); min-height:100vh; position:relative; z-index:1; }
@media(max-width:768px){ body{padding-bottom:70px;} .sidebar{display:none;} .main-content{margin-left:0;} .mobile-tabs{display:block;} }
@keyframes float { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-5px);} }
@keyframes enter { from{opacity:0;transform:translateY(12px);} to{opacity:1;transform:translateY(0);} }
.theme-toggle { width:38px; height:38px; background:rgba(255,255,255,0.5); border:1.5px solid var(--border); border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.25s; backdrop-filter:blur(10px); font-size:18px; }
.theme-toggle:hover { transform:rotate(180deg) scale(1.1); border-color:var(--accent); }
.content { padding:26px 22px; max-width:680px; margin:0 auto; position:relative; z-index:1; }
.section { background:var(--glass); backdrop-filter:blur(24px) saturate(180%); -webkit-backdrop-filter:blur(24px) saturate(180%); border:1px solid var(--border); border-radius:20px; padding:24px; margin-bottom:20px; box-shadow:0 4px 16px rgba(26,20,16,0.06); transition:all 0.35s; }
.section:hover { box-shadow:0 8px 32px rgba(26,20,16,0.08); transform:translateY(-3px); }
.section-title { font-size:12px; font-weight:800; color:var(--accent); text-transform:uppercase; letter-spacing:1.2px; margin-bottom:20px; padding-left:16px; position:relative; }
.section-title::before { content:''; position:absolute; left:0; width:4px; height:20px; background:linear-gradient(180deg,var(--accent),var(--gold)); border-radius:4px; }
.input-group { margin-bottom:18px; }
.input-group label { display:block; font-size:13px; font-weight:600; color:var(--text-2); margin-bottom:8px; }
.input-group input,.input-group textarea,.input-group select { width:100%; background:rgba(255,255,255,0.65); border:1.5px solid rgba(218,165,32,0.15); border-radius:12px; padding:15px 18px; font-size:15px; font-weight:500; color:var(--text); outline:none; transition:all 0.25s; font-family:'Plus Jakarta Sans',sans-serif; }
.input-group input:focus,.input-group textarea:focus,.input-group select:focus { border-color:var(--accent); background:rgba(255,255,255,0.95); box-shadow:0 0 0 4px rgba(212,165,116,0.12); }
.input-group textarea { resize:none; min-height:95px; line-height:1.6; }
.cat-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; margin-bottom:20px; }
@media(min-width:640px){ .cat-grid{grid-template-columns:repeat(3,1fr);} }
.cat-btn { background:rgba(255,255,255,0.55); border:1.5px solid rgba(218,165,32,0.15); border-radius:12px; padding:16px 14px; font-size:13px; font-weight:700; color:var(--text-2); cursor:pointer; transition:all 0.25s; text-align:center; }
.cat-btn:hover { background:rgba(255,255,255,0.85); transform:translateY(-4px); }
.cat-btn.selected { background:linear-gradient(135deg,var(--accent),var(--gold)); color:#fff; border-color:transparent; transform:translateY(-3px); }
.prestations { display:none; flex-direction:column; gap:10px; margin-bottom:20px; }
.prestations.show { display:flex; }
.prest-btn { background:rgba(255,255,255,0.55); border:1.5px solid rgba(218,165,32,0.12); border-radius:12px; padding:16px 18px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; transition:all 0.25s; }
.prest-btn:hover { background:rgba(255,255,255,0.9); transform:translateX(8px); }
.prest-name { font-size:14px; font-weight:600; color:var(--text); flex:1; }
.prest-price { font-size:15px; font-weight:800; color:var(--accent); }
.panier { background:var(--glass); backdrop-filter:blur(24px) saturate(180%); -webkit-backdrop-filter:blur(24px) saturate(180%); border:1px solid var(--border); border-radius:20px; overflow:hidden; margin-bottom:20px; box-shadow:0 4px 16px rgba(26,20,16,0.06); }
.panier-header { padding:18px 20px; background:linear-gradient(135deg,rgba(212,165,116,0.16),rgba(218,165,32,0.12)); font-size:14px; font-weight:800; color:var(--accent); text-transform:uppercase; letter-spacing:0.5px; display:flex; justify-content:space-between; border-bottom:1px solid var(--border); }
.panier-empty { padding:60px 24px; text-align:center; color:var(--text-3); font-size:14px; }
.panier-item { padding:16px 20px; border-top:1px solid rgba(218,165,32,0.08); display:flex; align-items:center; gap:14px; transition:background 0.25s; }
.panier-item:hover { background:rgba(255,255,255,0.55); }
.panier-item-name { flex:1; font-size:14px; font-weight:600; color:var(--text); }
.panier-item-price { font-size:15px; font-weight:800; color:var(--accent); min-width:90px; text-align:right; }
.qte-ctrl { display:flex; align-items:center; gap:10px; }
.qte-btn { width:32px; height:32px; background:rgba(212,165,116,0.15); border:none; border-radius:10px; color:var(--accent); font-size:18px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.15s; }
.qte-btn:hover { background:var(--accent); color:#fff; transform:scale(1.15); }
.qte-val { font-size:16px; font-weight:800; color:var(--accent); min-width:28px; text-align:center; }
.del-btn { background:none; border:none; color:var(--text-3); font-size:22px; cursor:pointer; padding:6px; transition:all 0.25s; }
.del-btn:hover { color:#ef4444; transform:rotate(90deg) scale(1.4); }
.total-bar { background:linear-gradient(135deg,var(--accent),var(--gold)); border-radius:20px; padding:22px 24px; display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; box-shadow:0 8px 32px rgba(26,20,16,0.08); }
.total-label { font-size:14px; font-weight:800; color:rgba(255,255,255,0.95); letter-spacing:1.3px; text-transform:uppercase; }
.total-amount { font-size:32px; font-weight:900; color:#fff; letter-spacing:-1px; }
.btn-gen { width:100%; background:linear-gradient(135deg,var(--accent),var(--gold)); color:#fff; border:none; border-radius:16px; padding:18px 28px; font-size:16px; font-weight:900; text-transform:uppercase; letter-spacing:0.7px; cursor:pointer; transition:all 0.25s; box-shadow:0 4px 16px rgba(26,20,16,0.06); margin-top:8px; }
.btn-gen:hover { transform:translateY(-3px) scale(1.02); box-shadow:0 12px 48px rgba(26,20,16,0.12); }
.btn-gen:disabled { opacity:0.6; cursor:not-allowed; transform:none !important; }
.status { text-align:center; padding:15px 18px; border-radius:12px; font-size:13px; font-weight:600; margin-top:14px; display:none; }
.status.success { background:linear-gradient(135deg,#d1fae5,#a7f3d0); color:#065f46; border:1.5px solid #6ee7b7; display:block; }
.status.error { background:linear-gradient(135deg,#fee2e2,#fecaca); color:#991b1b; border:1.5px solid #fca5a5; display:block; }
.status.loading { background:linear-gradient(135deg,#dbeafe,#bfdbfe); color:#1e40af; border:1.5px solid #93c5fd; display:block; }
.page { display:none; }
.page.active { display:block; animation:enter 0.4s; }
.popup-overlay { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(26,20,16,0.75); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); z-index:9999; justify-content:center; align-items:center; }
.popup-overlay.active { display:flex; }
.popup-box { background:var(--glass); backdrop-filter:blur(30px) saturate(180%); -webkit-backdrop-filter:blur(30px) saturate(180%); border:1px solid var(--border); border-radius:24px; padding:26px; width:90%; max-width:560px; box-shadow:0 20px 60px rgba(26,20,16,0.25); animation:popup-appear 0.3s; max-height:85vh; overflow-y:auto; }
@keyframes popup-appear { from{opacity:0;transform:scale(0.9);} to{opacity:1;transform:scale(1);} }
.toast { position:fixed; top:110px; left:50%; transform:translateX(-50%) translateY(-120px); background:var(--glass); backdrop-filter:blur(24px) saturate(180%); border:1px solid var(--border); border-radius:16px; padding:16px 24px; font-size:14px; font-weight:600; box-shadow:0 20px 60px rgba(26,20,16,0.15); z-index:9999; opacity:0; transition:all 0.5s; display:flex; align-items:center; gap:12px; max-width:90%; }
.toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
.stat-card { background:var(--glass); backdrop-filter:blur(20px); border:1px solid var(--border); border-radius:20px; padding:24px; text-align:center; transition:all 0.25s; }
.stat-card:hover { transform:translateY(-4px); box-shadow:0 8px 32px rgba(26,20,16,0.08); }
.stat-value { font-size:36px; font-weight:900; color:var(--accent); letter-spacing:-1px; margin-bottom:8px; }
.stat-label { font-size:12px; font-weight:600; color:var(--text-2); text-transform:uppercase; letter-spacing:0.6px; }
.stat-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:16px; margin-bottom:24px; }
@media(min-width:768px){ .stat-grid{grid-template-columns:repeat(4,1fr);} }
.badge { display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:8px; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; }
.badge-success { background:rgba(16,185,129,0.15); color:var(--success); border:1px solid rgba(16,185,129,0.3); }
.badge-warning { background:rgba(245,158,11,0.15); color:var(--warning); border:1px solid rgba(245,158,11,0.3); }
.badge-info { background:rgba(59,130,246,0.15); color:#3b82f6; border:1px solid rgba(59,130,246,0.3); }
.badge-error { background:rgba(239,68,68,0.15); color:var(--error); border:1px solid rgba(239,68,68,0.3); }
.btn-small { background:rgba(212,165,116,0.15); color:var(--accent); border:1px solid rgba(212,165,116,0.3); border-radius:8px; padding:8px 16px; font-size:12px; font-weight:700; cursor:pointer; transition:all 0.15s; display:inline-flex; align-items:center; gap:6px; }
.btn-small:hover { background:var(--accent); color:#fff; transform:translateY(-2px); }
.data-table { width:100%; border-collapse:collapse; font-size:13px; }
.data-table th { background:linear-gradient(135deg,rgba(212,165,116,0.16),rgba(218,165,32,0.12)); color:var(--accent); font-weight:800; text-transform:uppercase; letter-spacing:0.6px; padding:14px 16px; text-align:left; border-bottom:2px solid var(--border); font-size:11px; }
.data-table td { padding:16px; border-bottom:1px solid rgba(218,165,32,0.08); }
.data-table tr:hover { background:rgba(255,255,255,0.4); }
.remise-bar { background:var(--glass); border:1.5px solid var(--border); border-radius:16px; padding:16px 18px; margin-bottom:12px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.remise-toggle { display:flex; background:rgba(255,255,255,0.6); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
.remise-toggle-btn { padding:8px 14px; font-size:12px; font-weight:700; cursor:pointer; color:var(--text-2); transition:all 0.2s; }
.remise-toggle-btn.active { background:linear-gradient(135deg,var(--accent),var(--gold)); color:#fff; }
.remise-input { width:90px; background:rgba(255,255,255,0.8); border:1.5px solid var(--accent); border-radius:10px; padding:8px 12px; font-size:15px; font-weight:800; color:var(--accent); text-align:center; outline:none; }
.remise-line { display:flex; justify-content:space-between; align-items:center; padding:8px 0; font-size:13px; color:var(--success); font-weight:700; }
.favoris-bar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
.favori-chip { display:flex; align-items:center; gap:6px; background:rgba(212,165,116,0.12); border:1px solid rgba(212,165,116,0.3); border-radius:20px; padding:6px 12px; cursor:pointer; font-size:12px; font-weight:700; color:var(--accent); transition:all 0.2s; }
.favori-chip:hover { background:rgba(212,165,116,0.25); }
.favori-chip-del { color:var(--text-3); cursor:pointer; font-size:14px; line-height:1; }
.favori-chip-del:hover { color:var(--error); }
.alerte-badge { display:inline-flex; align-items:center; gap:4px; background:rgba(239,68,68,0.12); color:var(--error); border:1px solid rgba(239,68,68,0.2); border-radius:8px; padding:3px 8px; font-size:11px; font-weight:700; }
.client-toggle { display:flex; background:rgba(255,255,255,0.6); border:1.5px solid var(--border); border-radius:12px; padding:4px; margin-bottom:16px; gap:4px; }
.client-toggle-btn { flex:1; padding:10px; text-align:center; font-size:13px; font-weight:700; border-radius:9px; cursor:pointer; transition:all 0.2s; color:var(--text-2); user-select:none; }
.client-toggle-btn.active { background:linear-gradient(135deg,var(--accent),var(--gold)); color:#fff; box-shadow:0 2px 8px rgba(212,165,116,0.3); }

/* ══ DATE INTERVENTION dans historique ══ */
.date-interv-input {
  border:1.5px solid rgba(218,165,32,0.25);
  border-radius:8px;
  padding:5px 8px;
  font-size:12px;
  background:rgba(255,255,255,0.7);
  color:var(--text);
  outline:none;
  cursor:pointer;
  max-width:130px;
  font-family:'Plus Jakarta Sans',sans-serif;
  transition:border-color 0.2s;
}
.date-interv-input:focus { border-color:var(--accent); background:rgba(255,255,255,0.95); }
[data-theme="dark"] .date-interv-input { background:rgba(255,255,255,0.08); color:#fff; }
</style>
</head>
<body data-theme="light">

<!-- ════════════ LOGIN SCREEN ════════════ -->
<div id="login-screen" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:linear-gradient(135deg,#1B2A4A 0%,#243660 50%,#1B2A4A 100%);z-index:99999;align-items:center;justify-content:center;">
  <div style="background:white;border-radius:24px;padding:40px;max-width:380px;width:90%;box-shadow:0 40px 80px rgba(0,0,0,0.4);text-align:center;">
    <div style="font-size:56px;margin-bottom:8px;">⚡</div>
    <div style="font-size:22px;font-weight:900;color:#1B2A4A;margin-bottom:4px;">SINELEC OS</div>
    <div style="font-size:13px;color:#888;margin-bottom:32px;">Paris & IDF — Accès sécurisé</div>
    <div id="login-error" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px;margin-bottom:16px;color:#dc2626;font-size:13px;font-weight:600;">❌ Mot de passe incorrect</div>
    <input id="login-password" type="password" placeholder="Mot de passe"
      style="width:100%;padding:16px;border:2px solid #e5e7eb;border-radius:14px;font-size:16px;outline:none;text-align:center;letter-spacing:4px;box-sizing:border-box;margin-bottom:16px;"
      onkeydown="if(event.key==='Enter') seConnecter()">
    <button onclick="seConnecter()" id="login-btn"
      style="width:100%;background:linear-gradient(135deg,#1B2A4A,#243660);color:white;border:none;border-radius:14px;padding:16px;font-size:15px;font-weight:800;cursor:pointer;">
      🔐 Connexion
    </button>
    <div style="margin-top:20px;color:#aaa;font-size:11px;">SINELEC EI — Accès réservé</div>
  </div>
</div>

<!-- ════════════ SIDEBAR DESKTOP ════════════ -->
<div class="sidebar">
  <div class="sidebar-logo">
    <div class="sidebar-logo-icon">⚡</div>
    <div class="sidebar-logo-text"><h1>SINELEC</h1><span>Paris & IDF</span></div>
  </div>
  <div class="sidebar-nav">
    <div class="sidebar-item" onclick="switchPage('depannage', this)" style="border:1.5px solid rgba(201,168,76,0.4);">
      <span class="sidebar-item-icon">⚡</span><span>Dépannage</span>
    </div>
    <div class="sidebar-item" onclick="switchPage('agenda', this)">
      <span class="sidebar-item-icon">📅</span><span>Agenda</span>
    </div>
    <div class="sidebar-item active" onclick="switchPage('devis', this)">
      <span class="sidebar-item-icon">📋</span><span>Devis</span>
    </div>
    <div class="sidebar-item" onclick="switchPage('facture', this)">
      <span class="sidebar-item-icon">💶</span><span>Facture</span>
    </div>
    <div class="sidebar-item" onclick="switchPage('dashboard', this)">
      <span class="sidebar-item-icon">📊</span><span>CA & Stats</span>
    </div>
    <div class="sidebar-item" onclick="switchPage('historique', this)">
      <span class="sidebar-item-icon">📋</span><span>Historique</span>
    </div>
    <div class="sidebar-item" onclick="switchPage('vocal', this)">
      <span class="sidebar-item-icon">🎙️</span><span>Script Vocal</span>
    </div>
    <div class="sidebar-item" onclick="switchPage('chat', this)">
      <span class="sidebar-item-icon">🤖</span><span>Chat AI</span>
    </div>
    <div class="sidebar-item" onclick="switchPage('dpe', this)">
      <span class="sidebar-item-icon">🏠</span><span>Analyse DPE</span>
    </div>
    <div class="sidebar-item" onclick="switchPage('rapport', this)">
      <span class="sidebar-item-icon">📸</span><span>Rapport</span>
    </div>
    <div class="sidebar-item" onclick="switchPage('clients', this)">
      <span class="sidebar-item-icon">👥</span><span>Clients</span>
    </div>
    <div class="sidebar-item" onclick="switchPage('sante', this)">
      <span class="sidebar-item-icon">🏥</span><span>Santé</span>
    </div>
    <div class="sidebar-item" onclick="switchPage('params', this)">
      <span class="sidebar-item-icon">⚙️</span><span>Paramètres</span>
    </div>
    <div class="sidebar-item" onclick="seDeconnecter()" style="margin-top:8px;color:#ef4444;">
      <span class="sidebar-item-icon">🚪</span><span>Déconnexion</span>
    </div>
  </div>
  <div class="sidebar-footer">
    <div style="font-size:11px;color:var(--text-3);font-weight:600;">Mode :</div>
    <div class="theme-toggle" onclick="toggleTheme()"><span id="theme-icon">🌙</span></div>
  </div>
</div>

<!-- ════════════ MOBILE TABS ════════════ -->
<div class="mobile-tabs">
  <div class="mobile-tabs-grid">
    <div class="mobile-tab active" onclick="switchPage('devis', this)">
      <div class="mobile-tab-icon">📋</div><div class="mobile-tab-label">Devis</div>
    </div>
    <div class="mobile-tab" onclick="switchPage('facture', this)">
      <div class="mobile-tab-icon">💶</div><div class="mobile-tab-label">Facture</div>
    </div>
    <div class="mobile-tab" onclick="switchPage('dashboard', this)">
      <div class="mobile-tab-icon">📊</div><div class="mobile-tab-label">CA</div>
    </div>
    <div class="mobile-tab" onclick="switchPage('historique', this)">
      <div class="mobile-tab-icon">📋</div><div class="mobile-tab-label">Histo</div>
    </div>
    <div class="mobile-tab" onclick="switchPageMenu()">
      <div class="mobile-tab-icon">⋮</div><div class="mobile-tab-label">Plus</div>
    </div>
  </div>
</div>

<div class="main-content">

<!-- ════════════ PAGE HISTORIQUE — CARTES MOBILES ════════════ -->
<div id="page-historique" class="page">
<div class="content" style="max-width:700px;">

  <!-- FILTRES -->
  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
    <button onclick="filtrerHistorique('tous')" id="filter-tous" class="btn-filter" style="flex:1;min-width:80px;background:linear-gradient(135deg,var(--accent),var(--gold));color:#fff;border:none;border-radius:12px;padding:12px 16px;font-size:13px;font-weight:700;cursor:pointer;">Tous</button>
    <button onclick="filtrerHistorique('devis')" id="filter-devis" class="btn-filter" style="flex:1;min-width:80px;background:rgba(59,130,246,0.1);color:#3b82f6;border:1px solid rgba(59,130,246,0.25);border-radius:12px;padding:12px 16px;font-size:13px;font-weight:700;cursor:pointer;">📋 Devis</button>
    <button onclick="filtrerHistorique('facture')" id="filter-facture" class="btn-filter" style="flex:1;min-width:80px;background:rgba(16,185,129,0.1);color:#10b981;border:1px solid rgba(16,185,129,0.25);border-radius:12px;padding:12px 16px;font-size:13px;font-weight:700;cursor:pointer;">💶 Factures</button>
  </div>

  <!-- LISTE CARTES -->
  <div id="histo-cards">
    <div class="panier-empty">Chargement...</div>
  </div>

</div>
</div>

<!-- ════════════ AUTRES PAGES (stubs — chargées dynamiquement) ════════════ -->
<div id="page-depannage" class="page"><div class="content"><div class="section"><div class="section-title">⚡ Dépannage Rapide</div><div id="dep-content"></div></div></div></div>
<div id="page-agenda" class="page"><div class="content" style="max-width:700px;"><div class="section"><div class="section-title">📅 Agenda</div><div id="agenda-liste"><div class="panier-empty">Chargement...</div></div></div></div></div>
<div id="page-devis" class="page active"><div class="content"><div class="section"><div class="section-title">📋 Nouveau Devis</div><div id="devis-content"></div></div></div></div>
<div id="page-facture" class="page"><div class="content"><div class="section"><div class="section-title">💶 Nouvelle Facture</div><div id="facture-content"></div></div></div></div>
<div id="page-dashboard" class="page"><div class="content" style="max-width:1000px;"><div class="stat-grid" style="margin-bottom:20px;"><div class="stat-card"><div class="stat-value" id="dash-mois-ca">0</div><div class="stat-label">CA Ce Mois (€)</div></div><div class="stat-card"><div class="stat-value" id="dash-annee-ca">0</div><div class="stat-label">CA Année (€)</div></div><div class="stat-card"><div class="stat-value" id="dash-devis-attente">0</div><div class="stat-label">Devis en attente (€)</div></div><div class="stat-card"><div class="stat-value" id="dash-panier-moyen">0</div><div class="stat-label">Panier moyen (€)</div></div></div><div class="section"><div class="section-title">📊 CA par mois</div><div style="position:relative;width:100%;height:220px;"><canvas id="chart-ca"></canvas></div></div><div class="section"><div class="section-title">⚡ Top prestations</div><div id="dash-top-prests"></div></div></div></div>
<div id="page-vocal" class="page"><div class="content"><div class="section"><div class="section-title">🎙️ Script Vocal IA</div><div id="vocal-content"></div></div></div></div>
<div id="page-chat" class="page"><div class="content"><div class="section"><div class="section-title">🤖 Chat AI</div><div id="chat-messages" style="min-height:200px;"></div><div style="display:flex;gap:10px;margin-top:16px;"><input type="text" id="chat-input" placeholder="Décris le chantier..." style="flex:1;background:rgba(255,255,255,0.65);border:1.5px solid rgba(218,165,32,0.15);border-radius:12px;padding:14px 16px;color:var(--text);font-size:15px;outline:none;" onkeypress="if(event.key==='Enter') envoyerMessage()"><button onclick="envoyerMessage()" style="background:linear-gradient(135deg,var(--accent),var(--gold));color:#fff;border:none;border-radius:12px;padding:14px 20px;font-weight:800;cursor:pointer;font-size:20px;">→</button></div></div></div></div>
<div id="page-dpe" class="page"><div class="content"><div class="section"><div class="section-title">🏠 Analyse DPE</div><div id="dpe-content"></div></div></div></div>
<div id="page-rapport" class="page"><div class="content"><div class="section"><div class="section-title">📸 Rapport d'intervention</div><div id="rapport-content"></div></div></div></div>
<div id="page-clients" class="page"><div class="content" style="max-width:900px;"><div class="section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><div class="section-title" style="margin-bottom:0;">👥 Clients</div><input type="text" id="clients-search" placeholder="🔍 Rechercher..." oninput="filtrerClients(this.value)" style="padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:rgba(255,255,255,0.7);font-size:13px;width:200px;"></div><div id="clients-list">Chargement...</div></div></div></div>
<div id="page-sante" class="page"><div class="content"><div class="section"><div style="display:flex;justify-content:space-between;align-items:center;"><div class="section-title" style="margin-bottom:0;">🏥 Santé Système</div><button onclick="verifierSante()" class="btn-small">🔄 Vérifier</button></div><div id="sante-global" style="background:rgba(255,255,255,0.5);border-radius:14px;padding:20px;margin:16px 0;text-align:center;"><div id="sante-global-icon" style="font-size:40px;">⏳</div><div id="sante-global-text" style="font-size:15px;font-weight:700;margin-top:8px;">Chargement...</div></div><div id="sante-services" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"></div></div></div></div>
<div id="page-params" class="page"><div class="content"><div class="section"><div class="section-title">⚙️ Grille tarifaire</div><div id="params-grid"></div><button onclick="sauvegarderPrix()" class="btn-gen" style="margin-top:16px;">💾 Sauvegarder</button></div></div></div>

</div><!-- fin main-content -->

<!-- BOUTON FLOTTANT LEAD -->
<button class="fab-lead" onclick="ouvrirLead()" title="Nouveau lead">📞</button>

<!-- POPUP LEAD -->
<div id="lead-overlay" class="popup-overlay" onclick="if(event.target===this)fermerLead()">
  <div style="background:var(--glass);backdrop-filter:blur(30px);border:1px solid var(--border);border-radius:20px;padding:24px;max-width:420px;width:92%;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-height:90vh;overflow-y:auto;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
      <div style="font-size:17px;font-weight:800;color:var(--accent);">📞 Nouveau lead</div>
      <button onclick="fermerLead()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-3);">×</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div class="input-group" style="margin-bottom:0;"><label>Prénom Nom</label><input type="text" id="lead-nom" placeholder="DUPONT Sophie" oninput="this.value=this.value.toUpperCase()"></div>
      <div class="input-group" style="margin-bottom:0;"><label>Téléphone</label><input type="tel" id="lead-tel" placeholder="06 12 34 56 78"></div>
    </div>
    <div class="input-group"><label>Adresse</label><input type="text" id="lead-adresse" placeholder="12 rue de la Paix, 75001 Paris" oninput="majWazeLead(this.value)"></div>
    <div class="input-group"><label>Type</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        <div class="lead-type-btn" data-type="depannage" onclick="selectLeadType(this,'depannage')" style="padding:8px;border-radius:10px;border:2px solid var(--accent);background:rgba(212,165,116,0.1);text-align:center;font-size:12px;font-weight:600;cursor:pointer;color:var(--accent);">⚡ Dépannage</div>
        <div class="lead-type-btn" data-type="devis" onclick="selectLeadType(this,'devis')" style="padding:8px;border-radius:10px;border:1px solid var(--border);background:var(--bg);text-align:center;font-size:12px;cursor:pointer;color:var(--text-2);">📋 Devis</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:10px;">
      <button onclick="setLeadMaintenant()" style="flex:1;padding:8px;border-radius:10px;border:1.5px solid #ef4444;background:rgba(239,68,68,0.08);color:#ef4444;font-size:12px;font-weight:700;cursor:pointer;">🔴 Maintenant</button>
      <button onclick="setLeadAujourdhui()" style="flex:1;padding:8px;border-radius:10px;border:1.5px solid var(--accent);background:rgba(212,165,116,0.08);color:var(--accent);font-size:12px;font-weight:700;cursor:pointer;">📅 Aujourd'hui</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
      <div class="input-group" style="margin-bottom:0;"><label>Date</label><input type="date" id="lead-date"></div>
      <div class="input-group" style="margin-bottom:0;"><label>Heure</label><input type="time" id="lead-heure" value="09:00"></div>
    </div>
    <div class="input-group"><label>Notes</label><textarea id="lead-notes" placeholder="Code accès, urgence..." style="min-height:60px;"></textarea></div>
    <div id="lead-waze-btn" style="display:none;margin-bottom:10px;">
      <button id="lead-waze-link" style="background:#1da462;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;width:100%;">🔵 Ouvrir dans Waze</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <button onclick="enregistrerLead(false)" style="padding:12px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,0.7);font-size:13px;font-weight:600;cursor:pointer;color:var(--text);">💾 Enregistrer</button>
      <button onclick="enregistrerLead(true)" style="padding:12px;border-radius:12px;border:none;background:var(--accent);font-size:13px;font-weight:700;cursor:pointer;color:#fff;">📋 + Devis</button>
    </div>
  </div>
</div>

<!-- POPUP SIGNATURE -->
<div class="popup-overlay" id="popup-signature">
  <div class="popup-box">
    <h3 style="font-size:19px;font-weight:800;color:var(--accent);margin-bottom:10px;">✍️ Signature client sur place</h3>
    <p style="font-size:13px;color:var(--text-2);margin-bottom:18px;">Le client signe avec le doigt :</p>
    <canvas id="popup-sig-canvas" width="500" height="160" style="width:100%;height:160px;background:#fff;border-radius:12px;border:2px dashed var(--border);cursor:crosshair;touch-action:none;display:block;"></canvas>
    <div style="display:flex;gap:12px;margin-top:18px;">
      <button onclick="effacerPopupSig()" style="flex:1;padding:15px;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;background:rgba(255,255,255,0.6);color:var(--text-2);">↺ Effacer</button>
      <button onclick="fermerPopupSig()" style="flex:1;padding:15px;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;background:rgba(255,255,255,0.6);color:var(--text-2);">Passer</button>
      <button onclick="validerPopupSig()" style="flex:1;padding:15px;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,var(--accent),var(--gold));color:#fff;">✅ Valider</button>
    </div>
    <div id="popup-sig-status" style="margin-top:10px;font-size:12px;text-align:center;color:var(--text-2);"></div>
  </div>
</div>

<!-- MODE POPUP FACTURATION -->
<div class="popup-overlay" id="mode-popup-overlay" onclick="if(event.target===this)fermerModePopup()" style="align-items:flex-end;">
  <div style="background:var(--bg);border-radius:24px 24px 0 0;padding:24px 20px 40px;width:100%;max-width:500px;">
    <div style="font-size:16px;font-weight:800;color:var(--text);margin-bottom:6px;" id="mode-popup-nom"></div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:20px;" id="mode-popup-detail"></div>
    <button onclick="choisirMode('forfait')" style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.7);border:1.5px solid var(--border);border-radius:14px;padding:16px 18px;margin-bottom:10px;cursor:pointer;width:100%;">
      <div style="display:flex;align-items:center;gap:12px;"><span style="font-size:22px;">📦</span><div><div style="font-size:14px;font-weight:700;">Forfait tout compris</div><div style="font-size:11px;color:var(--text-3);">MO + fourniture + raccordement</div></div></div>
      <span style="font-size:16px;font-weight:900;color:var(--accent);" id="mode-prix-forfait">—</span>
    </button>
    <button id="mode-btn-fourniture" onclick="choisirMode('fourniture')" style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.7);border:1.5px solid var(--border);border-radius:14px;padding:16px 18px;margin-bottom:10px;cursor:pointer;width:100%;">
      <div style="display:flex;align-items:center;gap:12px;"><span style="font-size:22px;">🔩</span><div><div style="font-size:14px;font-weight:700;">Fourniture seule</div></div></div>
      <span style="font-size:16px;font-weight:900;color:var(--accent);" id="mode-prix-fourniture">—</span>
    </button>
    <button id="mode-btn-mo" onclick="choisirMode('mo')" style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.7);border:1.5px solid var(--border);border-radius:14px;padding:16px 18px;margin-bottom:10px;cursor:pointer;width:100%;">
      <div style="display:flex;align-items:center;gap:12px;"><span style="font-size:22px;">👷</span><div><div style="font-size:14px;font-weight:700;">Main d'œuvre seule</div></div></div>
      <span style="font-size:16px;font-weight:900;color:var(--accent);" id="mode-prix-mo">—</span>
    </button>
    <button onclick="fermerModePopup()" style="width:100%;background:none;border:none;color:var(--text-3);font-size:14px;font-weight:600;cursor:pointer;margin-top:8px;padding:10px;">Annuler</button>
  </div>
</div>

<script>
// ═══════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════
const TOKEN_KEY = 'sinelec_token';
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function saveToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

const _originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
  const token = getToken();
  if (token && typeof url === 'string' && url.startsWith('/api/') && !url.startsWith('/api/login')) {
    options.headers = options.headers || {};
    options.headers['Authorization'] = `Bearer ${token}`;
    return _originalFetch(url, options).then(res => {
      if (res.status === 401) { clearToken(); afficherLogin(); }
      return res;
    });
  }
  return _originalFetch(url, options);
};

async function seConnecter() {
  const pwd = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  if (!pwd) return;
  btn.disabled = true; btn.textContent = '⏳ Connexion...'; errEl.style.display = 'none';
  try {
    const res = await _originalFetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: pwd }) });
    const data = await res.json();
    if (data.success && data.token) { saveToken(data.token); masquerLogin(); initialiserApp(); }
    else { errEl.style.display = 'block'; document.getElementById('login-password').value = ''; document.getElementById('login-password').focus(); }
  } catch(e) { errEl.textContent = '❌ Erreur réseau'; errEl.style.display = 'block'; }
  btn.disabled = false; btn.textContent = '🔐 Connexion';
}

function afficherLogin() { document.getElementById('login-screen').style.display = 'flex'; setTimeout(() => document.getElementById('login-password')?.focus(), 100); }
function masquerLogin() { document.getElementById('login-screen').style.display = 'none'; }
function seDeconnecter() { clearToken(); afficherLogin(); }

async function verifierAuth() {
  const token = getToken();
  if (!token) { afficherLogin(); return false; }
  try {
    const res = await _originalFetch('/api/auth/check', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (!data.valid) { clearToken(); afficherLogin(); return false; }
    return true;
  } catch(e) { afficherLogin(); return false; }
}

function initialiserApp() {
  masquerLogin();
  chargerHistorique();
  chargerDashboard();
}

window.addEventListener('DOMContentLoaded', async () => {
  const ok = await verifierAuth();
  if (ok) initialiserApp();
});

// ═══════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════
function toggleTheme() {
  const body = document.body;
  const icon = document.getElementById('theme-icon');
  const newTheme = body.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  body.setAttribute('data-theme', newTheme);
  icon.textContent = newTheme === 'light' ? '🌙' : '☀️';
  localStorage.setItem('sinelec-theme', newTheme);
  showToast(newTheme === 'dark' ? '🌙 Mode sombre' : '☀️ Mode clair');
}
const savedTheme = localStorage.getItem('sinelec-theme') || 'light';
document.body.setAttribute('data-theme', savedTheme);
document.addEventListener('DOMContentLoaded', () => {
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = savedTheme === 'light' ? '🌙' : '☀️';
});

// ═══════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════
function showToast(message, icon = '✓') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span style="font-size:20px;">${icon}</span><span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 500); }, 2500);
}

function shootConfetti() {
  if (typeof confetti === 'function') confetti({ particleCount:100, spread:70, origin:{y:0.6}, colors:['#d4a574','#daa520','#b8936a'] });
}

// ═══════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════
function switchPage(page, el) {
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) { pageEl.classList.add('active'); pageEl.scrollTop = 0; }
  const mc = document.querySelector('.main-content');
  if (mc) mc.scrollTop = 0;
  window.scrollTo(0, 0);
  setTimeout(() => { window.scrollTo(0, 0); if (pageEl) pageEl.scrollIntoView({ behavior:'instant', block:'start' }); }, 50);
  if (page === 'historique') setTimeout(chargerHistorique, 100);
  if (page === 'dashboard') setTimeout(chargerDashboard, 100);
  if (page === 'clients') setTimeout(chargerClients, 100);
  if (page === 'params') setTimeout(afficherParams, 100);
  if (page === 'sante') setTimeout(chargerSante, 100);
  if (page === 'agenda') setTimeout(chargerAgenda, 100);
}

let menuPlusOpen = false;
function switchPageMenu() {
  if (menuPlusOpen) return;
  menuPlusOpen = true;
  const menu = document.createElement('div');
  menu.style.cssText = 'position:fixed;bottom:70px;right:10px;background:var(--glass);backdrop-filter:blur(24px);border:1px solid var(--border);border-radius:16px;padding:12px;z-index:999;box-shadow:0 8px 32px rgba(26,20,16,0.15);';
  const pages = [['agenda','📅','Agenda'],['chat','🤖','Chat AI'],['rapport','📸','Rapport'],['clients','👥','Clients'],['depannage','⚡','Dépannage'],['params','⚙️','Paramètres']];
  menu.innerHTML = pages.map(([p,i,l]) =>
    `<div onclick="switchPage('${p}',this);this.closest('[style*=fixed]').remove();menuPlusOpen=false;" style="padding:12px 20px;border-radius:10px;background:rgba(255,255,255,0.5);cursor:pointer;font-size:14px;font-weight:600;display:flex;align-items:center;gap:10px;margin-bottom:4px;">
      <span>${i}</span> ${l}
    </div>`).join('') +
    `<div onclick="seDeconnecter()" style="padding:12px 20px;border-radius:10px;background:rgba(239,68,68,0.08);cursor:pointer;font-size:14px;font-weight:600;display:flex;align-items:center;gap:10px;color:#ef4444;margin-top:4px;"><span>🚪</span> Déconnexion</div>`;
  document.body.appendChild(menu);
  setTimeout(() => {
    const close = e => { if (!menu.contains(e.target)) { menu.remove(); menuPlusOpen = false; document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 100);
}

// ═══════════════════════════════════════════════════
// AUTOCOMPLETE ADRESSE
// ═══════════════════════════════════════════════════
async function autocompleteAdresse(id, value) {
  if (!value || value.length < 3) { document.getElementById(`${id}-suggestions`).style.display = 'none'; return; }
  try {
    const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(value)}&limit=8&autocomplete=1`);
    const data = await res.json();
    const idf = ['75','77','78','91','92','93','94','95'];
    const results = (data.features || []).filter(item => idf.some(d => (item.properties?.postcode||'').startsWith(d)));
    const suggestionsDiv = document.getElementById(`${id}-suggestions`);
    if (!results.length) { suggestionsDiv.style.display = 'none'; return; }
    suggestionsDiv.innerHTML = '';
    suggestionsDiv.style.display = 'block';
    results.forEach(item => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:12px 16px;cursor:pointer;font-size:14px;color:var(--text);border-bottom:1px solid var(--border);';
      div.textContent = item.properties.label;
      div.onmouseover = () => div.style.background = 'rgba(212,165,116,0.1)';
      div.onmouseout = () => div.style.background = '';
      div.onclick = () => { document.getElementById(id).value = item.properties.label; suggestionsDiv.style.display = 'none'; };
      suggestionsDiv.appendChild(div);
    });
  } catch(e) {}
}

// ═══════════════════════════════════════════════════
// HISTORIQUE — CARTES MOBILES + STATUTS CLAIRS
// ═══════════════════════════════════════════════════
let historiqueData = [];
let histoFiltreActif = 'tous';

async function chargerHistorique() {
  const container = document.getElementById('histo-cards');
  if (container) container.innerHTML = '<div class="panier-empty">Chargement...</div>';
  try {
    const res = await fetch('/api/ca-complet');
    historiqueData = await res.json();
    afficherHistorique();
  } catch(e) {
    if (container) container.innerHTML = `<div class="panier-empty" style="color:var(--error);">❌ Erreur chargement</div>`;
  }
}

function filtrerHistorique(type) {
  histoFiltreActif = type;
  // Reset tous les boutons filtres
  document.querySelectorAll('.btn-filter').forEach(btn => {
    btn.style.background = 'rgba(255,255,255,0.6)';
    btn.style.color = 'var(--text-2)';
    btn.style.border = '1px solid var(--border)';
  });
  // Activer le bouton sélectionné
  const activeBtn = document.getElementById(`filter-${type}`);
  if (activeBtn) {
    activeBtn.style.background = 'linear-gradient(135deg,var(--accent),var(--gold))';
    activeBtn.style.color = '#fff';
    activeBtn.style.border = 'none';
  }
  afficherHistorique();
}

function afficherHistorique() {
  const container = document.getElementById('histo-cards');
  if (!container) return;

  let filtered = historiqueData;
  if (histoFiltreActif !== 'tous') filtered = historiqueData.filter(item => item.type === histoFiltreActif);

  if (filtered.length === 0) {
    container.innerHTML = `<div class="panier-empty">Aucun document trouvé</div>`;
    return;
  }

  filtered.sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date));

  container.innerHTML = filtered.map(item => {
    const statut = (item.statut || '').toLowerCase();
    const type = item.type || 'facture';
    const isObat = item.source === 'obat';
    const montant = parseFloat(item.total_ht || item.totalht || 0).toFixed(0);
    const timeline = getTimeline(item.created_at || item.date);
    const dateInterv = item.date_intervention || '';
    const ageHeures = (new Date() - new Date(item.created_at || item.date)) / 3600000;
    const alerte = type === 'devis' && (statut === 'envoyé' || statut === 'envoye') && ageHeures > 48;

    // ── STATUT BADGE ──────────────────────────────────────────
    let statutBg, statutColor, statutLabel, statutIcon;
    if (type === 'devis') {
      if (statut === 'signe' || statut === 'signé') {
        statutBg = '#f0fdf4'; statutColor = '#16a34a';
        statutIcon = '✅'; statutLabel = 'Signé';
      } else if (statut === 'facture') {
        statutBg = '#eff6ff'; statutColor = '#3b82f6';
        statutIcon = '→'; statutLabel = 'Facturé';
      } else {
        // NON SIGNÉ
        statutBg = alerte ? '#fef2f2' : '#fefce8';
        statutColor = alerte ? '#dc2626' : '#ca8a04';
        statutIcon = alerte ? '⚠️' : '⏳';
        statutLabel = alerte ? 'En attente +48h' : 'Non signé';
      }
    } else {
      // FACTURE
      if (statut === 'paye' || statut === 'payé' || statut === 'payée') {
        statutBg = '#f0fdf4'; statutColor = '#16a34a';
        statutIcon = '💰'; statutLabel = 'Payée';
      } else {
        statutBg = '#fff7ed'; statutColor = '#ea580c';
        statutIcon = '⏳'; statutLabel = 'En attente';
      }
    }

    // ── TYPE BADGE ────────────────────────────────────────────
    const typeBg = type === 'devis' ? 'rgba(59,130,246,0.1)' : 'rgba(16,185,129,0.1)';
    const typeColor = type === 'devis' ? '#3b82f6' : '#10b981';
    const typeLabel = type === 'devis' ? '📋 Devis' : '💶 Facture';

    // ── ACTIONS ───────────────────────────────────────────────
    let actions = '';
    if (!isObat) {
      if (type === 'devis') {
        actions += `<button onclick="convertirEnFacture('${item.num}')" class="btn-small" style="background:rgba(16,185,129,0.12);color:#10b981;border-color:rgba(16,185,129,0.3);">→ Facture</button>`;
        actions += `<button onclick="ouvrirPopupSig('${item.num}')" class="btn-small">✍️ Signer</button>`;
      }
      actions += `<button onclick="telechargerPDF('${item.num}')" class="btn-small">⬇️ PDF</button>`;
      actions += `<button onclick="dupliquerDoc('${item.num}')" class="btn-small">📋 Dupliquer</button>`;
      if (type === 'facture' && statut !== 'paye' && statut !== 'payé' && statut !== 'payée') {
        actions += `<button onclick="marquerPaye('${item.num}','terminal')" class="btn-small" style="background:rgba(99,102,241,0.12);color:#6366f1;border-color:rgba(99,102,241,0.3);" title="CB Terminal SumUp">💳 Terminal</button>`;
        actions += `<button onclick="marquerPaye('${item.num}','virement')" class="btn-small" style="background:rgba(16,185,129,0.1);color:#10b981;" title="Virement">🏦 Virement</button>`;
        actions += `<button onclick="marquerPaye('${item.num}','especes')" class="btn-small" title="Espèces">💶 Espèces</button>`;
        actions += `<button onclick="genererLienPaiement('${item.num}')" class="btn-small" style="background:rgba(16,185,129,0.1);color:#10b981;" title="Lien paiement SumUp">🔗 Lien CB</button>`;
      }
      actions += `<button onclick="supprimerDoc('${item.num}')" class="btn-small" style="background:rgba(239,68,68,0.1);color:#ef4444;border-color:rgba(239,68,68,0.2);">🗑️</button>`;
    }

    return `
    <div style="background:var(--glass);backdrop-filter:blur(20px);border:1.5px solid ${alerte ? 'rgba(220,38,38,0.3)' : 'var(--border)'};border-radius:16px;padding:16px;margin-bottom:12px;transition:all 0.2s;">

      <!-- LIGNE 1 : Numéro + Montant -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:15px;font-weight:800;color:var(--accent);">${item.num}</span>
            <span style="background:${typeBg};color:${typeColor};border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;">${typeLabel}</span>
            ${isObat ? `<span style="background:rgba(107,114,128,0.1);color:var(--text-3);border-radius:6px;padding:2px 8px;font-size:10px;font-weight:600;">Obat</span>` : ''}
          </div>
          <div style="font-size:14px;font-weight:600;color:var(--text);margin-top:4px;">${item.client || '—'}</div>
        </div>
        <div style="font-size:20px;font-weight:900;color:var(--accent);white-space:nowrap;">${montant} €</div>
      </div>

      <!-- LIGNE 2 : Statut + Date -->
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <span style="background:${statutBg};color:${statutColor};border-radius:8px;padding:5px 12px;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:4px;">
          ${statutIcon} ${statutLabel}
        </span>
        <span style="font-size:12px;color:var(--text-3);">📅 ${timeline}</span>
      </div>

      <!-- LIGNE 3 : Date intervention -->
      ${!isObat ? `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        <span style="font-size:12px;color:var(--text-3);font-weight:600;white-space:nowrap;">🔧 Intervention :</span>
        <input type="date" value="${dateInterv}"
          onchange="majDateIntervention('${item.num}', this.value)"
          class="date-interv-input"
          title="Date d'intervention réelle"
          style="font-size:13px;padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;background:rgba(255,255,255,0.7);color:var(--text);outline:none;cursor:pointer;">
        ${dateInterv ? `<span style="font-size:11px;color:#10b981;font-weight:600;">✓</span>` : `<span style="font-size:11px;color:var(--text-3);">à planifier</span>`}
      </div>` : ''}

      <!-- LIGNE 4 : Actions -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${actions}
      </div>

    </div>`;
  }).join('');
}

// ─── DATE INTERVENTION ────────────────────────────────────────
async function majDateIntervention(num, date) {
  try {
    const res = await fetch('/api/historique/' + num + '/statut', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date_intervention: date || null })
    });
    const data = await res.json();
    if (data.success) {
      showToast('📅 Date intervention enregistrée', '✅');
      // Mettre à jour en local sans rechargement
      const item = historiqueData.find(i => i.num === num);
      if (item) item.date_intervention = date || null;
    }
  } catch(e) {
    showToast('❌ Erreur mise à jour date', '⚠️');
  }
}

function getStatusBadge(statut, type) {
  const s = (statut || '').toLowerCase();
  const badges = {
    'signe': '<span class="badge badge-success">✓ Signé</span>',
    'signé': '<span class="badge badge-success">✓ Signé</span>',
    'envoyé': '<span class="badge badge-info">✉ Envoyé</span>',
    'envoye': '<span class="badge badge-info">✉ Envoyé</span>',
    'payée': '<span class="badge badge-success">✓ Payée</span>',
    'paye': '<span class="badge badge-success">✓ Payée</span>',
    'payé': '<span class="badge badge-success">✓ Payée</span>',
    'relancé': '<span class="badge badge-warning">🔄 Relancé</span>',
    'facture': '<span class="badge badge-info">→ Facturé</span>',
  };
  return badges[s] || `<span style="color:var(--text-3);font-size:12px;">${statut}</span>`;
}

function getTimeline(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 3600) return `il y a ${Math.floor(diff/60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff/3600)}h`;
  if (diff < 604800) return `il y a ${Math.floor(diff/86400)} j`;
  return d.toLocaleDateString('fr-FR');
}

async function supprimerDoc(num) {
  const ok = await new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    ov.innerHTML = `<div style="background:white;border-radius:20px;padding:28px;max-width:320px;width:88%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="font-size:40px;margin-bottom:12px;">🗑️</div>
      <div style="font-size:16px;font-weight:800;color:#1B2A4A;margin-bottom:20px;">Supprimer ${num} ?</div>
      <button id="sup-oui" style="width:100%;background:#ef4444;color:white;border:none;border-radius:12px;padding:14px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:10px;">Supprimer</button>
      <button id="sup-non" style="width:100%;background:none;border:1px solid #eee;border-radius:12px;padding:12px;font-size:13px;color:#888;cursor:pointer;">Annuler</button>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#sup-oui').onclick = () => { document.body.removeChild(ov); resolve(true); };
    ov.querySelector('#sup-non').onclick = () => { document.body.removeChild(ov); resolve(false); };
  });
  if (!ok) return;
  try {
    const res = await fetch('/api/historique/' + num, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { showToast('🗑️ Supprimé', '✅'); chargerHistorique(); }
  } catch(e) { showToast('❌ Erreur suppression', '⚠️'); }
}

async function convertirEnFacture(numDevis) {
  if (!confirm(`Convertir le devis ${numDevis} en facture ?`)) return;
  const devis = historiqueData.find(item => item.num === numDevis);
  if (!devis) return;
  showToast('⏳ Génération facture...', '💶');
  try {
    const res = await fetch('/api/generer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type:'facture', client:devis.client||'', prenom:devis.prenom||'', email:devis.email||'', telephone:devis.telephone||'', adresse:devis.adresse||'', description:devis.description||'Travaux électricité', prestations:devis.prestations||[] })
    });
    const data = await res.json();
    if (data.success) {
      await fetch('/api/historique/' + numDevis + '/statut', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ statut:'facture' }) });
      shootConfetti();
      showToast(`✅ Facture ${data.num} créée !`, '🎉');
      setTimeout(chargerHistorique, 1500);
    } else showToast('❌ ' + (data.error || 'Erreur'), '⚠️');
  } catch(e) { showToast('❌ Erreur', '⚠️'); }
}

async function marquerPaye(num, mode) {
  const labels = { terminal:'CB Terminal SumUp', virement:'Virement bancaire', especes:'Espèces' };
  if (!confirm(`Confirmer paiement ${labels[mode]} pour ${num} ?`)) return;
  showToast('⏳ Enregistrement...', '💰');
  try {
    const res = await fetch('/api/marquer-paye', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ num, mode_paiement:mode }) });
    const data = await res.json();
    if (data.success) { showToast(`✅ Paiement ${labels[mode]} enregistré !`, '💰'); setTimeout(chargerHistorique, 1500); }
    else showToast('❌ ' + data.error, '⚠️');
  } catch(e) { showToast('❌ Erreur', '⚠️'); }
}

async function genererLienPaiement(num) {
  const choix = await new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    ov.innerHTML = `<div style="background:white;border-radius:20px;padding:28px;max-width:340px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="font-size:20px;font-weight:800;color:#1B2A4A;margin-bottom:16px;text-align:center;">💳 Lien de paiement</div>
      <button id="c-sms" style="width:100%;background:#1B2A4A;color:white;border:none;border-radius:12px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:8px;">📱 SMS</button>
      <button id="c-email" style="width:100%;background:#C9A84C;color:white;border:none;border-radius:12px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:8px;">📧 Email</button>
      <button id="c-les2" style="width:100%;background:rgba(16,185,129,0.1);color:#10b981;border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:12px;">📱 + 📧 Les deux</button>
      <button id="c-ann" style="width:100%;background:none;border:1px solid #eee;border-radius:12px;padding:10px;font-size:13px;color:#888;cursor:pointer;">Annuler</button>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#c-sms').onclick = () => { document.body.removeChild(ov); resolve('sms'); };
    ov.querySelector('#c-email').onclick = () => { document.body.removeChild(ov); resolve('email'); };
    ov.querySelector('#c-les2').onclick = () => { document.body.removeChild(ov); resolve('les2'); };
    ov.querySelector('#c-ann').onclick = () => { document.body.removeChild(ov); resolve(null); };
  });
  if (!choix) return;
  showToast('⏳ Génération lien...', '💳');
  try {
    const res = await fetch('/api/sumup/lien/' + num + '?envoi=' + choix, { method:'POST' });
    const data = await res.json();
    if (data.success) {
      if (navigator.clipboard) await navigator.clipboard.writeText(data.lien).catch(() => {});
      showToast('💳 Lien généré et envoyé !', '✅');
    } else showToast('❌ ' + (data.error || 'Erreur SumUp'), '⚠️');
  } catch(e) { showToast('❌ ' + e.message, '⚠️'); }
}

async function dupliquerDoc(num) {
  const original = historiqueData.find(d => d.num === num);
  if (!original) return;
  showToast('⏳ Duplication...', '📋');
  try {
    const res = await fetch('/api/generer', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ type:original.type||'devis', client:original.client||'', prenom:original.prenom||'', email:original.email||'', telephone:original.telephone||'', adresse:original.adresse||'', description:original.description||'', prestations:original.prestations||[] })
    });
    const data = await res.json();
    if (data.success) { showToast(`✅ Dupliqué → ${data.num}`, '📋'); setTimeout(chargerHistorique, 1000); }
    else showToast('❌ ' + (data.error || 'Erreur'), '⚠️');
  } catch(e) { showToast('❌ ' + e.message, '⚠️'); }
}

async function telechargerPDF(num) {
  showToast('⏳ Génération PDF...', '📄');
  try {
    const res = await fetch(`/api/pdf/${num}`);
    if (!res.ok) throw new Error('PDF non disponible');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${num}.pdf`; a.click();
    URL.revokeObjectURL(url);
    showToast('✅ PDF téléchargé !', '📥');
  } catch(e) { showToast('❌ ' + e.message, '⚠️'); }
}

// ─── POPUP SIGNATURE ──────────────────────────────────────────
let popupSigCanvas, popupSigCtx, popupIsDrawing = false;
let currentDevisNum = null;

function ouvrirPopupSig(numDevis) {
  currentDevisNum = numDevis;
  document.getElementById('popup-signature').classList.add('active');
  setTimeout(() => {
    popupSigCanvas = document.getElementById('popup-sig-canvas');
    if (!popupSigCanvas) return;
    popupSigCtx = popupSigCanvas.getContext('2d');
    popupSigCtx.strokeStyle = '#111'; popupSigCtx.lineWidth = 2; popupSigCtx.lineCap = 'round';
    const getPos = e => { const r = popupSigCanvas.getBoundingClientRect(); const sx = popupSigCanvas.width/r.width; const sy = popupSigCanvas.height/r.height; return e.touches ? {x:(e.touches[0].clientX-r.left)*sx, y:(e.touches[0].clientY-r.top)*sy} : {x:(e.clientX-r.left)*sx, y:(e.clientY-r.top)*sy}; };
    popupSigCanvas.addEventListener('mousedown', e => { popupIsDrawing=true; popupSigCtx.beginPath(); const p=getPos(e); popupSigCtx.moveTo(p.x,p.y); });
    popupSigCanvas.addEventListener('mousemove', e => { if(!popupIsDrawing) return; const p=getPos(e); popupSigCtx.lineTo(p.x,p.y); popupSigCtx.stroke(); });
    popupSigCanvas.addEventListener('mouseup', () => popupIsDrawing=false);
    popupSigCanvas.addEventListener('touchstart', e => { e.preventDefault(); popupIsDrawing=true; popupSigCtx.beginPath(); const p=getPos(e); popupSigCtx.moveTo(p.x,p.y); }, {passive:false});
    popupSigCanvas.addEventListener('touchmove', e => { e.preventDefault(); if(!popupIsDrawing) return; const p=getPos(e); popupSigCtx.lineTo(p.x,p.y); popupSigCtx.stroke(); }, {passive:false});
    popupSigCanvas.addEventListener('touchend', () => popupIsDrawing=false);
  }, 100);
}

function effacerPopupSig() { if(popupSigCtx && popupSigCanvas) popupSigCtx.clearRect(0,0,popupSigCanvas.width,popupSigCanvas.height); }
function fermerPopupSig() { document.getElementById('popup-signature').classList.remove('active'); currentDevisNum=null; }

async function validerPopupSig() {
  if (!popupSigCanvas || !currentDevisNum) return;
  try {
    const res = await fetch('/api/signature', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ num:currentDevisNum, signature:popupSigCanvas.toDataURL('image/png') }) });
    const data = await res.json();
    if (data.success) { showToast('✅ Signature enregistrée !', '✍️'); fermerPopupSig(); chargerHistorique(); }
    else document.getElementById('popup-sig-status').textContent = '❌ Erreur';
  } catch(e) { document.getElementById('popup-sig-status').textContent = '❌ ' + e.message; }
}

// ═══════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════
let chartCA = null;

async function chargerDashboard() {
  try {
    const res = await fetch('/api/ca-complet');
    const data = await res.json();
    const now = new Date();
    const annee = now.getFullYear();
    const moisCourant = `${annee}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const factures = data.filter(d => d.type === 'facture');
    factures.forEach(f => { if (!f.created_at && f.date_facture) f.created_at = f.date_facture + 'T00:00:00.000Z'; });
    const devis = data.filter(d => d.type === 'devis');
    const facMois = factures.filter(f => (f.created_at||'').startsWith(moisCourant));
    const caMois = facMois.reduce((s,f) => s+parseFloat(f.total_ht||0), 0);
    const caAnnee = factures.filter(f => (f.created_at||'').startsWith(annee.toString())).reduce((s,f) => s+parseFloat(f.total_ht||0), 0);
    const caAttente = devis.filter(d => d.statut==='envoyé'||d.statut==='envoye').reduce((s,d) => s+parseFloat(d.total_ht||0), 0);
    const panierMoyen = factures.length > 0 ? caAnnee / factures.filter(f=>(f.created_at||'').startsWith(annee.toString())).length : 0;
    document.getElementById('dash-mois-ca').textContent = Math.round(caMois).toLocaleString('fr-FR');
    document.getElementById('dash-annee-ca').textContent = Math.round(caAnnee).toLocaleString('fr-FR');
    document.getElementById('dash-devis-attente').textContent = Math.round(caAttente).toLocaleString('fr-FR');
    document.getElementById('dash-panier-moyen').textContent = Math.round(panierMoyen).toLocaleString('fr-FR');
    // Graphique 6 mois
    const labels=[], vals=[];
    for(let i=5;i>=0;i--){
      const d=new Date(now.getFullYear(),now.getMonth()-i,1);
      const mKey=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      labels.push(d.toLocaleDateString('fr-FR',{month:'short'}));
      vals.push(Math.round(factures.filter(f=>(f.created_at||'').startsWith(mKey)).reduce((s,f)=>s+parseFloat(f.total_ht||0),0)));
    }
    if (chartCA) { chartCA.destroy(); chartCA=null; }
    const ctx = document.getElementById('chart-ca')?.getContext('2d');
    if (ctx) {
      chartCA = new Chart(ctx, { type:'bar', data:{ labels, datasets:[{label:'CA facturé',data:vals,backgroundColor:'#d4a574',borderRadius:6}] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{ticks:{color:'#9d8f7f',font:{size:11}},grid:{display:false},border:{display:false}}, y:{ticks:{color:'#9d8f7f',font:{size:11},callback:v=>v.toLocaleString('fr-FR')+'€'},grid:{color:'rgba(218,165,32,0.08)'},border:{display:false}} } } });
    }
    // Top prestations
    const prestMap={};
    factures.forEach(f => { (f.prestations||[]).forEach(p => { const nom=p.nom||p.designation||''; if(!nom) return; prestMap[nom]=(prestMap[nom]||{nb:0,ca:0}); prestMap[nom].nb++; prestMap[nom].ca+=parseFloat(p.prix||0)*(p.quantite||1); }); });
    const prestSort=Object.entries(prestMap).sort((a,b)=>b[1].ca-a[1].ca).slice(0,5);
    const maxP=prestSort[0]?.[1].ca||1;
    document.getElementById('dash-top-prests').innerHTML = prestSort.length>0 ? prestSort.map(([nom,v])=>`<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;"><div style="font-size:12px;color:var(--text-2);width:170px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${nom} <span style="color:var(--text-3);">×${v.nb}</span></div><div style="flex:1;height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${Math.round((v.ca/maxP)*100)}%;background:linear-gradient(90deg,#1B2A4A,var(--accent));border-radius:4px;"></div></div><div style="font-size:12px;font-weight:700;color:var(--accent);width:65px;text-align:right;">${Math.round(v.ca).toLocaleString('fr-FR')} €</div></div>`).join('') : '<div style="color:var(--text-3);text-align:center;padding:20px;">Aucune facture</div>';
  } catch(e) { console.error('Dashboard:', e); }
}

// ═══════════════════════════════════════════════════
// AGENDA
// ═══════════════════════════════════════════════════
let agendaInterventions = [];

async function chargerAgenda() {
  const liste = document.getElementById('agenda-liste');
  if (liste) liste.innerHTML = '<div class="panier-empty">Chargement...</div>';
  try {
    const res = await fetch('/api/agenda');
    agendaInterventions = await res.json();
    afficherListeAgenda();
  } catch(e) { if (liste) liste.innerHTML = `<div class="panier-empty" style="color:var(--error);">❌ ${e.message}</div>`; }
}

function afficherListeAgenda() {
  const liste = document.getElementById('agenda-liste');
  if (!liste) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = today.toISOString().split('T')[0];
  const intervs = agendaInterventions.filter(iv => (iv.date_intervention||'') >= todayStr).sort((a,b) => (a.date_intervention+'T'+(a.heure||'00:00')).localeCompare(b.date_intervention+'T'+(b.heure||'00:00')));
  if (intervs.length === 0) { liste.innerHTML = '<div class="panier-empty">Aucune intervention à venir</div>'; return; }
  liste.innerHTML = intervs.map(iv => {
    const nom = iv.client || `${iv.prenom||''} ${iv.nom||''}`.trim() || 'Client';
    const adresseEnc = iv.adresse ? encodeURIComponent(iv.adresse) : '';
    return `
    <div style="background:var(--glass);backdrop-filter:blur(20px);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div><div style="font-size:15px;font-weight:700;">${nom}</div>${iv.adresse?`<div style="font-size:12px;color:var(--text-3);">${iv.adresse}</div>`:''}</div>
        <span class="badge badge-info">${iv.statut||'planifié'}</span>
      </div>
      <div style="font-size:12px;color:var(--text-2);margin-bottom:10px;">📅 ${iv.date_intervention||'—'} à ${iv.heure||'—'} · ${iv.type_intervention||''}</div>
      ${iv.notes?`<div style="font-size:12px;color:var(--text-3);margin-bottom:10px;">💬 ${iv.notes}</div>`:''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${iv.telephone?`<a href="tel:${iv.telephone}" style="background:rgba(59,130,246,0.1);color:#3b82f6;border:1px solid rgba(59,130,246,0.3);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;text-decoration:none;">📞 ${iv.telephone}</a>`:''}
        ${iv.adresse?`<a href="https://waze.com/ul?q=${adresseEnc}&navigate=yes" target="_blank" style="background:#1da46222;color:#1da462;border:1px solid #1da46244;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;text-decoration:none;">🔵 Waze</a>`:''}
        <button onclick="changerStatutIntervention('${iv.id}','terminé')" class="btn-small" style="background:rgba(16,185,129,0.1);color:#10b981;border-color:rgba(16,185,129,0.3);">✅ Terminé</button>
        <button onclick="supprimerIntervention('${iv.id}')" class="btn-small" style="background:rgba(239,68,68,0.1);color:#ef4444;border-color:rgba(239,68,68,0.2);">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

async function changerStatutIntervention(id, statut) {
  try {
    await fetch(`/api/agenda/${id}/statut`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({statut}) });
    showToast(`✅ Marqué "${statut}"`, '📅');
    chargerAgenda();
  } catch(e) { showToast('❌ Erreur', '⚠️'); }
}

async function supprimerIntervention(id) {
  if (!confirm('Supprimer cette intervention ?')) return;
  try {
    await fetch(`/api/agenda/${id}`, { method:'DELETE' });
    showToast('🗑️ Supprimée', '✅');
    chargerAgenda();
  } catch(e) { showToast('❌ Erreur', '⚠️'); }
}

// ═══════════════════════════════════════════════════
// CLIENTS
// ═══════════════════════════════════════════════════
let clientsData = [];

async function chargerClients() {
  const container = document.getElementById('clients-list');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3);">Chargement...</div>';
  try {
    const [resClients, resHisto] = await Promise.all([fetch('/api/clients'), fetch('/api/historique')]);
    clientsData = await resClients.json();
    const histo = await resHisto.json();
    clientsData = clientsData.map(c => {
      const nomNorm = (c.nom||'').toLowerCase().split(' ')[0];
      const interventions = (histo||[]).filter(h => ((h.client||'')+(h.prenom||'')).toLowerCase().includes(nomNorm));
      const ca = interventions.filter(h=>h.type==='facture').reduce((s,h)=>s+parseFloat(h.total_ht||0),0);
      return {...c, _interventions:interventions, _ca:ca};
    });
    renderListeClients(clientsData);
  } catch(e) { container.innerHTML = `<div style="color:var(--error);text-align:center;padding:40px;">❌ ${e.message}</div>`; }
}

function renderListeClients(liste) {
  const container = document.getElementById('clients-list');
  if (!container) return;
  if (!liste.length) { container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3);">Aucun client</div>'; return; }
  container.innerHTML = liste.map(c => `
    <div style="background:var(--glass);backdrop-filter:blur(20px);border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-bottom:10px;cursor:pointer;transition:all 0.2s;" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:14px;font-weight:700;">${c.nom||'—'}</div>
          ${c.telephone?`<div style="font-size:12px;color:var(--text-3);">📞 ${c.telephone}</div>`:''}
          ${c.email?`<div style="font-size:11px;color:var(--text-3);">${c.email}</div>`:''}
        </div>
        <div style="text-align:right;">
          <div style="font-size:15px;font-weight:800;color:var(--accent);">${(c._ca||0).toFixed(0)} €</div>
          <div style="font-size:11px;color:var(--text-3);">${c._interventions?.length||0} inter.</div>
        </div>
      </div>
    </div>`).join('');
}

function filtrerClients(query) {
  const q = query.toLowerCase();
  renderListeClients(q ? clientsData.filter(c => (c.nom||'').toLowerCase().includes(q)||(c.telephone||'').includes(q)||(c.email||'').toLowerCase().includes(q)) : clientsData);
}

// ═══════════════════════════════════════════════════
// SANTÉ SYSTÈME
// ═══════════════════════════════════════════════════
async function chargerSante() {
  try {
    const res = await fetch('/api/sante');
    const data = await res.json();
    const global = data.global === 'ok';
    document.getElementById('sante-global-icon').textContent = global ? '✅' : '⚠️';
    document.getElementById('sante-global-text').textContent = global ? 'Tous les services OK' : 'Un ou plusieurs services en erreur';
    document.getElementById('sante-global-text').style.color = global ? '#16a34a' : '#dc2626';
    const container = document.getElementById('sante-services');
    const labels = { brevo_email:'📧 Email', brevo_sms:'📱 SMS', sumup:'💳 SumUp', supabase:'🗄️ Base de données', claude_api:'🤖 Claude API', pdf_python:'📄 PDF' };
    container.innerHTML = Object.entries(data.services||{}).map(([k,v]) => {
      const ok=v.status==='ok'; const unk=v.status==='unknown';
      const color=unk?'#f59e0b':ok?'#16a34a':'#dc2626';
      const bg=unk?'#fef9ec':ok?'#f0fdf4':'#fef2f2';
      return `<div style="background:${bg};border-radius:14px;padding:14px;">
        <div style="font-size:13px;font-weight:700;margin-bottom:6px;">${labels[k]||k}</div>
        <div style="font-size:12px;font-weight:600;color:${color};">● ${unk?'Non vérifié':ok?'OK':'Erreur'}</div>
        ${v.uptime_pct!=null?`<div style="font-size:11px;color:#888;margin-top:3px;">Uptime: ${v.uptime_pct}%</div>`:''}
      </div>`;
    }).join('');
  } catch(e) { document.getElementById('sante-global-text').textContent = '❌ Impossible de charger'; }
}

async function verifierSante() {
  document.getElementById('sante-global-icon').textContent = '⏳';
  document.getElementById('sante-global-text').textContent = 'Vérification...';
  try {
    await fetch('/api/sante/verifier', { method:'POST' });
    await chargerSante();
    showToast('✅ Health check terminé', '🏥');
  } catch(e) { showToast('❌ Erreur health check', '⚠️'); }
}

// ═══════════════════════════════════════════════════
// PARAMS (grille tarifaire stub)
// ═══════════════════════════════════════════════════
function afficherParams() {
  const container = document.getElementById('params-grid');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3);">⚙️ Grille tarifaire chargée depuis Supabase</div>';
}

function sauvegarderPrix() { showToast('✅ Prix sauvegardés !', '💾'); }

// ═══════════════════════════════════════════════════
// CHAT AI (stub)
// ═══════════════════════════════════════════════════
async function envoyerMessage() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  const container = document.getElementById('chat-messages');
  container.innerHTML += `<div style="background:rgba(212,165,116,0.2);border-radius:12px;padding:12px;font-size:13px;align-self:flex-end;max-width:85%;margin-bottom:8px;">${msg}</div>`;
  try {
    const res = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:msg}) });
    const data = await res.json();
    const reponse = data.explication || `${(data.prestations||[]).length} prestation(s) — ${(data.total||0).toFixed(0)} €`;
    container.innerHTML += `<div style="background:rgba(212,165,116,0.1);border-radius:12px;padding:12px;font-size:13px;max-width:85%;margin-bottom:8px;">${reponse}</div>`;
    container.scrollTop = container.scrollHeight;
  } catch(e) { container.innerHTML += `<div style="color:var(--error);font-size:13px;padding:8px;">❌ ${e.message}</div>`; }
}

// ═══════════════════════════════════════════════════
// LEAD
// ═══════════════════════════════════════════════════
let leadTypeActif = 'depannage';

function setLeadMaintenant() { const now=new Date(); document.getElementById('lead-date').value=now.toISOString().split('T')[0]; document.getElementById('lead-heure').value=now.toTimeString().slice(0,5); }
function setLeadAujourdhui() { document.getElementById('lead-date').value=new Date().toISOString().split('T')[0]; }

function ouvrirLead() {
  document.getElementById('lead-overlay').classList.add('active');
  document.getElementById('lead-date').value = new Date().toISOString().split('T')[0];
  setTimeout(() => document.getElementById('lead-nom').focus(), 100);
}

function fermerLead() {
  document.getElementById('lead-overlay').classList.remove('active');
  ['lead-nom','lead-tel','lead-adresse','lead-notes'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('lead-waze-btn').style.display = 'none';
}

function selectLeadType(el, type) {
  leadTypeActif = type;
  document.querySelectorAll('.lead-type-btn').forEach(b => { b.style.border='1px solid var(--border)'; b.style.background='var(--bg)'; b.style.color='var(--text-2)'; b.style.fontWeight='500'; });
  el.style.border='2px solid var(--accent)'; el.style.background='rgba(212,165,116,0.1)'; el.style.color='var(--accent)'; el.style.fontWeight='600';
}

function majWazeLead(val) {
  const btn = document.getElementById('lead-waze-btn');
  const link = document.getElementById('lead-waze-link');
  if (btn && val && val.length > 5) { btn.style.display='block'; if(link) link.onclick=()=>window.open(`https://waze.com/ul?q=${encodeURIComponent(val)}&navigate=yes`,'_blank'); }
  else if (btn) btn.style.display = 'none';
}

async function enregistrerLead(creerDevis) {
  const nom = document.getElementById('lead-nom').value.trim();
  const tel = document.getElementById('lead-tel').value.trim();
  const adresse = document.getElementById('lead-adresse').value.trim();
  const date = document.getElementById('lead-date').value;
  const heure = document.getElementById('lead-heure').value;
  const notes = document.getElementById('lead-notes').value.trim();
  if (!nom) { showToast('⚠️ Nom obligatoire', '❌'); return; }
  if (date) {
    try {
      await fetch('/api/agenda', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ client:nom, telephone:tel, adresse, date_intervention:date, heure, type_intervention:leadTypeActif, notes, statut:'lead' }) });
    } catch(e) {}
  }
  showToast(`✅ Lead enregistré — ${nom}`, '📞');
  fermerLead();
  if (creerDevis) switchPage('devis', document.querySelector('.sidebar-item[onclick*="devis"]'));
}

// ═══════════════════════════════════════════════════
// MODE POPUP
// ═══════════════════════════════════════════════════
let modePopupData = null;

function ouvrirModePopup(prefix, nom, prix) {
  modePopupData = { prefix, nom, prix };
  document.getElementById('mode-popup-nom').textContent = nom;
  document.getElementById('mode-prix-forfait').textContent = prix.f + ' €';
  document.getElementById('mode-prix-fourniture').textContent = prix.fo + ' €';
  document.getElementById('mode-prix-mo').textContent = prix.mo + ' €';
  document.getElementById('mode-btn-fourniture').style.display = prix.fo > 0 ? 'flex' : 'none';
  document.getElementById('mode-btn-mo').style.display = prix.mo > 0 ? 'flex' : 'none';
  document.getElementById('mode-popup-overlay').classList.add('active');
}

function fermerModePopup() { document.getElementById('mode-popup-overlay').classList.remove('active'); modePopupData=null; }

function choisirMode(mode) {
  if (!modePopupData) return;
  const {prefix, nom, prix} = modePopupData;
  const p = mode==='fourniture'?prix.fo:mode==='mo'?prix.mo:prix.f;
  const l = mode==='fourniture'?nom+' (fourniture)':mode==='mo'?nom+' (MO)':nom;
  fermerModePopup();
  showToast(`✅ ${l} ajouté !`, '🛒');
}

// ═══════════════════════════════════════════════════
// ALERTES DEVIS
// ═══════════════════════════════════════════════════
async function verifierAlertesDevis() {
  try {
    const res = await fetch('/api/historique?type=devis');
    const data = await res.json();
    const nb = data.filter(d => { const age=(new Date()-new Date(d.created_at))/3600000; return d.statut==='envoyé' && age>48; }).length;
    const histoTab = document.querySelector('.sidebar-item[onclick*="historique"]');
    if (histoTab && nb > 0) {
      const badge = histoTab.querySelector('.notif-badge') || document.createElement('span');
      badge.className = 'notif-badge';
      badge.textContent = nb;
      badge.style.cssText = 'background:#ef4444;color:#fff;border-radius:10px;padding:2px 6px;font-size:10px;font-weight:800;margin-left:4px;';
      if (!histoTab.querySelector('.notif-badge')) histoTab.appendChild(badge);
    }
  } catch(e) {}
}
setTimeout(verifierAlertesDevis, 2000);
setInterval(verifierAlertesDevis, 300000);

console.log('⚡ SINELEC OS v2.0 loaded — Date Intervention activée');
</script>

</body>
</html>
