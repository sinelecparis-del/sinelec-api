// ═══════════════════════════════════════════════════
// CRASH HANDLERS — Logs tout avant de mourir
// ═══════════════════════════════════════════════════
process.on('uncaughtException', (err) => {
  console.error('💥 CRASH uncaughtException:', err.message);
  console.error('💥 Stack:', err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 CRASH unhandledRejection:', reason?.message || reason);
  console.error('💥 Stack:', reason?.stack || '');
});

// ═══════════════════════════════════════════════════════════════
// SINELEC OS v2.0 - BACKEND COMPLET - VERSION PROPRE
// ═══════════════════════════════════════════════════════════════


// ─── OTP Store en mémoire (15 min TTL) ───────────────────────
const otpStore = new Map(); // num → { code, expiry }
function otpSet(num, code) {
  otpStore.set(num, { code, expiry: Date.now() + 15*60*1000 });
  setTimeout(() => otpStore.delete(num), 15*60*1000);
}
function otpGet(num) {
  const entry = otpStore.get(num);
  if (!entry) return null;
  if (Date.now() > entry.expiry) { otpStore.delete(num); return null; }
  return entry.code;
}
function otpDel(num) { otpStore.delete(num); }

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const CONFIG = {
  meta: { version: '2.0' },
  dev: { skip_email: false },
  email: {
    sender_name: 'SINELEC',
    sender_email: 'sinelec.paris@gmail.com',
    template_devis: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;"><div style="background:linear-gradient(135deg,#1B2A4A,#243660);padding:28px;text-align:center;border-radius:12px 12px 0 0;"><div style="font-size:32px;">⚡</div><h2 style="color:#fff;margin:8px 0 0;font-size:18px;">SINELEC Paris</h2><p style="color:#BFC8D6;font-size:12px;margin-top:4px;">Électricien Paris & Île-de-France</p></div><div style="padding:28px;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 12px 12px;"><p style="font-size:15px;color:#333;">Bonjour,</p><p style="font-size:14px;color:#555;line-height:1.7;">Veuillez trouver ci-joint votre devis n° <strong>{num}</strong>. Le PDF est en pièce jointe.</p><div style="background:#fffbf0;border:1.5px solid #C9A84C;border-radius:12px;padding:20px;text-align:center;margin:24px 0;"><p style="font-size:13px;color:#555;margin-bottom:16px;">Pour accepter ce devis, signez-le directement en ligne :</p><a href="{lien_signature}" style="background:linear-gradient(135deg,#C9A84C,#daa520);color:#fff;text-decoration:none;border-radius:10px;padding:14px 28px;font-size:15px;font-weight:800;display:inline-block;">✍️ Signer le devis en ligne</a><p style="font-size:11px;color:#aaa;margin-top:12px;">Signature électronique valide — Loi n°2000-230</p></div><p style="font-size:13px;color:#888;">📞 07 87 38 86 22 | sinelec.paris@gmail.com</p></div><p style="font-size:11px;color:#bbb;text-align:center;margin-top:12px;">SINELEC Paris • 128 Rue La Boétie, 75008 Paris • SIRET : 91015824500019</p></div>`,
    template_facture: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;"><div style="background:linear-gradient(135deg,#1B2A4A,#243660);padding:28px;text-align:center;border-radius:12px 12px 0 0;"><div style="font-size:32px;">💶</div><h2 style="color:#fff;margin:8px 0 0;font-size:18px;">SINELEC Paris</h2></div><div style="padding:28px;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 12px 12px;"><p style="font-size:15px;color:#333;">Bonjour,</p><p style="font-size:14px;color:#555;line-height:1.7;">Veuillez trouver ci-joint votre facture n° <strong>{num}</strong>. Merci de procéder au règlement selon les modalités indiquées.</p><p style="font-size:13px;color:#888;margin-top:16px;">Virement, Espèces, CB (SumUp)<br>📞 07 87 38 86 22</p></div></div>`
  },
  features: {
    chatbot_claude: true,
    devis_factures: true,
    email_auto: true,
    historique: true,
    rapports_intervention: true,
    relances_auto: true,
    signature_client: true,
    veille_tarifaire: false
  }
};

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// ═══════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════

const APP_PASSWORD = process.env.APP_PASSWORD || 'sinelec2026';
const JWT_SECRET   = process.env.JWT_SECRET   || crypto.randomBytes(32).toString('hex');
const TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000;

function genererToken() {
  const payload = JSON.stringify({ ts: Date.now(), exp: Date.now() + TOKEN_EXPIRY });
  const b64 = Buffer.from(payload).toString('base64');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

function verifierToken(token) {
  if (!token) return false;
  try {
    const [b64, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(b64).digest('hex');
    if (sig !== expectedSig) return false;
    const { exp } = JSON.parse(Buffer.from(b64, 'base64').toString());
    return Date.now() < exp;
  } catch(e) { return false; }
}

function authMiddleware(req, res, next) {
  const publicRoutes = ['/', '/health', '/api/login', '/signer/', '/paiement-confirme/', '/api/signature', '/api/otp-signature', '/api/verifier-otp', '/api/track/click/', '/api/track/open/', '/api/auth/check', '/api/test-pdf', '/api/test'];
  if (publicRoutes.some(r => req.path.startsWith(r))) return next();
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  if (!verifierToken(token)) return res.status(401).json({ error: 'Non autorisé', code: 'UNAUTHORIZED' });
  next();
}

app.use(authMiddleware);

app.post('/api/login', (req, res) => {
  const inputPwd = String(req.body.password || '').trim();
  const validPwd = String(APP_PASSWORD).trim();
  if (inputPwd !== validPwd) return res.status(401).json({ error: 'Mot de passe incorrect' });
  res.json({ success: true, token: genererToken(), expiresIn: TOKEN_EXPIRY });
});

app.get('/api/auth/check', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  res.json({ valid: verifierToken(token) });
});

// ═══════════════════════════════════════════════════
// CLIENTS
// ═══════════════════════════════════════════════════

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || '',
  { realtime: { transport: ws } }
);
let anthropic;
try { anthropic = new Anthropic({ apiKey: (process.env.ANTHROPIC_API_KEY || '').trim() }); }
catch(e) { console.error('⚠️ Anthropic init:', e.message); anthropic = null; }
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SUMUP_API_KEY = process.env.SUMUP_API_KEY;


// ═══════════════════════════════════════════════════
// API: TEST PDF GENERATION
// ═══════════════════════════════════════════════════
app.get('/api/test-pdf', async (req, res) => {
  const steps = [];
  try {
    // Step 1: Check python3
    try {
      const pyVersion = execSync('python3 --version 2>&1', { timeout: 5000 }).toString().trim();
      steps.push({ step: 'python3', ok: true, msg: pyVersion });
    } catch(e) {
      steps.push({ step: 'python3', ok: false, msg: e.message });
      return res.json({ success: false, steps, error: 'python3 introuvable' });
    }

    // Step 2: Check reportlab
    try {
      execSync(`python3 -c "from reportlab.platypus import SimpleDocTemplate, Table; print('ok')"`, { timeout: 10000 });
      steps.push({ step: 'reportlab', ok: true });
    } catch(e) {
      steps.push({ step: 'reportlab', ok: false, msg: e.stderr?.toString() || e.message });
      return res.json({ success: false, steps, error: 'reportlab non installé' });
    }

    // Step 3: Check logo
    const logoExists = fs.existsSync('/app/logo_b64.txt');
    steps.push({ step: 'logo', ok: logoExists, msg: logoExists ? 'présent' : 'absent (non bloquant)' });

    // Step 4: Generate minimal PDF
    const testPy = `/tmp/test_sinelec_${Date.now()}.py`;
    const testPdf = `/tmp/test_sinelec_${Date.now()}.pdf`;
    const testData = '/tmp/test_sinelec_data.json';
    fs.writeFileSync(testData, JSON.stringify([{designation:'Test prestation',qte:1,prixUnit:100,total:100,details:[]}]));

    const pyScript = `# -*- coding: utf-8 -*-
import json, sys
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph
from reportlab.lib.styles import getSampleStyleSheet
doc = SimpleDocTemplate(sys.argv[2], pagesize=A4)
styles = getSampleStyleSheet()
data = json.loads(open(sys.argv[1]).read())
story = [Paragraph(f"Test SINELEC - {len(data)} prestations", styles['Title'])]
doc.build(story)
print('PDF_OK')
`;
    fs.writeFileSync(testPy, pyScript);
    try {
      const out = execSync(`python3 "${testPy}" "${testData}" "${testPdf}"`, { timeout: 30000, stdio: ['pipe','pipe','pipe'] });
      const pdfExists = fs.existsSync(testPdf);
      const pdfSize = pdfExists ? fs.statSync(testPdf).size : 0;
      steps.push({ step: 'pdf_generation', ok: pdfExists, msg: pdfExists ? `${pdfSize} bytes` : 'non généré' });
      try { fs.unlinkSync(testPy); fs.unlinkSync(testPdf); } catch(e) {}
    } catch(pyErr) {
      const pyMsg = pyErr.stderr?.toString() || pyErr.stdout?.toString() || pyErr.message;
      steps.push({ step: 'pdf_generation', ok: false, msg: pyMsg.substring(0, 400) });
      return res.json({ success: false, steps, error: 'PDF generation failed: ' + pyMsg.substring(0, 200) });
    }

    res.json({ success: true, steps, message: 'Tout fonctionne ✅' });
  } catch(e) {
    res.json({ success: false, steps, error: e.message });
  }
});



// ═══════════════════════════════════════════════════
// HEALTHCHECK
// ═══════════════════════════════════════════════════

app.get('/', (req, res) => res.send('OK SINELEC OS v2.0'));
// ═══════════════════════════════════════════════════
// API: DIAGNOSTIC (test Python + Supabase)
// ═══════════════════════════════════════════════════
app.get('/api/test', async (req, res) => {
  const diag = { python: false, supabase: false, logo: false, error: null };
  try {
    // Test Python
    try {
      const { execSync } = require('child_process');
      execSync(`python3 -c "from reportlab.platypus import SimpleDocTemplate; print('ok')"`, { timeout: 10000 });
      diag.python = true;
    } catch(e) { diag.python_error = e.message.substring(0,200); }
    // Test Supabase
    try {
      const { data } = await supabase.from('compteurs').select('count').limit(1);
      diag.supabase = true;
    } catch(e) { diag.supabase_error = e.message.substring(0,200); }
    // Test logo
    try {
      if (fs.existsSync('/app/logo_b64.txt')) diag.logo = true;
      else diag.logo_path = 'NOT FOUND: /app/logo_b64.txt';
    } catch(e) {}
    // Test env vars
    diag.anthropic = !!process.env.ANTHROPIC_API_KEY;
    diag.brevo = !!process.env.BREVO_API_KEY;
    diag.supabase_url = !!process.env.SUPABASE_URL;
    res.json(diag);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


app.get('/health', (req, res) => res.json({ status: 'ok', service: 'SINELEC OS v2.0' }));

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

async function logSystem(type, message, data = null, success = true, error = null) {
  try {
    await supabase.from('logs_system').insert({ type, message, data, success, error_details: error ? String(error) : null });
  } catch(e) {}
}


// Helper prénom — skip civilité M./Mme/Mr
function extractPrenom(clientStr) {
  const civilites = ['M.', 'Mme', 'Mr', 'Dr', 'Me', 'Pr'];
  const parts = (clientStr || '').trim().split(/\s+/);
  const first = parts.find(p => !civilites.includes(p) && p.length > 0);
  return first || parts[0] || 'client';
}

async function envoyerEmail(to, subject, htmlContent, attachment = null) {
  if (CONFIG.dev.skip_email) { console.log('Email skippé:', to); return { skipped: true }; }
  const payload = {
    sender: { name: CONFIG.email.sender_name, email: CONFIG.email.sender_email },
    to: [{ email: to }], subject, htmlContent, trackOpens: 0, trackClicks: 0,
  };
  if (attachment) payload.attachment = [{ content: attachment.content, name: attachment.name }];
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const err = await res.text(); throw new Error('Brevo: ' + err); }
  return await res.json();
}

async function envoyerSMS(to, message) {
  if (!to || String(to).length < 8) return null;
  let num = String(to).replace(/[\s\-\.]/g, '');
  if (num.startsWith('0')) num = '+33' + num.substring(1);
  if (!num.startsWith('+')) num = '+33' + num;
  
  // Vérifier que BREVO_API_KEY est disponible
  if (!BREVO_API_KEY || BREVO_API_KEY.trim() === '') {
    console.error('❌ BREVO_API_KEY manquant pour envoi SMS');
    return null;
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ sender: 'SINELEC', recipient: num, content: message, type: 'transactional', tag: 'sinelec' }),
    });
    if (!res.ok) { 
      const errorText = await res.text().catch(() => '');
      console.error('❌ SMS error HTTP', res.status, ':', errorText);
      return null; 
    }
    const data = await res.json();
    const msgId = data.messageId || data.messageHexId || null;
    console.log('📱 SMS envoyé à', num, '— messageId:', msgId);
    return msgId;
  } catch(e) { 
    console.error('❌ SMS error catch:', e.message); 
    return null; 
  }
}

async function incrementerCompteur(type) {
  const { data, error } = await supabase.from('compteurs').select('valeur').eq('type', type).single();
  if (error || !data) { await supabase.from('compteurs').insert({ type, valeur: 1 }); return 1; }
  const val = data.valeur + 1;
  await supabase.from('compteurs').update({ valeur: val }).eq('type', type);
  return val;
}

async function chargerGrilleTarifaire() {
  const { data, error } = await supabase.from('grille_tarifaire').select('*').eq('actif', true).order('categorie, nom');
  if (error) return null;
  const grille = {};
  data.forEach(item => {
    if (!grille[item.categorie]) grille[item.categorie] = [];
    grille[item.categorie].push({ code: item.code, nom: item.nom, prix: item.prix_ht });
  });
  return grille;
}

// ═══════════════════════════════════════════════════
// API: GÉNÉRATION DEVIS/FACTURE
// ═══════════════════════════════════════════════════

app.post('/api/generer', async (req, res) => {
  if (!CONFIG.features.devis_factures) return res.status(403).json({ error: 'Feature désactivée' });
  try {
    const { type, client, email, telephone, adresse, complement, codePostal, ville, prenom, description, prestations, partenaire, part_diahe, part_partenaire, nom_partenaire, intervention_type, siret_client, num_existant } = req.body;

    // Si modification d'un devis existant → garder le même numéro sans incrémenter le compteur
    let num;
    if (num_existant && type === 'devis') {
      num = num_existant;
      console.log('🔄 Mise à jour devis existant:', num);
    } else {
      const compteur = await incrementerCompteur(type);
      const annee = new Date().getFullYear();
      const mois = String(new Date().getMonth() + 1).padStart(2, '0');
      num = type === 'devis' ? `OS-${annee}${mois}-${String(compteur).padStart(3, '0')}` : `${annee}${mois}-${String(compteur).padStart(3, '0')}`;
    }
    const total_ht = prestations.reduce((sum, p) => sum + (p.prix * p.quantite), 0);

    // Calcul parts partenaire
    const isPartenaire = !!partenaire;
    const pdiahe = isPartenaire ? (part_diahe || 60) : 100;
    const ppartenaire = isPartenaire ? (part_partenaire || 40) : 0;

    // ── INSERT HISTORIQUE AVEC FALLBACK ──────────────
    // Tentative 1 : payload complet
    let insertOk = false;
    const payloadComplet = {
      num, type, client, email, telephone, adresse, prestations, total_ht,
      statut: 'envoye', date_envoi: new Date().toISOString(), source: 'app',
      partenaire: isPartenaire, part_diahe: pdiahe, part_partenaire: ppartenaire,
      nom_partenaire: isPartenaire ? (nom_partenaire || 'Alopronto') : null,
      intervention_type: intervention_type || 'immediat'
    };
    const { error: insertErr1 } = await supabase.from('historique').upsert(payloadComplet, { onConflict: 'num' });
    if (!insertErr1) {
      insertOk = true;
      console.log('✅ Historique inséré (complet):', num);
    } else {
      console.warn('⚠️ Insert complet échoué:', insertErr1.message, '— tentative payload minimal');
      // Tentative 2 : payload minimal (colonnes de base uniquement)
      const payloadMinimal = { num, type, client, email, telephone, adresse, prestations, total_ht, statut: 'envoye', date_envoi: new Date().toISOString(), source: 'app' };
      const { error: insertErr2 } = await supabase.from('historique').upsert(payloadMinimal, { onConflict: 'num' });
      if (!insertErr2) {
        insertOk = true;
        console.log('✅ Historique inséré (minimal):', num);
      } else {
        console.error('❌ INSERT historique échoué (2 tentatives):', insertErr2.message, '— num:', num, '— VERIFIER TABLE SUPABASE');
      }
    }

    console.log('📄 generer START — type:', type, '| client:', client, '| prestations:', prestations?.length);

    // ── UPSERT FICHE CLIENT AUTO ──────────────────
    if (client && (email || telephone)) {
      try {
        // Chercher si client existe déjà (par email ou téléphone)
        let existant = null;
        if (email) {
          const { data } = await supabase.from('clients').select('*').eq('email', email).single();
          existant = data;
        }
        if (!existant && telephone) {
          const { data } = await supabase.from('clients').select('*').eq('telephone', telephone).single();
          existant = data;
        }

        if (existant) {
          // Mettre à jour les infos
          await supabase.from('clients').update({
            nom: client,
            email: email || existant.email,
            telephone: telephone || existant.telephone,
            adresse: adresse || existant.adresse,
            derniere_intervention: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }).eq('id', existant.id);
        } else {
          // Créer nouvelle fiche client
          await supabase.from('clients').insert({
            nom: client,
            email: email || null,
            telephone: telephone || null,
            adresse: adresse || null,
            source: 'app',
            premiere_intervention: new Date().toISOString(),
            derniere_intervention: new Date().toISOString(),
            created_at: new Date().toISOString()
          });
        }
        console.log(`✅ Fiche client mise à jour : ${client}`);
      } catch(e) {
        console.log('Client upsert (non bloquant):', e.message);
      }
    }

    // ── GÉNÉRATION PDF — toujours, email ou pas ──────
    let pdf_b64 = null;
    if (CONFIG.features.email_auto) {
      const typeLabelUpper = type === 'devis' ? 'DEVIS' : 'FACTURE';
      const dateStr = new Date().toLocaleDateString('fr-FR');
      const dateValide = new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString('fr-FR');
      const detailsPath = path.join('/tmp', `_details_${num}.json`);
      const pyPath = path.join('/tmp', `_devis_${num}.py`);
      const pdfPath = path.join('/tmp', `${num}.pdf`);

      // Construire detailsData avec support sections
      // Build data file with meta (all dynamic values) + items (no string injection in Python!)
      const prestationsInput = Array.isArray(prestations) ? prestations :
        (typeof prestations === 'string' ? JSON.parse(prestations) : []);
      let itemsData = [];
      let sectNum = 0; let itemNum = 0;
      for (const p of prestationsInput) {
        if (p._section) {
          sectNum++; itemNum = 0;
          itemsData.push({ _section: true, titre: `${sectNum}. ${p.titre || 'Section ' + sectNum}` });
        } else {
          if (sectNum > 0) itemNum++;
          itemsData.push({ designation: p.nom || '', qte: p.quantite || 1, prixUnit: p.prix || 0, total: (p.prix || 0) * (p.quantite || 1), details: p.desc ? [p.desc] : [] });
        }
      }
      // Variables client — déclarées AVANT jsonPayload
      const clientEsc = String(client || '').replace(/'/g, ' ');
      const clientTel = String(telephone || '').trim();
      const adresseRaw = String(adresse || '').replace(/'/g, ' ').trim();
      const adresseParts = adresseRaw.split(',').map(s => s.trim()).filter(Boolean);
      const clientRue = adresseParts[0] || '';
      // Ville = dernière partie après virgule (ex: "75008 Paris")
      const clientCPVille = adresseParts.length > 1 ? adresseParts[adresseParts.length - 1] : String(ville || '').trim();
      const descObjet = String(description || 'Travaux d electricite generale')
        .trim().replace(/'/g, ' ').replace(/"/g, ' ').replace(/\\/g, ' ')
        .replace(/\n/g, ' ').replace(/\r/g, ' ').substring(0, 120);
      const clientSiret = String(siret_client || '').trim().replace(/'/g, '').replace(/"/g, '').replace(/\\/g, '');

      // JSON payload avec meta — toutes les données dynamiques hors du script Python
      const jsonPayload = {
        _meta: {
          type, num,
          typeLabelUpper,
          dateStr, dateValide,
          clientNom: clientEsc,
          clientRue, clientVille: clientCPVille,
          clientTel, clientSiret,
          descObjet,
          isPaye: false, isSigne: false
        },
        _items: itemsData
      };
      fs.writeFileSync(detailsPath, JSON.stringify(jsonPayload));

      const py = `# -*- coding: utf-8 -*-
import json, base64, io, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import *
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.lib.utils import ImageReader
W,H=A4
MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C')
OR_PALE=colors.HexColor('#FBF7EC'); OR_FONCE=colors.HexColor('#A07830')
BLANC=colors.white; CREME=colors.HexColor('#FDFCF9')
GRIS_TEXTE=colors.HexColor('#3A3A3A'); GRIS_SOFT=colors.HexColor('#777777')
GRIS_LIGNE=colors.HexColor('#E0DDD6')
def p(txt,sz=9,font='Helvetica',color=GRIS_TEXTE,align=TA_LEFT,sb=0,sa=2,leading=None):
    if leading is None: leading=sz*1.35
    return Paragraph(str(txt),ParagraphStyle('s',fontName=font,fontSize=sz,textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa,leading=leading,wordWrap='CJK'))
raw=json.loads(open(sys.argv[1],encoding='utf-8').read())
meta=raw.get('_meta',{})
data=[l for l in raw.get('_items',[]) if True]
totalHT=sum(float(l.get('total',0)) for l in data if not l.get('_section'))
doc_type=meta.get('type','devis')
doc_num=meta.get('num','---')
doc_date=meta.get('dateStr','')
doc_valide=meta.get('dateValide','')
doc_label=meta.get('typeLabelUpper','DEVIS')
client_nom=meta.get('clientNom','')
client_rue=meta.get('clientRue','')
client_ville=meta.get('clientVille','')
client_tel=meta.get('clientTel','')
client_siret=meta.get('clientSiret','')
desc_objet=meta.get('descObjet','Travaux electricite')
is_paye=meta.get('isPaye',False)
is_signe=meta.get('isSigne',False)
try:
    logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())
except:
    logo_bytes=None
class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw):
        pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0; self.saveState(); self._draw_page()
    def showPage(self):
        self._draw_footer(); pdfcanvas.Canvas.showPage(self); self._pg+=1
    def save(self):
        self._draw_footer(); pdfcanvas.Canvas.save(self)
    def _draw_page(self):
        self.saveState()
        self.setFillColor(CREME); self.rect(0,0,W,H,fill=1,stroke=0)
        self.setFillColor(MARINE); self.rect(0,0,0.7*cm,H,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.7*cm,0,0.08*cm,H,fill=1,stroke=0)
        if self._pg==0: self._draw_header()
        else: self._draw_header_small()
        self.restoreState()
    def _draw_header(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-5.4*cm,W-0.78*cm,5.4*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-5.4*cm,W-0.78*cm,0.12*cm,fill=1,stroke=0)
        if logo_bytes:
            self.drawImage(ImageReader(io.BytesIO(logo_bytes)),0.9*cm,H-5.05*cm,width=4.2*cm,height=4.2*cm,preserveAspectRatio=True,mask='auto')
        self.setFont('Helvetica-Bold',15); self.setFillColor(BLANC); self.drawString(5.9*cm,H-1.7*cm,'SINELEC PARIS')
        self.setFont('Helvetica-Bold',9); self.setFillColor(BLANC); self.drawString(5.9*cm,H-2.5*cm,'128 Rue La Boetie, 75008 Paris')
        self.setFont('Helvetica',8.5); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(5.9*cm,H-3.0*cm,'Tel : 07 87 38 86 22')
        self.drawString(5.9*cm,H-3.4*cm,'sinelec.paris@gmail.com')
        self.setFillColor(colors.HexColor('#243660')); self.roundRect(5.9*cm,H-4.15*cm,5.5*cm,0.55*cm,0.1*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',8); self.setFillColor(OR); self.drawString(6.1*cm,H-3.88*cm,'SIRET : 91015824500019')
        lbl_sz=40 if len(doc_label)<=7 else (28 if len(doc_label)<=14 else 20)
        self.setFont('Helvetica-Bold',lbl_sz); self.setFillColor(BLANC); self.drawRightString(W-1.2*cm,H-2.2*cm,doc_label)
        self.setStrokeColor(OR); self.setLineWidth(1.5); self.line(13*cm,H-2.65*cm,W-1.2*cm,H-2.65*cm)
        self.setFillColor(OR); self.roundRect(W-6.5*cm,H-3.55*cm,5.3*cm,0.65*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(MARINE); self.drawCentredString(W-3.85*cm,H-3.22*cm,'N\u00b0 '+doc_num)
        self.setFont('Helvetica',8); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawRightString(W-1.2*cm,H-3.9*cm,'Date : '+doc_date)
    def _draw_header_small(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,1.5*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',10); self.setFillColor(BLANC); self.drawString(1.4*cm,H-1.0*cm,'SINELEC')
        self.setFont('Helvetica',8); self.setFillColor(OR); self.drawRightString(W-1.2*cm,H-1.0*cm,doc_label+' N\u00b0 '+doc_num)
    def _draw_footer(self):
        self.saveState()
        self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI  \u2022  128 Rue La Boetie, 75008 Paris  \u2022  SIRET : 91015824500019  \u2022  TVA non applicable art. 293B CGI')
        self.setFont('Helvetica-Bold',7); self.setFillColor(OR); self.drawRightString(W-1.2*cm,0.28*cm,doc_num)
        self.restoreState()
        self._draw_tampons()
    def _draw_tampons(self):
        rouge=colors.HexColor('#cc0000'); vert=colors.HexColor('#16a34a')
        couleur=rouge if is_paye else (vert if is_signe else None)
        if not couleur: return
        cx=W-3.8*cm; cy=3.5*cm; r=1.7*cm
        self.saveState(); self.setStrokeColor(couleur); self.setFillColor(couleur)
        self.setFillAlpha(0.85); self.setLineWidth(3.5); self.circle(cx,cy,r,fill=0,stroke=1)
        self.setLineWidth(0.8); self.setFillAlpha(0.4); self.circle(cx,cy,r-0.22*cm,fill=0,stroke=1)
        self.translate(cx,cy); self.rotate(-15)
        nom_court=client_nom.upper()[:16]
        self.setFillAlpha(0.92); self.setFillColor(couleur)
        self.setFont('Helvetica-Bold',7); self.drawCentredString(0,1.05*cm,nom_court)
        label='PAYE' if is_paye else 'SIGNE'
        sz=22 if is_paye else 20
        self.setFillAlpha(0.9); self.setFont('Helvetica-Bold',sz); self.drawCentredString(0,0.18*cm,label)
        self.setFont('Helvetica-Bold',7.5); self.setFillAlpha(0.75); self.drawCentredString(0,-0.52*cm,doc_date)
        self.setFont('Helvetica',6); self.setFillAlpha(0.45); self.drawCentredString(0,-1.02*cm,'PARIS')
        self.restoreState()
doc=SimpleDocTemplate(sys.argv[2],pagesize=A4,leftMargin=1.2*cm,rightMargin=1.0*cm,topMargin=5.6*cm,bottomMargin=1.6*cm)
story=[]
objet_b=Table([[p('OBJET DES TRAVAUX',7.5,'Helvetica-Bold',OR,sa=4)],[p(desc_objet,10,'Helvetica-Bold',MARINE)],[p('Conformes NF C 15-100  \u2022  Garantie decennale ORUS  \u2022  TVA non applicable art. 293B CGI',7.5,color=GRIS_SOFT)]],colWidths=[8.2*cm])
objet_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),0),('LINEABOVE',(0,0),(0,0),2.5,MARINE),('TOPPADDING',(0,0),(0,0),10)]))
client_lines=[p('DESTINATAIRE',7,'Helvetica-Bold',OR,sa=3),p(client_nom,11,'Helvetica-Bold',MARINE),p(client_rue,9,color=GRIS_TEXTE),p(client_ville,9,color=GRIS_TEXTE)]
if client_tel: client_lines.append(p('Tel : '+client_tel,8.5,color=GRIS_SOFT))
if client_siret: client_lines.append(p('SIRET : '+client_siret,8,color=GRIS_SOFT))
client_b=Table([[c] for c in client_lines],colWidths=[8.2*cm])
client_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2),('LEFTPADDING',(0,0),(-1,-1),0)]))
hdr_row=Table([[objet_b,client_b]],colWidths=[9.5*cm,8.7*cm])
hdr_row.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
story.append(hdr_row); story.append(Spacer(1,0.5*cm))
th=[p('N\u00b0',8,'Helvetica-Bold',BLANC,TA_CENTER),p('D\u00e9signation',8,'Helvetica-Bold',BLANC),p('Qte',8,'Helvetica-Bold',BLANC,TA_CENTER),p('Prix HT',8,'Helvetica-Bold',BLANC,TA_RIGHT),p('Total HT',8,'Helvetica-Bold',BLANC,TA_RIGHT)]
rows=[th]; sect_num=0; item_num=0
for ligne in data:
    if ligne.get('_section'):
        sect_num+=1; item_num=0
        rows.append([p(str(ligne.get('titre','Section')),9,'Helvetica-Bold',BLANC,sa=4),'','','','']); continue
    item_num+=1
    sub_num=str(sect_num)+'.'+str(item_num) if sect_num>0 else str(item_num)
    nom=str(ligne.get('designation',''))
    qte=int(ligne.get('qte',1) or 1); pu=float(ligne.get('prixUnit',0) or 0); tot=float(ligne.get('total',pu*qte) or 0)
    is_offert=(pu==0 or tot==0)
    desig_cell=[p(nom,9,'Helvetica-Bold',MARINE)]
    for d in (ligne.get('details') or []):
        if d: desig_cell.append(p(str(d),7.5,'Helvetica',GRIS_SOFT,sb=1,sa=0))
    rows.append([p(sub_num,8,color=GRIS_SOFT,align=TA_CENTER),desig_cell,p(str(qte),9,align=TA_CENTER),p((str(round(pu))+' \u20ac') if not is_offert else 'OFFERT',9,align=TA_RIGHT),(p('OFFERT',9,'Helvetica-Bold',align=TA_RIGHT,color=colors.HexColor('#16a34a')) if is_offert else p(str(round(tot))+' \u20ac',9,'Helvetica-Bold',align=TA_RIGHT,color=OR_FONCE))])
COL=[1.0*cm,10.8*cm,1.3*cm,2.2*cm,2.9*cm]
t=Table(rows,colWidths=COL,repeatRows=1)
ts=[('BACKGROUND',(0,0),(-1,0),MARINE),('ROWBACKGROUNDS',(0,1),(-1,-1),[CREME,OR_PALE]),('LINEBELOW',(0,0),(-1,0),1.5,OR),('LINEBELOW',(0,-1),(-1,-1),1.5,MARINE),('LEFTPADDING',(0,0),(-1,-1),4),('RIGHTPADDING',(0,0),(-1,-1),4),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('VALIGN',(0,0),(-1,-1),'TOP'),('ALIGN',(2,0),(4,-1),'RIGHT')]
for i,row in enumerate(rows):
    if i>0 and isinstance(row[1],str) and row[1]=='':
        ts+=[('BACKGROUND',(0,i),(-1,i),colors.HexColor('#243660')),('SPAN',(0,i),(-1,i)),('TEXTCOLOR',(0,i),(-1,i),BLANC)]
t.setStyle(TableStyle(ts))
story.append(t)
story.append(Spacer(1,0.4*cm))
net=Table([[p('NET \u00c0 PAYER',13,'Helvetica-Bold',BLANC),p('%.2f \u20ac'%totalHT,16,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,-1),2,OR)]))
story.append(net); story.append(Spacer(1,0.3*cm))
if doc_type=='facture' and not is_paye:
    ORANGE=colors.HexColor('#ea580c'); ORANGE_BG=colors.HexColor('#fff7ed')
    band=Table([[p('\u23f3  PAIEMENT EN ATTENTE',11,'Helvetica-Bold',ORANGE,TA_CENTER)],[p('Merci de r\u00e9gler dans les meilleurs d\u00e9lais',8,'Helvetica',colors.HexColor('#9a3412'),TA_CENTER)]],colWidths=[18.2*cm])
    band.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),ORANGE_BG),('BOX',(0,0),(-1,-1),2.5,ORANGE),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
    story.append(band); story.append(Spacer(1,0.3*cm))
    iban_t=Table([[p('\U0001f4b3  Comment r\u00e9gler ?',9,'Helvetica-Bold',MARINE),p('\u2022 Esp\u00e8ces  \u2022  CB SumUp  \u2022  Virement  \u2022  PayPal',8,'Helvetica',GRIS_SOFT,TA_RIGHT)],[p('IBAN : FR76 1695 8000 0174 2540 5920 931  \u2022  BIC : QNTOFRP1XXX',8,'Helvetica-Bold',MARINE),p('')]],colWidths=[13*cm,5.2*cm])
    iban_t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),ORANGE_BG),('BOX',(0,0),(-1,-1),1.5,ORANGE),('LINEBELOW',(0,0),(-1,0),0.5,colors.HexColor('#fed7aa')),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
    story.append(iban_t)
elif doc_type=='facture' and is_paye:
    VERT_P=colors.HexColor('#16a34a'); VERT_BG=colors.HexColor('#f0fdf4')
    date_p=str(meta.get('datePaiement','')); mode_p=str(meta.get('modePaiement','R\u00e8glement re\u00e7u'))
    band=Table([[p('\u2705  PAIEMENT RE\u00c7U',11,'Helvetica-Bold',VERT_P,TA_CENTER)],[p('Le '+date_p+'  \u2022  '+mode_p,8,'Helvetica',colors.HexColor('#166534'),TA_CENTER)]],colWidths=[18.2*cm])
    band.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),VERT_BG),('BOX',(0,0),(-1,-1),2.5,VERT_P),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
    story.append(band); story.append(Spacer(1,0.3*cm))
    recap=Table([[p('\U0001f9fe  R\u00e9capitulatif du r\u00e8glement',9,'Helvetica-Bold',MARINE),p('')],[p('Mode :',8,'Helvetica',GRIS_SOFT),p(mode_p,8,'Helvetica-Bold',MARINE,TA_RIGHT)],[p('Date :',8,'Helvetica',GRIS_SOFT),p(date_p,8,'Helvetica-Bold',MARINE,TA_RIGHT)],[p('Montant encaiss\u00e9 :',9,'Helvetica-Bold',VERT_P),p('%.2f \u20ac'%totalHT,10,'Helvetica-Bold',VERT_P,TA_RIGHT)]],colWidths=[9.1*cm,9.1*cm])
    recap.setStyle(TableStyle([('SPAN',(0,0),(1,0)),('BACKGROUND',(0,0),(-1,-1),VERT_BG),('BOX',(0,0),(-1,-1),1.5,VERT_P),('LINEABOVE',(0,3),(-1,3),1,colors.HexColor('#bbf7d0')),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
    story.append(recap)
story.append(Spacer(1,0.25*cm))
if doc_type=='devis' and totalHT>=400:
    acompte=totalHT*0.4; solde=totalHT*0.6
    BLEU_L=colors.HexColor('#EFF6FF'); BLEU_B=colors.HexColor('#BAE6FD'); BLEU_T=colors.HexColor('#0369A1')
    VERT_L2=colors.HexColor('#F0FDF4'); VERT_B2=colors.HexColor('#BBF7D0')
    # Header modalités
    hdr_ac=Table([[p('\U0001f4b3  Modalit\u00e9s de paiement',10,'Helvetica-Bold',MARINE),p('Devis > 400 \u20ac',8,'Helvetica',GRIS_SOFT,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
    hdr_ac.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#F8F5EF')),('BOX',(0,0),(-1,-1),1,GRIS_LIGNE),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
    story.append(hdr_ac)
    # Cellule acompte
    cell_ac=[p('ACOMPTE',8,'Helvetica-Bold',OR_FONCE),p('\u00c0 la signature',8,'Helvetica',GRIS_SOFT),Spacer(1,4),p('%.2f \u20ac'%acompte,16,'Helvetica-Bold',MARINE,TA_CENTER),p('40 %',9,'Helvetica-Bold',OR_FONCE,TA_CENTER)]
    cell_tx=[p('INTERVENTION',8,'Helvetica-Bold',BLEU_T),p('Planifi\u00e9e ensemble',8,'Helvetica',GRIS_SOFT),Spacer(1,4),p('\u26a1 Travaux SINELEC',11,'Helvetica-Bold',BLEU_T,TA_CENTER),p('NF C 15-100',8,'Helvetica',GRIS_SOFT,TA_CENTER)]
    cell_sl=[p('SOLDE',8,'Helvetica-Bold',GRIS_TEXTE),p('Fin des travaux',8,'Helvetica',GRIS_SOFT),Spacer(1,4),p('%.2f \u20ac'%solde,16,'Helvetica-Bold',MARINE,TA_CENTER),p('60 %',9,'Helvetica-Bold',GRIS_TEXTE,TA_CENTER)]
    tl=Table([[cell_ac,cell_tx,cell_sl]],colWidths=[6.0*cm,6.2*cm,6.0*cm])
    tl.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(0,0),colors.HexColor('#FEF3C7')),
        ('BACKGROUND',(1,0),(1,0),BLEU_L),
        ('BACKGROUND',(2,0),(2,0),VERT_L2),
        ('BOX',(0,0),(-1,-1),1,GRIS_LIGNE),
        ('LINEBEFORE',(1,0),(1,0),1,GRIS_LIGNE),
        ('LINEBEFORE',(2,0),(2,0),1,GRIS_LIGNE),
        ('VALIGN',(0,0),(-1,-1),'TOP'),
        ('ALIGN',(0,0),(-1,-1),'CENTER'),
        ('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),
        ('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),
    ]))
    story.append(tl)
    # Modes de paiement
    pm=Table([[p('\U0001f4b5 Esp\u00e8ces  \u2022  \U0001f3e6 Virement  \u2022  \U0001f4b3 CB  \u2022  \U0001f17f\ufe0f PayPal',9,'Helvetica',GRIS_SOFT,TA_CENTER)]],colWidths=[18.2*cm])
    pm.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#FDFCF9')),('BOX',(0,0),(-1,-1),1,GRIS_LIGNE),('LINEABOVE',(0,0),(-1,-1),1,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
    story.append(pm)
    story.append(Spacer(1,0.3*cm))
else:
    # Devis < 400€ — paiement intégral à la fin
    VERT_L2=colors.HexColor('#F0FDF4'); VERT_B2=colors.HexColor('#BBF7D0')
    hdr_ac2=Table([[p('\U0001f4b3  Modalit\u00e9s de paiement',10,'Helvetica-Bold',MARINE),p('',8,'Helvetica',GRIS_SOFT,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
    hdr_ac2.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#F8F5EF')),('BOX',(0,0),(-1,-1),1,GRIS_LIGNE),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
    story.append(hdr_ac2)
    paiement_unique=Table([[p('\u2705  Paiement int\u00e9gral \u00e0 la fin des travaux',11,'Helvetica-Bold',MARINE),p('%.2f \u20ac'%totalHT,14,'Helvetica-Bold',OR_FONCE,TA_RIGHT)]],colWidths=[11.0*cm,7.2*cm])
    paiement_unique.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),VERT_L2),('BOX',(0,0),(-1,-1),1,GRIS_LIGNE),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('TOPPADDING',(0,0),(-1,-1),12),('BOTTOMPADDING',(0,0),(-1,-1),12)]))
    story.append(paiement_unique)
    pm2=Table([[p('\U0001f4b5 Esp\u00e8ces  \u2022  \U0001f3e6 Virement  \u2022  \U0001f4b3 CB  \u2022  \U0001f17f\ufe0f PayPal',9,'Helvetica',GRIS_SOFT,TA_CENTER)]],colWidths=[18.2*cm])
    pm2.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#FDFCF9')),('BOX',(0,0),(-1,-1),1,GRIS_LIGNE),('LINEABOVE',(0,0),(-1,-1),1,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
    story.append(pm2)
    story.append(Spacer(1,0.3*cm))
story.append(Table([[p('TVA non applicable, art. 293B du CGI',8,color=GRIS_SOFT),p('Paiement : Esp\u00e8ces  \u2022  Virement  \u2022  CB (SumUp)',8,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[9.5*cm,8.7*cm]))
story.append(Spacer(1,0.3*cm))
if doc_type=='devis':
    story.append(Spacer(1,0.15*cm))
    story.append(Table([[p('Devis valable 30 jours \u2022 Signature = acceptation \u2022 Garantie d\u00e9cennale ORUS',7.5,color=GRIS_SOFT)]],colWidths=[18.2*cm]))
    story.append(Spacer(1,0.2*cm))
    if is_signe:
        VERT_S=colors.HexColor('#16a34a'); VERT_BG_S=colors.HexColor('#f0fdf4'); VERT_L=colors.HexColor('#bbf7d0')
        date_sig=str(meta.get('datePaiement',''))
        sig_b64=meta.get('signatureBase64','')
        from reportlab.platypus import Flowable as _F
        class _SigBox(_F):
            def __init__(s,b64,w=6.2*cm,h=2.2*cm): s.b64=b64; s.w=w; s.h=h
            def wrap(s,*a): return s.w,s.h
            def draw(s):
                s.canv.setFillColor(colors.HexColor('#F8F7F4')); s.canv.setStrokeColor(colors.HexColor('#D1D5DB'))
                s.canv.setDash([4,4]); s.canv.roundRect(0,0,s.w,s.h,4,stroke=1,fill=1); s.canv.setDash([])
                if s.b64:
                    import base64 as _b64,io as _io
                    try:
                        from reportlab.lib.utils import ImageReader
                        d=_b64.b64decode(s.b64.split(',')[-1]); ir=ImageReader(_io.BytesIO(d))
                        s.canv.drawImage(ir,4,4,s.w-8,s.h-8,mask='auto')
                    except: pass
                else:
                    s.canv.setStrokeColor(colors.HexColor('#1B2A4A')); s.canv.setLineWidth(2); s.canv.setLineCap(1)
                    pts=[(0.08,0.55),(0.14,0.78),(0.18,0.42),(0.24,0.76),(0.30,0.40),(0.36,0.74),(0.43,0.44),(0.49,0.73),(0.55,0.48),(0.61,0.70),(0.67,0.46),(0.73,0.68),(0.79,0.50),(0.85,0.64),(0.91,0.52)]
                    path=s.canv.beginPath(); path.moveTo(pts[0][0]*s.w,pts[0][1]*s.h)
                    for x,y in pts[1:]: path.lineTo(x*s.w,y*s.h)
                    s.canv.drawPath(path,stroke=1,fill=0)
                    s.canv.setLineWidth(1); p2=s.canv.beginPath(); p2.moveTo(0.08*s.w,0.2*s.h); p2.lineTo(0.5*s.w,0.2*s.h); s.canv.drawPath(p2,stroke=1,fill=0)
        class _Badge(_F):
            def __init__(s,w=3.2*cm,h=3.2*cm): s.w=w; s.h=h
            def wrap(s,*a): return s.w,s.h
            def draw(s):
                cx,cy=s.w/2,s.h/2
                s.canv.setFillColor(colors.HexColor('#f0fdf4')); s.canv.setStrokeColor(colors.HexColor('#16a34a')); s.canv.setLineWidth(2)
                s.canv.circle(cx,cy,s.w/2-3,stroke=1,fill=1)
                s.canv.setStrokeColor(colors.HexColor('#16a34a')); s.canv.setLineWidth(3); s.canv.setLineCap(1); s.canv.setLineJoin(1)
                path=s.canv.beginPath(); path.moveTo(cx-0.2*s.w,cy+0.02*s.h); path.lineTo(cx-0.03*s.w,cy-0.17*s.h); path.lineTo(cx+0.22*s.w,cy+0.18*s.h)
                s.canv.drawPath(path,stroke=1,fill=0)
                s.canv.setFillColor(colors.HexColor('#16a34a')); s.canv.setFont('Helvetica-Bold',6); s.canv.drawCentredString(cx,6,'V\u00c9RIFI\u00c9')
        left_c=Table([[p('\u2705  SIGNATURE \u00c9LECTRONIQUE VALID\u00c9E',7.5,'Helvetica-Bold',VERT_S)],[Spacer(1,0.08*cm)],[p(client_nom,11,'Helvetica-Bold',MARINE)],[p('Sign\u00e9 le : '+date_sig,7.5,'Helvetica',colors.HexColor('#6b7280'))],[p('IP enregistr\u00e9e \u2022 Horodatage certifi\u00e9 \u2022 Loi n\u00b02000-230',6.5,'Helvetica',colors.HexColor('#9ca3af'))],[Spacer(1,0.12*cm)],[p('Signature du client :',7,'Helvetica-Bold',colors.HexColor('#6b7280'))],[_SigBox(sig_b64,6.2*cm,2.2*cm)]],colWidths=[9.2*cm])
        left_c.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
        right_c=Table([[_Badge(3.2*cm,3.2*cm)],[Spacer(1,0.1*cm)],[p('Certifi\u00e9 \u00e9lectroniquement',7.5,'Helvetica-Bold',VERT_S,TA_CENTER)]],colWidths=[4.8*cm])
        right_c.setStyle(TableStyle([('ALIGN',(0,0),(-1,-1),'CENTER'),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)]))
        cert=Table([[left_c,right_c]],colWidths=[9.5*cm,4.8*cm])
        cert.setStyle(TableStyle([('BOX',(0,0),(-1,-1),1.5,VERT_S),('BACKGROUND',(0,0),(0,-1),VERT_BG_S),('BACKGROUND',(1,0),(1,-1),colors.white),('LINEAFTER',(0,0),(0,-1),1,VERT_L),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),12),('BOTTOMPADDING',(0,0),(-1,-1),12),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
        story.append(cert)
    else:
        sig_t=Table([[p('\u270d\ufe0f  Signature \u00e9lectronique uniquement \u2022 Loi n\u00b02000-230',8,'Helvetica-Bold',colors.HexColor('#16a34a'),TA_CENTER)]],colWidths=[18.2*cm])
        sig_t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#f0fdf4')),('BOX',(0,0),(-1,-1),1.5,colors.HexColor('#16a34a')),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
        story.append(sig_t)
if is_signe:
    story.append(PageBreak())
    hdr_cgv=Table([[p('\u26a1  SINELEC PARIS',11,'Helvetica-Bold',BLANC),p('CONDITIONS G\u00c9N\u00c9RALES DE VENTE',11,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[8.5*cm,9*cm])
    hdr_cgv.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
    story.append(hdr_cgv); story.append(Spacer(1,0.2*cm))
    date_sig=str(meta.get('datePaiement',''))
    story.append(Table([[p('Applicables au devis n\u00b0 '+doc_num+' \u2014 Accept\u00e9es par '+client_nom+' le '+date_sig,7.5,'Helvetica',GRIS_SOFT),p('SIRET 91015824500019 \u2022 TVA non applicable art. 293B CGI',7.5,'Helvetica',GRIS_SOFT,TA_RIGHT)]],colWidths=[9.5*cm,8*cm]))
    story.append(Table([[p('',1)]],colWidths=[18.2*cm],style=[('LINEBELOW',(0,0),(-1,-1),1,OR)]))
    story.append(Spacer(1,0.15*cm))
    GRIS_L=colors.HexColor('#f8fafc')
    cgv_arts=[('Art. 1 \u2014 Devis et acceptation','Le devis est valable 30 jours. Toute commande implique l\u2019acceptation sans r\u00e9serve des pr\u00e9sentes CGV. La signature \u00e9lectronique vaut bon de commande ferme.'),('Art. 2 \u2014 Prix et paiement','TVA non applicable art. 293B CGI. Acompte 40% \u00e0 la signature si devis > 400\u20ac. Solde \u00e0 la fin des travaux. Paiement : esp\u00e8ces, virement, CB SumUp, PayPal.'),('Art. 3 \u2014 R\u00e9alisation des travaux','Travaux conform\u00e9ment \u00e0 la norme NF C 15-100. Le client s\u2019engage \u00e0 fournir un acc\u00e8s s\u00e9curis\u00e9 et informer SINELEC de toute contrainte avant intervention.'),('Art. 4 \u2014 Garanties','Garantie d\u00e9cennale ORUS Assurances (Lyon). Garantie parfait ach\u00e8vement 1 an. Ne couvre pas les d\u00e9gradations dues \u00e0 mauvaise utilisation ou intervention tierce.'),('Art. 5 \u2014 Droit de r\u00e9tractation','Droit de r\u00e9tractation 14 jours (art. L221-18 Code Conso). Ne s\u2019applique pas aux interventions d\u2019urgence expressément sollicit\u00e9es par le client.'),('Art. 6 \u2014 Responsabilit\u00e9','SINELEC ne saurait \u00eatre tenu responsable des dommages indirects. Force majeure : ex\u00e9cution suspendue sans indemnit\u00e9.'),('Art. 7 \u2014 Litiges','Solution amiable privil\u00e9gi\u00e9e. \u00c0 d\u00e9faut, comp\u00e9tence exclusive des tribunaux de Paris.')]
    for titre,texte in cgv_arts:
        r=Table([[p(titre,8,'Helvetica-Bold',MARINE),p(texte,7.5,'Helvetica',GRIS_SOFT)]],colWidths=[4.8*cm,13.4*cm])
        r.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),GRIS_L),('LINEBELOW',(0,0),(-1,-1),0.5,colors.HexColor('#e2e8f0')),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('VALIGN',(0,0),(-1,-1),'TOP')]))
        story.append(r)
    story.append(Spacer(1,0.4*cm))
    VERT_G=colors.HexColor('#16a34a')
    accept=Table([[p('\u2705  CGV lues et accept\u00e9es \u00e9lectroniquement',8,'Helvetica-Bold',VERT_G),p(client_nom+' \u2022 '+date_sig+' \u2022 Paris',8,'Helvetica-Bold',MARINE,TA_RIGHT)]],colWidths=[9*cm,8.5*cm])
    accept.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#f0fdf4')),('BOX',(0,0),(-1,-1),1.5,VERT_G),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
    story.append(accept)
    story.append(Spacer(1,0.3*cm))
    sig_cells_l=[p('Signature du client',8,'Helvetica-Bold',MARINE),p(client_nom,8,color=GRIS_SOFT),p(date_sig+' \u2022 Paris',7,color=GRIS_SOFT)]
    if sig_data_b64 and 'data:image' in sig_data_b64:
        try:
            raw_b64=sig_data_b64.split(',',1)[1]
            sig_img=Image(io.BytesIO(base64.b64decode(raw_b64)),width=5*cm,height=2*cm)
            sig_cells_l.append(sig_img)
        except: pass
    sig_tbl=Table([[sig_cells_l,[p('Signature SINELEC',8,'Helvetica-Bold',MARINE),p('Diahe',8,color=GRIS_SOFT),p('SINELEC Paris \u26a1',7,color=OR)]]],colWidths=[9*cm,9.2*cm])
    sig_tbl.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BOX',(0,0),(-1,-1),0.5,colors.HexColor('#e2e8f0')),('LEFTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8)]))
    story.append(sig_tbl)
if is_signe:
    story.append(PageBreak())
    hdr_cgv=Table([[p('\u26a1  SINELEC PARIS',11,'Helvetica-Bold',BLANC),p('CONDITIONS G\u00c9N\u00c9RALES DE VENTE',11,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[8.5*cm,9*cm])
    hdr_cgv.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
    story.append(hdr_cgv); story.append(Spacer(1,0.2*cm))
    date_sig=str(meta.get('datePaiement',''))
    story.append(Table([[p('Applicables au devis n\u00b0 '+doc_num+' \u2014 Accept\u00e9es par '+client_nom+' le '+date_sig,7.5,'Helvetica',GRIS_SOFT),p('SIRET 91015824500019 \u2022 TVA non applicable art. 293B CGI',7.5,'Helvetica',GRIS_SOFT,TA_RIGHT)]],colWidths=[9.5*cm,8*cm]))
    story.append(Table([[p('',1)]],colWidths=[18.2*cm],style=[('LINEBELOW',(0,0),(-1,-1),1,OR)]))
    story.append(Spacer(1,0.15*cm))
    GRIS_L=colors.HexColor('#f8fafc')
    cgv_arts=[('Art. 1 \u2014 Devis et acceptation','Le devis est valable 30 jours. Toute commande implique l\u2019acceptation sans r\u00e9serve des pr\u00e9sentes CGV. La signature \u00e9lectronique vaut bon de commande ferme.'),('Art. 2 \u2014 Prix et paiement','TVA non applicable art. 293B CGI. Acompte 40% \u00e0 la signature si devis > 400\u20ac. Solde \u00e0 la fin des travaux. Paiement : esp\u00e8ces, virement, CB SumUp, PayPal.'),('Art. 3 \u2014 R\u00e9alisation des travaux','Travaux conform\u00e9ment \u00e0 la norme NF C 15-100. Le client s\u2019engage \u00e0 fournir un acc\u00e8s s\u00e9curis\u00e9 et informer SINELEC de toute contrainte avant intervention.'),('Art. 4 \u2014 Garanties','Garantie d\u00e9cennale ORUS Assurances (Lyon). Garantie parfait ach\u00e8vement 1 an. Ne couvre pas les d\u00e9gradations dues \u00e0 mauvaise utilisation ou intervention tierce.'),('Art. 5 \u2014 Droit de r\u00e9tractation','Droit de r\u00e9tractation 14 jours (art. L221-18 Code Conso). Ne s\u2019applique pas aux interventions d\u2019urgence expressément sollicit\u00e9es par le client.'),('Art. 6 \u2014 Responsabilit\u00e9','SINELEC ne saurait \u00eatre tenu responsable des dommages indirects. Force majeure : ex\u00e9cution suspendue sans indemnit\u00e9.'),('Art. 7 \u2014 Litiges','Solution amiable privil\u00e9gi\u00e9e. \u00c0 d\u00e9faut, comp\u00e9tence exclusive des tribunaux de Paris.')]
    for titre,texte in cgv_arts:
        r=Table([[p(titre,8,'Helvetica-Bold',MARINE),p(texte,7.5,'Helvetica',GRIS_SOFT)]],colWidths=[4.8*cm,13.4*cm])
        r.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),GRIS_L),('LINEBELOW',(0,0),(-1,-1),0.5,colors.HexColor('#e2e8f0')),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('VALIGN',(0,0),(-1,-1),'TOP')]))
        story.append(r)
    story.append(Spacer(1,0.4*cm))
    VERT_G=colors.HexColor('#16a34a')
    accept=Table([[p('\u2705  CGV lues et accept\u00e9es \u00e9lectroniquement',8,'Helvetica-Bold',VERT_G),p(client_nom+' \u2022 '+date_sig+' \u2022 Paris',8,'Helvetica-Bold',MARINE,TA_RIGHT)]],colWidths=[9*cm,8.5*cm])
    accept.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#f0fdf4')),('BOX',(0,0),(-1,-1),1.5,VERT_G),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
    story.append(accept)
    story.append(Spacer(1,0.3*cm))
    sig_cells_l=[p('Signature du client',8,'Helvetica-Bold',MARINE),p(client_nom,8,color=GRIS_SOFT),p(date_sig+' \u2022 Paris',7,color=GRIS_SOFT)]
    if sig_data_b64 and 'data:image' in sig_data_b64:
        try:
            raw_b64=sig_data_b64.split(',',1)[1]
            sig_img=Image(io.BytesIO(base64.b64decode(raw_b64)),width=5*cm,height=2*cm)
            sig_cells_l.append(sig_img)
        except: pass
    sig_tbl=Table([[sig_cells_l,[p('Signature SINELEC',8,'Helvetica-Bold',MARINE),p('Diahe',8,color=GRIS_SOFT),p('SINELEC Paris \u26a1',7,color=OR)]]],colWidths=[9*cm,9.2*cm])
    sig_tbl.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BOX',(0,0),(-1,-1),0.5,colors.HexColor('#e2e8f0')),('LEFTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8)]))
    story.append(sig_tbl)
if is_signe:
    story.append(PageBreak())
    hdr_cgv=Table([[p('\u26a1  SINELEC PARIS',11,'Helvetica-Bold',BLANC),p('CONDITIONS G\u00c9N\u00c9RALES DE VENTE',11,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[8.5*cm,9*cm])
    hdr_cgv.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
    story.append(hdr_cgv); story.append(Spacer(1,0.2*cm))
    date_sig=str(meta.get('datePaiement',''))
    story.append(Table([[p('Applicables au devis n\u00b0 '+doc_num+' \u2014 Accept\u00e9es par '+client_nom+' le '+date_sig,7.5,'Helvetica',GRIS_SOFT),p('SIRET 91015824500019 \u2022 TVA non applicable art. 293B CGI',7.5,'Helvetica',GRIS_SOFT,TA_RIGHT)]],colWidths=[9.5*cm,8*cm]))
    story.append(Table([[p('',1)]],colWidths=[18.2*cm],style=[('LINEBELOW',(0,0),(-1,-1),1,OR)]))
    story.append(Spacer(1,0.15*cm))
    GRIS_L=colors.HexColor('#f8fafc')
    cgv_arts=[('Art. 1 \u2014 Devis et acceptation','Le devis est valable 30 jours. Toute commande implique l\u2019acceptation sans r\u00e9serve des pr\u00e9sentes CGV. La signature \u00e9lectronique vaut bon de commande ferme.'),('Art. 2 \u2014 Prix et paiement','TVA non applicable art. 293B CGI. Acompte 40% \u00e0 la signature si devis > 400\u20ac. Solde \u00e0 la fin des travaux. Paiement : esp\u00e8ces, virement, CB SumUp, PayPal.'),('Art. 3 \u2014 R\u00e9alisation des travaux','Travaux conform\u00e9ment \u00e0 la norme NF C 15-100. Le client s\u2019engage \u00e0 fournir un acc\u00e8s s\u00e9curis\u00e9 et informer SINELEC de toute contrainte avant intervention.'),('Art. 4 \u2014 Garanties','Garantie d\u00e9cennale ORUS Assurances (Lyon). Garantie parfait ach\u00e8vement 1 an. Ne couvre pas les d\u00e9gradations dues \u00e0 mauvaise utilisation ou intervention tierce.'),('Art. 5 \u2014 Droit de r\u00e9tractation','Droit de r\u00e9tractation 14 jours (art. L221-18 Code Conso). Ne s\u2019applique pas aux interventions d\u2019urgence expressément sollicit\u00e9es par le client.'),('Art. 6 \u2014 Responsabilit\u00e9','SINELEC ne saurait \u00eatre tenu responsable des dommages indirects. Force majeure : ex\u00e9cution suspendue sans indemnit\u00e9.'),('Art. 7 \u2014 Litiges','Solution amiable privil\u00e9gi\u00e9e. \u00c0 d\u00e9faut, comp\u00e9tence exclusive des tribunaux de Paris.')]
    for titre,texte in cgv_arts:
        r=Table([[p(titre,8,'Helvetica-Bold',MARINE),p(texte,7.5,'Helvetica',GRIS_SOFT)]],colWidths=[4.8*cm,13.4*cm])
        r.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),GRIS_L),('LINEBELOW',(0,0),(-1,-1),0.5,colors.HexColor('#e2e8f0')),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('VALIGN',(0,0),(-1,-1),'TOP')]))
        story.append(r)
    story.append(Spacer(1,0.4*cm))
    VERT_G=colors.HexColor('#16a34a')
    accept=Table([[p('\u2705  CGV lues et accept\u00e9es \u00e9lectroniquement',8,'Helvetica-Bold',VERT_G),p(client_nom+' \u2022 '+date_sig+' \u2022 Paris',8,'Helvetica-Bold',MARINE,TA_RIGHT)]],colWidths=[9*cm,8.5*cm])
    accept.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#f0fdf4')),('BOX',(0,0),(-1,-1),1.5,VERT_G),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
    story.append(accept)
    story.append(Spacer(1,0.3*cm))
    sig_cells_l=[p('Signature du client',8,'Helvetica-Bold',MARINE),p(client_nom,8,color=GRIS_SOFT),p(date_sig+' \u2022 Paris',7,color=GRIS_SOFT)]
    if sig_data_b64 and 'data:image' in sig_data_b64:
        try:
            raw_b64=sig_data_b64.split(',',1)[1]
            sig_img=Image(io.BytesIO(base64.b64decode(raw_b64)),width=5*cm,height=2*cm)
            sig_cells_l.append(sig_img)
        except: pass
    sig_tbl=Table([[sig_cells_l,[p('Signature SINELEC',8,'Helvetica-Bold',MARINE),p('Diahe',8,color=GRIS_SOFT),p('SINELEC Paris \u26a1',7,color=OR)]]],colWidths=[9*cm,9.2*cm])
    sig_tbl.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BOX',(0,0),(-1,-1),0.5,colors.HexColor('#e2e8f0')),('LEFTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8)]))
    story.append(sig_tbl)
doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw)); print('PDF_OK')
`;
      fs.writeFileSync(pyPath, py, 'utf8');
      console.log('🐍 Python:', pyPath, '→', pdfPath);
      try {
        execSync(`python3 "${pyPath}" "${detailsPath}" "${pdfPath}"`, {
          timeout: 60000, stdio: ['pipe','pipe','pipe']
        });
      } catch(pyErr) {
        const pyMsg = (pyErr.stderr?.toString() || '') + (pyErr.stdout?.toString() || '') || pyErr.message;
        console.error('❌ generer Python FULL error:', pyMsg.substring(0,800));
        throw new Error('PDF generation failed: ' + pyMsg.substring(0,300));
      }
      if (!fs.existsSync(pdfPath)) throw new Error('PDF non généré');
      const pdfBuffer = fs.readFileSync(pdfPath);
      pdf_b64 = pdfBuffer.toString('base64');
      try { fs.unlinkSync(pyPath); } catch(e) {}
      try { fs.unlinkSync(detailsPath); } catch(e) {}
      try { fs.unlinkSync(pdfPath); } catch(e) {}

      // Email NON envoyé automatiquement — cliquer Envoyer manuellement
    }

    res.json({ success: true, num, pdf_b64, email_client: email });
  } catch(error) {
    const msg = error.message || String(error);
    console.error('❌ /api/generer error:', msg);
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

// ═══════════════════════════════════════════════════
// API: ENVOYER EMAIL
// ═══════════════════════════════════════════════════
app.post('/api/envoyer/:num', authMiddleware, async (req, res) => {
  try {
    const { num } = req.params;
    const { email, sujet, message, cc, pdfB64, sms, telephone } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis' });

    // Récupérer le PDF
    let pdf_b64 = pdfB64;
    if (!pdf_b64) {
      const { data: doc } = await supabase.from('historique').select('*').eq('num', num).single();
      if (doc) {
        // Générer le PDF à la volée
        try {
          const pdfRes = await fetch(`${process.env.APP_URL || 'https://sinelec-api-production.up.railway.app'}/api/pdf/${num}`, {
            headers: { 'Authorization': req.headers['authorization'] || '' }
          });
          if (pdfRes.ok) {
            const buf = await pdfRes.arrayBuffer();
            pdf_b64 = Buffer.from(buf).toString('base64');
          }
        } catch(e) { console.error('PDF fetch:', e.message); }
      }
    }

    const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
    const lienSig = `${appUrl}/api/track/click/${num}?redirect=/signer/${num}`;
    const docTypeLocal = num.startsWith('OS-') ? 'devis' : 'facture';

    const signatureBlock = docTypeLocal === 'devis' ? `
      <div style="background:#fffbf0;border:1.5px solid #C9A84C;border-radius:12px;padding:20px;text-align:center;margin:20px 0;">
        <p style="font-size:13px;color:#555;margin-bottom:16px;">Pour accepter ce devis, signez-le directement en ligne :</p>
        <a href="${lienSig}" style="background:linear-gradient(135deg,#C9A84C,#daa520);color:#fff;text-decoration:none;border-radius:10px;padding:14px 28px;font-size:15px;font-weight:800;display:inline-block;">✍️ Signer le devis en ligne</a>
        <p style="font-size:11px;color:#aaa;margin-top:12px;">Signature électronique valide — Loi n°2000-230</p>
      </div>` : '';

    const htmlEmail = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#1B2A4A,#243660);padding:24px;text-align:center;border-radius:12px 12px 0 0;">
        <div style="font-size:28px;">⚡</div>
        <h2 style="color:#fff;margin:8px 0 0;font-size:16px;">SINELEC Paris</h2>
      </div>
      <div style="padding:24px;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 12px 12px;">
        <p style="white-space:pre-wrap;font-size:14px;color:#333;line-height:1.6;">${(message || '').replace(/</g,'&lt;')}</p>
        ${signatureBlock}
        ${docTypeLocal === 'devis' ? `<div style="background:#1e2a3a;border-left:3px solid #C9A84C;border-radius:8px;padding:12px 14px;margin:16px 0;"><p style="color:#C9A84C;font-size:11px;font-weight:700;margin:0 0 6px;">📋 CONDITIONS GÉNÉRALES DE VENTE</p><p style="color:#9ca3af;font-size:11px;line-height:1.6;margin:0;">En signant ce devis, vous reconnaissez avoir pris connaissance et acceptez sans réserve les CGV de SINELEC Paris. Les CGV complètes sont affichées lors de la signature en ligne.</p></div>` : ''}
        <p style="font-size:12px;color:#888;margin-top:16px;">📞 07 87 38 86 22 | sinelec.paris@gmail.com</p>
      </div>
    </div>`;

    // Pixel espion
    const htmlWithPixel = htmlEmail + `<img src="${appUrl}/api/track/open/${num}" width="1" height="1" style="display:none">`;

    const attachment = pdf_b64 ? { content: pdf_b64, name: `${num}.pdf` } : null;
    const emailRes = await envoyerEmail(email, sujet || `Document ${num} - SINELEC`, htmlWithPixel, attachment);

    // CC si fourni
    if (cc) { try { await envoyerEmail(cc, sujet || `Document ${num}`, htmlWithPixel, attachment); } catch(e) {} }

    // SMS si demandé
    if (sms && telephone) {
      const smsMsg = `Bonjour, votre devis SINELEC n°${num} est prêt. Signez-le ici : ${appUrl}/signer/${num} — SINELEC ⚡`;
      await envoyerSMS(telephone, smsMsg);
    }

    await supabase.from('historique').update({ statut: 'envoye', date_envoi: new Date().toISOString() }).eq('num', num);
    res.json({ success: true });
  } catch(error) {
    console.error('❌ /api/envoyer error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════
// API: TRACKING EMAIL OPEN (pixel espion)
// ═══════════════════════════════════════════════════
app.get('/api/track/open/:num', async (req, res) => {
  const { num } = req.params;
  try {
    const { data } = await supabase.from('historique').select('nb_ouvertures').eq('num', num).single();
    const nb = ((data?.nb_ouvertures) || 0) + 1;
    const now = new Date().toISOString();
    await supabase.from('historique').update({
      email_ouvert: true,
      nb_ouvertures: nb,
      derniere_ouverture: now,
      premiere_ouverture: data?.premiere_ouverture || now
    }).eq('num', num);
  } catch(e) {}
  // Return 1x1 transparent gif
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.send(gif);
});

// ═══════════════════════════════════════════════════
// API: EMAIL OPENS RECENT (polling frontend)
// ═══════════════════════════════════════════════════
app.get('/api/email-opens-recent', authMiddleware, async (req, res) => {
  try {
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 dernières minutes
    const { data } = await supabase.from('historique')
      .select('num, client, type, nb_ouvertures, derniere_ouverture')
      .eq('email_ouvert', true)
      .gte('derniere_ouverture', since)
      .order('derniere_ouverture', { ascending: false })
      .limit(10);
    res.json(data || []);
  } catch(e) { res.json([]); }
});

// ═══════════════════════════════════════════════════
// API: SIGNATURE CLIENT
// ═══════════════════════════════════════════════════
app.post('/api/signature', async (req, res) => {
  try {
    const { num, signature, ip } = req.body;
    if (!num) return res.status(400).json({ error: 'num requis' });
    const sigPath = path.join('/tmp', `sig_${num}.png`);
    if (signature) {
      const b64 = signature.replace(/^data:image\/[a-z]+;base64,/, '');
      fs.writeFileSync(sigPath, Buffer.from(b64, 'base64'));
    }
    const now = new Date().toISOString();
    const { error: updErr } = await supabase.from('historique').update({
      statut: 'signe',
      date_signature: now,
      signature_ip: ip || null,
      signature_data: signature || null
    }).eq('num', num);
    if (updErr) console.error('❌ Signature update error:', updErr.message);
    else console.log('✅ Signature sauvegardée pour', num, '| data length:', (signature||'').length);

    // Emails avec PDF signé en pièce jointe
    const { data: doc } = await supabase.from('historique').select('*').eq('num', num).single();
    if (doc) {
      // Générer le PDF signé via appel interne
      let pdfAttachment = null;
      const appUrlLocal = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
      try {
        const pdfRes = await fetch(appUrlLocal + '/api/pdf/' + num, {
          headers: { 'Authorization': 'Bearer ' + genererToken() },
          signal: AbortSignal.timeout(25000)
        });
        console.log('📄 PDF pour email:', num, '| status:', pdfRes.status, '| content-type:', pdfRes.headers.get('content-type'));
        if (pdfRes.ok) {
          const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
          console.log('📄 PDF buffer size:', pdfBuf.length, 'bytes');
          if (pdfBuf.length > 500) {
            pdfAttachment = { content: pdfBuf.toString('base64'), name: num + '_signe.pdf' };
            console.log('✅ PDF prêt pour pièce jointe');
          }
        } else {
          const errText = await pdfRes.text();
          console.error('❌ PDF route error:', pdfRes.status, errText.substring(0,100));
        }
      } catch(pdfErr) { console.error('❌ PDF fetch error:', pdfErr.message); }

      const dateSign = new Date().toLocaleDateString('fr-FR');
      const montant = (doc.total_ht||0).toFixed(0);

      // Email client (si email dispo)
      if (doc.email) {
        const htmlClient = '<div style="font-family:Arial,sans-serif;max-width:480px;">'
          + '<div style="background:linear-gradient(135deg,#1B2A4A,#243660);padding:20px;text-align:center;border-radius:12px 12px 0 0;">'
          + '<div style="font-size:32px">✍️</div>'
          + '<h2 style="color:#fff;margin:8px 0 0">Devis signé — SINELEC</h2></div>'
          + '<div style="padding:24px;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 12px 12px;">'
          + '<p>Bonjour,</p>'
          + '<p>Votre devis <strong>' + num + '</strong> a bien été signé le ' + dateSign + '. Le document signé est en pièce jointe.</p>'
          + '<p>Nous vous recontacterons rapidement pour planifier l’intervention.</p>'
          + '<p><a href="' + appUrlLocal + '/api/pdf/' + num + '" style="background:#1B2A4A;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;">Télécharger le PDF signé</a></p>'
          + '<p style="font-size:12px;color:#888">☎️ 07 87 38 86 22 | sinelec.paris@gmail.com</p>'
          + '</div></div>';
        try { await envoyerEmail(doc.email, 'Devis ' + num + ' signé — SINELEC Paris', htmlClient, pdfAttachment); }
        catch(e) { console.error('Email client signature:', e.message); }
      }

      // Email Diahe — TOUJOURS envoyé avec PDF
      const htmlDiahe = '<div style="font-family:Arial,sans-serif;max-width:440px;">'
        + '<div style="background:#1B2A4A;padding:18px;border-radius:10px 10px 0 0;text-align:center;">'
        + '<div style="font-size:40px">✍️</div>'
        + '<h2 style="color:#16a34a;margin:8px 0 0">Devis SIGNÉ !</h2></div>'
        + '<div style="padding:20px;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 10px 10px;">'
        + '<p><b>Client :</b> ' + (doc.client||'') + '</p>'
        + '<p><b>Devis :</b> ' + num + '</p>'
        + '<p><b>Montant :</b> <span style="color:#C9962A;font-size:16px;font-weight:700">' + montant + ' €</span></p>'
        + '<p><b>Signé le :</b> ' + dateSign + '</p>'
        + (doc.adresse ? '<p><b>Adresse :</b> ' + doc.adresse + '</p>' : '')
        + '</div></div>';
      try { await envoyerEmail('sinelec.paris@gmail.com', '✍️ Signé — ' + (doc.client||'') + ' — ' + num + ' — ' + montant + '€', htmlDiahe, pdfAttachment); }
      catch(e) { console.error('Email Diahe signature:', e.message); }
    }
    res.json({ success: true });
  } catch(error) {
    console.error('❌ /api/signature error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════
// API: CHECK SIGNATURE
// ═══════════════════════════════════════════════════
app.get('/api/historique/:num/check-signature', async (req, res) => {
  try {
    const { num } = req.params;
    const { data } = await supabase.from('historique').select('statut, date_signature').eq('num', num).single();
    res.json({ statut: data?.statut || 'envoye', date_signature: data?.date_signature || null });
  } catch(e) { res.json({ statut: 'envoye' }); }
});

// ═══════════════════════════════════════════════════
// API: PAGE SIGNER (public)
// ═══════════════════════════════════════════════════
app.get('/signer/:num', async (req, res) => {
  const { num } = req.params;
  const { data: doc } = await supabase.from('historique').select('*').eq('num', num).single();
  if (!doc) return res.status(404).send('<h1>Document introuvable</h1>');
  const statut = (doc.statut || '').toLowerCase();
  if (['signe','signé'].includes(statut)) {
    return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Déjà signé</title></head><body style="font-family:Arial;text-align:center;padding:40px;"><h2>✅ Devis déjà signé</h2><p>Le devis ${num} a déjà été signé. Merci !</p><p>📞 07 87 38 86 22</p></body></html>`);
  }
  const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
  const telClient = (doc.telephone || '').replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 ** ** $5');
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signature — ${num}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f1929;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:16px;font-family:'Segoe UI',Arial,sans-serif}
.card{background:#fff;border-radius:16px;width:100%;max-width:480px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.4)}
.hdr{background:#1B2A4A;padding:18px 20px;text-align:center;border-bottom:3px solid #C9A84C}
.hdr-icon{font-size:26px;margin-bottom:4px}
.hdr-title{color:#fff;font-size:16px;font-weight:700}
.hdr-num{background:rgba(201,164,76,0.2);border:1px solid #C9A84C;border-radius:20px;padding:3px 12px;color:#C9A84C;font-size:11px;font-weight:700;display:inline-block;margin-top:5px}
.hdr-client{color:rgba(255,255,255,0.5);font-size:11px;margin-top:5px}
.steps{display:flex;justify-content:center;gap:0;padding:14px 20px 0;position:relative}
.steps::before{content:'';position:absolute;top:25px;left:80px;right:80px;height:2px;background:#e5e7eb;z-index:0}
.step{display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;position:relative;z-index:1}
.step-c{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid}
.step-c.done{background:#16a34a;border-color:#16a34a;color:#fff}
.step-c.active{background:#1B2A4A;border-color:#1B2A4A;color:#fff}
.step-c.pending{background:#fff;border-color:#d1d5db;color:#9ca3af}
.step-l{font-size:9px;color:#6b7280;text-align:center;font-weight:500}
.step-l.active{color:#1B2A4A;font-weight:700}
.body{padding:18px 20px}
.sec-title{font-size:12px;font-weight:700;color:#1B2A4A;margin-bottom:10px;display:flex;align-items:center;gap:5px}
.cgv-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:14px;max-height:130px;overflow-y:auto}
.cgv-text{font-size:10.5px;color:#64748b;line-height:1.65}
.cgv-text strong{color:#1B2A4A;display:block;margin-top:8px;margin-bottom:2px}
.cgv-text strong:first-child{margin-top:0}
.checks{display:flex;flex-direction:column;gap:9px;margin-bottom:18px}
.check-item{display:flex;align-items:flex-start;gap:10px;padding:11px;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;cursor:pointer;transition:all .2s}
.check-item.on{background:#f0fdf4;border-color:#16a34a}
.check-box{width:20px;height:20px;border-radius:5px;border:2px solid #d1d5db;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;transition:all .2s;margin-top:1px}
.check-item.on .check-box{background:#16a34a;border-color:#16a34a;color:#fff}
.check-txt{font-size:11.5px;color:#374151;line-height:1.5}
.check-txt strong{color:#1B2A4A;display:block;margin-bottom:1px;font-size:12px}
.sms-box{background:#fffbf0;border:1.5px solid #C9A84C;border-radius:10px;padding:14px;margin-bottom:18px}
.sms-title{font-size:12px;font-weight:700;color:#1B2A4A;margin-bottom:3px}
.sms-sub{font-size:10.5px;color:#92400e;margin-bottom:11px}
.sms-row{display:flex;gap:8px}
.sms-inp{flex:1;border:1.5px solid #d1d5db;border-radius:8px;padding:11px;font-size:20px;letter-spacing:8px;text-align:center;font-weight:700;color:#1B2A4A;outline:none}
.sms-inp:focus{border-color:#C9A84C}
.btn-sms{background:#1B2A4A;color:#fff;border:none;border-radius:8px;padding:11px 12px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap}
.sms-ok{font-size:11px;color:#16a34a;margin-top:7px;display:none}
.sig-hint{font-size:11px;color:#9ca3af;text-align:center;margin-bottom:6px}
.sig-wrap{border:1.5px dashed #d1d5db;border-radius:10px;background:#fafafa;position:relative;overflow:hidden;margin-bottom:10px}
canvas{display:block;width:100%;height:150px;cursor:crosshair;touch-action:none}
.sig-erase{position:absolute;top:7px;right:7px;background:rgba(0,0,0,0.06);border:none;border-radius:6px;padding:4px 10px;font-size:10px;color:#6b7280;cursor:pointer}
.btn-val{width:100%;background:linear-gradient(135deg,#1B2A4A,#243660);color:#fff;border:none;border-radius:10px;padding:15px;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;margin-bottom:12px}
.btn-val:disabled{background:#e5e7eb;color:#9ca3af;cursor:not-allowed}
.btn-next{width:100%;background:linear-gradient(135deg,#1B2A4A,#243660);color:#fff;border:none;border-radius:10px;padding:15px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:12px}
.btn-next:disabled{background:#e5e7eb;color:#9ca3af;cursor:not-allowed}
.ftr{padding:12px 20px;background:#f8fafc;border-top:1px solid #f0f0f0;text-align:center}
.ftr-txt{font-size:9.5px;color:#9ca3af}
#msg{text-align:center;font-weight:700;font-size:13px;margin-top:8px;min-height:20px}
.hidden{display:none!important}
</style>
</head>
<body>
<div class="card">
  <div class="hdr">
    <div class="hdr-icon">⚡</div>
    <div class="hdr-title">Signature électronique</div>
    <div class="hdr-num">${num} · ${(doc.total_ht||0).toFixed(2)} €</div>
    <div class="hdr-client">${doc.client}</div>
  </div>

  <div class="steps" id="steps">
    <div class="step"><div class="step-c active" id="sc1">1</div><div class="step-l active" id="sl1">CGV</div></div>
    <div class="step"><div class="step-c pending" id="sc2">2</div><div class="step-l" id="sl2">Code SMS</div></div>
    <div class="step"><div class="step-c pending" id="sc3">3</div><div class="step-l" id="sl3">Signature</div></div>
  </div>

  <!-- ÉTAPE 1 : CGV + CASES -->
  <div class="body" id="step1">
    <div class="sec-title">📋 Conditions générales de vente</div>
    <div class="cgv-box">
      <div class="cgv-text">
        <strong>1. Devis et acceptation</strong>Le devis est valable 30 jours. Toute commande implique l'acceptation sans réserve des présentes CGV. La signature vaut bon de commande.
        <strong>2. Prix et paiement</strong>TVA non applicable art. 293B CGI. Acompte 40% à la signature si devis > 400€. Solde à la fin des travaux. CB, espèces, virement acceptés.
        <strong>3. Réalisation des travaux</strong>Travaux conformes NF C 15-100. Le client s'engage à fournir un accès sécurisé et à informer de toute contrainte particulière.
        <strong>4. Garanties</strong>Garantie décennale ORUS Assurances. Garantie parfait achèvement 1 an. Ne couvre pas les dégradations dues à une mauvaise utilisation.
        <strong>5. Rétractation</strong>Droit de rétractation 14 jours (art. L221-18 Code Conso). Ne s'applique pas en cas d'urgence confirmée.
        <strong>6. Responsabilité</strong>SINELEC ne peut être tenu responsable des dommages indirects. Force majeure : exécution suspendue sans indemnité.
        <strong>7. Litiges</strong>Solution amiable privilégiée. À défaut, compétence exclusive des tribunaux de Paris.
      </div>
    </div>
    <div class="checks" id="checks">
      <div class="check-item" onclick="toggle(this)"><div class="check-box"></div><div class="check-txt"><strong>J'ai lu et j'accepte les CGV</strong>J'ai pris connaissance des conditions générales de vente SINELEC Paris</div></div>
      <div class="check-item" onclick="toggle(this)"><div class="check-box"></div><div class="check-txt"><strong>J'accepte le devis et le montant</strong>Je valide les prestations et le montant total de ${(doc.total_ht||0).toFixed(2)} €</div></div>
      <div class="check-item" onclick="toggle(this)"><div class="check-box"></div><div class="check-txt"><strong>Je confirme mes informations</strong>Mes coordonnées et adresse de chantier sont exactes</div></div>
    </div>
    <button class="btn-next" id="btn1" disabled onclick="goStep2()">Continuer →</button>
  </div>

  <!-- ÉTAPE 2 : CODE SMS -->
  <div class="body hidden" id="step2">
    <div class="sms-box">
      <div class="sms-title">📱 Vérification par SMS</div>
      <div class="sms-sub" id="sms-tel">Envoi du code sur votre mobile...</div>
      <div class="sms-row">
        <input class="sms-inp" id="otp-inp" type="text" maxlength="6" placeholder="_ _ _ _ _ _" inputmode="numeric">
        <button class="btn-sms" onclick="renvoyerCode()">Renvoyer</button>
      </div>
      <div class="sms-ok" id="sms-ok">✅ Code envoyé par SMS</div>
    </div>
    <button class="btn-next" id="btn2" disabled onclick="goStep3()">Vérifier et continuer →</button>
    <div id="msg2" style="text-align:center;font-size:12px;color:#dc2626;margin-top:6px;min-height:16px"></div>
  </div>

  <!-- ÉTAPE 3 : SIGNATURE -->
  <div class="body hidden" id="step3">
    <div class="sec-title">✍️ Votre signature</div>
    <div class="sig-hint">Signez avec votre doigt dans le cadre ci-dessous</div>
    <div class="sig-wrap">
      <canvas id="sig" height="150"></canvas>
      <button class="sig-erase" onclick="effacer()">Effacer</button>
    </div>
    <button class="btn-val" id="btn-val" onclick="valider()">✅ Valider et signer le devis</button>
    <div id="msg"></div>
  </div>

  <div class="ftr">
    <div class="ftr-txt">🔒 Signature électronique valide — Loi n°2000-230 du 13 mars 2000<br>SINELEC EI · SIRET 91015824500019</div>
  </div>
</div>

<script>
const NUM='${num}';
const TEL='${doc.telephone||""}';
const APP='${appUrl}';

// ── Étape 1 : cases à cocher ──
function toggle(el){
  el.classList.toggle('on');
  el.querySelector('.check-box').textContent = el.classList.contains('on') ? '✓' : '';
  const all = document.querySelectorAll('.check-item');
  document.getElementById('btn1').disabled = ![...all].every(c=>c.classList.contains('on'));
}

async function goStep2(){
  document.getElementById('step1').classList.add('hidden');
  document.getElementById('step2').classList.remove('hidden');
  setStep(2);
  await envoyerOTP();
}

async function envoyerOTP(){
  try {
    const r = await fetch(APP+'/api/otp-signature',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({num:NUM,telephone:TEL})});
    const d = await r.json();
    if(d.success){
      const telMasq = TEL.replace(/(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})/,'$1 $2 ** ** $5');
      document.getElementById('sms-tel').textContent = 'Code envoyé au ' + (telMasq||'votre mobile');
      document.getElementById('sms-ok').style.display='flex';
    }
  } catch(e){}
}

async function renvoyerCode(){ await envoyerOTP(); }

document.getElementById('otp-inp').addEventListener('input', function(){
  document.getElementById('btn2').disabled = this.value.length < 6;
});

async function goStep3(){
  const code = document.getElementById('otp-inp').value.trim();
  try {
    const r = await fetch(APP+'/api/verifier-otp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({num:NUM,code})});
    const d = await r.json();
    if(d.success){
      document.getElementById('step2').classList.add('hidden');
      document.getElementById('step3').classList.remove('hidden');
      setStep(3);
      initCanvas();
    } else {
      document.getElementById('msg2').textContent = '❌ Code incorrect ou expiré';
    }
  } catch(e){
    document.getElementById('msg2').textContent = '❌ Erreur vérification';
  }
}

// ── Étape 3 : canvas signature ──
let cv, ctx, drawing=false;
function initCanvas(){
  cv = document.getElementById('sig');
  ctx = cv.getContext('2d');
  cv.width = cv.offsetWidth * window.devicePixelRatio;
  cv.height = 150 * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  ctx.strokeStyle='#1B2A4A'; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.lineJoin='round';
  const pos=e=>{const r=cv.getBoundingClientRect();return e.touches?{x:e.touches[0].clientX-r.left,y:e.touches[0].clientY-r.top}:{x:e.clientX-r.left,y:e.clientY-r.top};};
  cv.addEventListener('mousedown',e=>{drawing=true;ctx.beginPath();const p=pos(e);ctx.moveTo(p.x,p.y);});
  cv.addEventListener('mousemove',e=>{if(!drawing)return;const p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();});
  cv.addEventListener('mouseup',()=>drawing=false);
  cv.addEventListener('touchstart',e=>{e.preventDefault();drawing=true;ctx.beginPath();const p=pos(e);ctx.moveTo(p.x,p.y);},{passive:false});
  cv.addEventListener('touchmove',e=>{e.preventDefault();if(!drawing)return;const p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();},{passive:false});
  cv.addEventListener('touchend',()=>drawing=false);
}
function effacer(){ if(ctx) ctx.clearRect(0,0,cv.width,cv.height); }

async function valider(){
  const msg=document.getElementById('msg');
  const btn=document.getElementById('btn-val');
  btn.disabled=true; msg.textContent='⏳ Enregistrement...'; msg.style.color='#C9A84C';
  try {
    const r=await fetch(APP+'/api/signature',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({num:NUM,signature:cv.toDataURL('image/png'),ip:''})});
    const d=await r.json();
    if(d.success){
      msg.textContent='✅ Devis signé ! Merci, nous vous recontactons.';
      msg.style.color='#16a34a';
    } else {
      msg.textContent='❌ Erreur: '+(d.error||'Inconnue');
      msg.style.color='#dc2626';
      btn.disabled=false;
    }
  } catch(e){
    msg.textContent='❌ Erreur réseau';
    msg.style.color='#dc2626';
    btn.disabled=false;
  }
}

function setStep(n){
  [1,2,3].forEach(i=>{
    const c=document.getElementById('sc'+i);
    const l=document.getElementById('sl'+i);
    if(i<n){c.className='step-c done';c.textContent='✓';}
    else if(i===n){c.className='step-c active';l.className='step-l active';}
    else{c.className='step-c pending';l.className='step-l';}
  });
}
</script>
</body>
</html>`);
});

// ═══════════════════════════════════════════════════
// API: CA COMPLET (historique + obat)
// ═══════════════════════════════════════════════════
app.get('/api/ca-complet', async (req, res) => {
  try {
    // Données app
    const { data: app_docs, error: err1 } = await supabase.from('historique').select('*').order('created_at', { ascending: false });
    // Données OBAT
    const { data: obat_docs, error: err2 } = await supabase.from('factures_obat').select('*').order('date_facture', { ascending: false });
    const docs = [];
    (app_docs || []).forEach(d => docs.push({ ...d, source: 'app' }));
    (obat_docs || []).forEach(d => docs.push({
      num: d.reference || d.num,
      type: 'facture',
      client: d.client || d.client_nom,
      total_ht: d.montant_ht || d.total_ht,
      statut: d.statut || 'paye',
      created_at: d.date_facture ? d.date_facture + 'T00:00:00.000Z' : d.created_at,
      date: d.date_facture,
      source: 'obat',
      prestations: d.prestations || []
    }));
    docs.sort((a,b) => new Date(b.created_at||b.date) - new Date(a.created_at||a.date));
    res.json(docs);
  } catch(error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/historique', async (req, res) => {
  try {
    const { type, statut } = req.query;
    let query = supabase.from('historique').select('*').order('created_at', { ascending: false });
    if (type) query = query.eq('type', type);
    if (statut) query = query.eq('statut', statut);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: HISTORIQUE CRUD
// ═══════════════════════════════════════════════════
app.delete('/api/historique/:num', async (req, res) => {
  try {
    const { num } = req.params;
    const { error } = await supabase.from('historique').delete().eq('num', num);
    if (error) throw error;
    // Cleanup PDF files
    ['', '_dl_', '_dl_details_'].forEach(p => {
      try { fs.unlinkSync(path.join('/tmp', `${p}${num}.pdf`)); } catch(e) {}
      try { fs.unlinkSync(path.join('/tmp', `${p}${num}.json`)); } catch(e) {}
    });
    res.json({ success: true });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

app.patch('/api/historique/:num/statut', async (req, res) => {
  try {
    const { num } = req.params;
    const updates = req.body;
    const { error } = await supabase.from('historique').update(updates).eq('num', num);
    if (error) throw error;
    res.json({ success: true });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════
// API: MARQUER PAYÉ
// ═══════════════════════════════════════════════════
app.post('/api/marquer-paye', async (req, res) => {
  try {
    const { num, mode_paiement } = req.body;
    const now = new Date().toISOString();
    const { error } = await supabase.from('historique').update({
      statut: 'paye', mode_paiement: mode_paiement || 'terminal',
      date_paiement: now
    }).eq('num', num);
    if (error) throw error;

    // Générer PDF acquitté et envoyer au client
    setImmediate(async () => {
      try {
        const { data: doc } = await supabase.from('historique').select('*').eq('num', num).single();
        if (doc && doc.email) {
          // Récupérer le PDF régénéré avec tampon PAYÉ
          const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
          const token = genererToken();
          const pdfRes = await fetch(`${appUrl}/api/pdf/${num}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          let pdf_b64 = null;
          if (pdfRes.ok) {
            const buf = await pdfRes.arrayBuffer();
            pdf_b64 = Buffer.from(buf).toString('base64');
          }
          const html = `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;">
            <div style="background:linear-gradient(135deg,#1B2A4A,#243660);padding:24px;text-align:center;border-radius:12px 12px 0 0;">
              <div style="font-size:36px;">💰</div>
              <h2 style="color:#E8B84B;margin:8px 0 0;">Facture acquittée</h2>
            </div>
            <div style="padding:24px;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 12px 12px;">
              <p>Bonjour <strong>${extractPrenom(doc.client)}</strong>,</p>
              <p>Votre règlement pour la facture <strong>${num}</strong> a bien été enregistré.</p>
              <p>Retrouvez ci-joint votre facture acquittée.</p>
              <p style="font-size:12px;color:#888;">Merci pour votre confiance ! ⭐ <a href="https://g.page/r/CSw-MABnFUAYEAE/review">Laisser un avis Google</a></p>
            </div>
          </div>`;
          await envoyerEmail(doc.email, `Facture acquittée ${num} — SINELEC Paris`, html, pdf_b64 ? { content: pdf_b64, name: `${num}_acquittee.pdf` } : null);
          console.log(`✅ Facture acquittée envoyée: ${num} → ${doc.email}`);
        }

        // ── SMS avis Google automatique (si téléphone et pas encore envoyé) ──
        if (doc && doc.telephone && !doc.sms_avis_envoye) {
          try {
            const prenom = extractPrenom(doc.client || '');
            const smsAvis = `Bonjour ${prenom}, merci pour votre confiance ! ⚡ Un petit avis Google nous aiderait beaucoup : https://g.page/r/CSw-MABnFUAYEAE/review — Diahe, SINELEC Paris`;
            await envoyerSMS(doc.telephone, smsAvis);
            await supabase.from('historique').update({
              sms_avis_envoye: true,
              sms_avis_date: new Date().toISOString(),
              sms_avis_statut: 'envoye_auto'
            }).eq('num', num);
            console.log(`✅ SMS avis Google auto envoyé: ${num} → ${doc.telephone}`);
          } catch(e) { console.error('SMS avis auto error:', e.message); }
        }

      } catch(e) { console.error('Facture acquittée email error:', e.message); }
    });

    res.json({ success: true });
  } catch(error) { res.status(500).json({ error: error.message }); }
});


// ═══════════════════════════════════════════════════
// API: ENVOI SMS LIEN SIGNATURE
// ═══════════════════════════════════════════════════
app.post('/api/envoyer-lien-signature/:num', async (req, res) => {
  try {
    const { num } = req.params;
    const { telephone } = req.body;
    const { data: doc } = await supabase.from('historique').select('*').eq('num', num).single();
    if (!doc) return res.status(404).json({ error: 'Devis non trouve' });
    const tel = telephone || doc.telephone;
    if (!tel) return res.status(400).json({ error: 'Numero de telephone manquant' });
    const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
    const lienSig = appUrl + '/signer/' + num;
    const prenom = extractPrenom(doc.client || '');
    const montant = parseFloat(doc.total_ht || 0).toFixed(0);
    const msg = 'Bonjour ' + prenom + ', votre devis SINELEC n°' + num + ' (' + montant + '€) est prêt. Signez-le ici : ' + lienSig + ' — Diahe ⚡';
    await envoyerSMS(tel, msg);
    await supabase.from('historique').update({ sms_signature_envoye: true, sms_signature_date: new Date().toISOString() }).eq('num', num);
    res.json({ success: true, lien: lienSig, telephone: tel });
  } catch(e) {
    console.error('/api/envoyer-lien-signature error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// API: SMS
// ═══════════════════════════════════════════════════
app.post('/api/sms', authMiddleware, async (req, res) => {
  try {
    const { telephone, message } = req.body;
    if (!telephone || !message) return res.status(400).json({ error: 'telephone et message requis' });
    const msgId = await envoyerSMS(telephone, message);
    res.json({ success: true, messageId: msgId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: SMS AVIS GOOGLE
// ═══════════════════════════════════════════════════
app.post('/api/envoyer-sms-avis/:num', async (req, res) => {
  try {
    const { num } = req.params;
    const { data: doc } = await supabase.from('historique').select('*').eq('num', num).single();
    if (!doc) return res.status(404).json({ error: 'Document non trouvé' });
    if (!doc.telephone) return res.status(400).json({ error: 'Pas de téléphone pour ce client' });
    const prenom = extractPrenom(doc.client);
    const msg = `Bonjour ${prenom}, merci pour votre confiance ! Un avis Google nous aiderait beaucoup : https://g.page/r/CSw-MABnFUAYEAE/review — Diahe, SINELEC ⚡`;
    const msgId = await envoyerSMS(doc.telephone, msg);
    const now = new Date().toISOString();
    await supabase.from('historique').update({
      sms_avis_envoye: true,
      sms_avis_date: now,
      sms_avis_statut: 'envoye',
      sms_message_id: msgId || null
    }).eq('num', num);
    res.json({ success: true, date: now });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: PDF (régénéré depuis Supabase)
// ═══════════════════════════════════════════════════
app.get('/api/pdf/:num', async (req, res) => {
  try {
    const { num } = req.params;
    const { data, error } = await supabase.from('historique').select('*').eq('num', num).single();
    if (error || !data) return res.status(404).json({ error: 'Document non trouvé' });

    const docType = data.type || (num.startsWith('OS-') ? 'devis' : 'facture');
    const docStatut = data.statut || '';
    const isPaye = ['paye','payé','payee','acquitte','acquitté'].includes(docStatut.toLowerCase());
    const typeLabelUpper = docType === 'devis' ? 'DEVIS' : (isPaye ? 'FACTURE ACQUITTEE' : 'FACTURE');
    const dateStr = new Date(data.date_envoi || data.created_at).toLocaleDateString('fr-FR');
    const dateValide = new Date(new Date(data.date_envoi || data.created_at).getTime() + 30*24*60*60*1000).toLocaleDateString('fr-FR');

    const detailsPath = path.join('/tmp', `_dl_details_${num}.json`);
    const pyPath = path.join('/tmp', `_dl_${num}.py`);
    const pdfPath = path.join('/tmp', `_dl_${num}.pdf`);

    let prestationsArr = data.prestations || [];
    if (typeof prestationsArr === 'string') { try { prestationsArr = JSON.parse(prestationsArr); } catch(e) { prestationsArr = []; } }
    const clientEscDl = String(data.client || '').replace(/['"\\]/g, ' ');
    const addrPartsDl = (data.adresse || '').split(',');
    const itemsArr = prestationsArr.map(p => ({
      designation: p.nom || p.designation || '', qte: p.quantite || 1,
      prixUnit: p.prix || 0, total: (p.prix || 0) * (p.quantite || 1),
      details: p.desc ? [p.desc] : []
    }));
    const datePaiement = data.date_paiement ? new Date(data.date_paiement).toLocaleDateString('fr-FR') : dateStr;
    const modePaiement = String(data.mode_paiement || 'Règlement reçu').replace(/'/g,' ').substring(0,30);
    const jsonPayloadDl = {
      _meta: {
        type: docType, num,
        typeLabelUpper,
        dateStr, dateValide,
        clientNom: clientEscDl,
        clientRue: String(addrPartsDl[0] || '').trim(),
        clientVille: addrPartsDl.slice(1).join(',').trim(),
        clientTel: data.telephone || '',
        clientSiret: '',
        descObjet: String(data.description || 'Travaux electricite').substring(0,120),
        isPaye, isSigne: ['signe','signé'].includes(docStatut.toLowerCase()),
        datePaiement, modePaiement, nomCourt: clientEscDl.toUpperCase().split(' ').slice(0,2).join(' ').substring(0,14),
        signatureData: data.signature_data || '',
        dateSignature: data.date_signature ? new Date(data.date_signature).toLocaleDateString('fr-FR') : ''
      },
      _items: itemsArr
    };
    fs.writeFileSync(detailsPath, JSON.stringify(jsonPayloadDl));

    const clientEsc = String(data.client || '').replace(/'/g, ' ');
    const addrParts = (data.adresse || '').split(',');
    const clientRue = String(addrParts[0] || '').trim().replace(/'/g, ' ');
    const clientVille = addrParts.slice(1).join(',').trim().replace(/'/g, ' ');
    const nomCourt = clientEsc.toUpperCase().split(' ').slice(0,2).join(' ').substring(0,14);
    const descObjet = String(data.description || 'Travaux d electricite generale').replace(/'/g,' ').replace(/"/g,' ').substring(0,120);
    const totalHT = itemsArr.reduce((s,l) => s + l.total, 0);

    const py = `# -*- coding: utf-8 -*-
import json, base64, io, sys
from reportlab.lib.pagesizes import A4; from reportlab.lib import colors; from reportlab.lib.units import cm
from reportlab.platypus import *; from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT; from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.lib.utils import ImageReader
W,H=A4; MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C')
OR_PALE=colors.HexColor('#FBF7EC'); OR_FONCE=colors.HexColor('#A07830')
BLANC=colors.white; CREME=colors.HexColor('#FDFCF9'); GRIS_TEXTE=colors.HexColor('#3A3A3A')
GRIS_SOFT=colors.HexColor('#777777'); GRIS_LIGNE=colors.HexColor('#E0DDD6'); GRIS_BG=colors.HexColor('#F5F4F0')
VERT=colors.HexColor('#16a34a')
def p(txt,sz=9,font='Helvetica',color=GRIS_TEXTE,align=TA_LEFT,sb=0,sa=2,leading=None):
    if leading is None: leading=sz*1.35
    return Paragraph(str(txt),ParagraphStyle('s',fontName=font,fontSize=sz,textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa,leading=leading,wordWrap='CJK'))
raw=json.loads(open(sys.argv[1],encoding='utf-8').read())
meta=raw.get('_meta',{}) if isinstance(raw,dict) else {}
data=raw.get('_items',raw) if isinstance(raw,dict) and '_items' in raw else (raw if isinstance(raw,list) else [])
totalHT=sum(float(l.get('total',0)) for l in data if not l.get('_section'))
doc_type=meta.get('type','devis')
doc_num=meta.get('num','')
doc_label=meta.get('typeLabelUpper','DEVIS')
date_str=meta.get('dateStr','')
date_valide=meta.get('dateValide','')
client_nom=meta.get('clientNom','')
client_rue=meta.get('clientRue','')
client_ville=meta.get('clientVille','')
client_tel=meta.get('clientTel','')
desc_objet=meta.get('descObjet','Travaux electricite')
is_paye=meta.get('isPaye',False)
is_signe=meta.get('isSigne',False)
date_sig=str(meta.get('datePaiement','')) or str(meta.get('dateSignature',''))
nom_court=str(meta.get('nomCourt',''))
sig_data_b64=str(meta.get('signatureData',''))
try:
    logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())
except:
    logo_bytes=None
class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw): pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0; self.saveState(); self._draw_page()
    def showPage(self): self._draw_footer(); pdfcanvas.Canvas.showPage(self); self._pg+=1
    def save(self): self._draw_footer(); pdfcanvas.Canvas.save(self)
    def _draw_page(self):
        self.saveState(); self.setFillColor(CREME); self.rect(0,0,W,H,fill=1,stroke=0)
        self.setFillColor(MARINE); self.rect(0,0,0.7*cm,H,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.7*cm,0,0.08*cm,H,fill=1,stroke=0)
        # Filigrane SIGNÉ diagonal
        try:
            if IS_SIGNE:
                self.saveState()
                self.setFillColor(colors.HexColor('#16a34a'))
                self.setFillAlpha(0.055)
                self.setFont('Helvetica-Bold',88)
                self.translate(W/2,H/2)
                self.rotate(45)
                self.drawCentredString(0,0,'SIGN\u00c9')
                self.restoreState()
        except: pass
        if self._pg==0: self._draw_header()
        else: self._draw_header_small()
        self.restoreState()
    def _draw_header(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-5.4*cm,W-0.78*cm,5.4*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-5.4*cm,W-0.78*cm,0.12*cm,fill=1,stroke=0)
        if logo_bytes:
            self.drawImage(ImageReader(io.BytesIO(logo_bytes)),0.9*cm,H-5.05*cm,width=4.2*cm,height=4.2*cm,preserveAspectRatio=True,mask='auto')
        self.setFont('Helvetica-Bold',15); self.setFillColor(colors.white); self.drawString(5.9*cm,H-1.7*cm,'SINELEC PARIS')
        self.setFont('Helvetica-Bold',9); self.setFillColor(colors.white); self.drawString(5.9*cm,H-2.5*cm,'128 Rue La Boetie, 75008 Paris')
        self.setFont('Helvetica',8.5); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(5.9*cm,H-3.0*cm,'Tel : 07 87 38 86 22'); self.drawString(5.9*cm,H-3.4*cm,'sinelec.paris@gmail.com')
        self.setFillColor(colors.HexColor('#243660')); self.roundRect(5.9*cm,H-4.15*cm,5.5*cm,0.55*cm,0.1*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',8); self.setFillColor(OR); self.drawString(6.1*cm,H-3.88*cm,'SIRET : 91015824500019')
        _lbl='${typeLabelUpper}'
        _lbl_sz=40 if len(_lbl)<=7 else (28 if len(_lbl)<=14 else 20)
        self.setFont('Helvetica-Bold',_lbl_sz); self.setFillColor(BLANC); self.drawRightString(W-1.2*cm,H-2.2*cm,_lbl)
        self.setStrokeColor(OR); self.setLineWidth(1.5); self.line(13*cm,H-2.65*cm,W-1.2*cm,H-2.65*cm)
        self.setFillColor(OR); self.roundRect(W-6.5*cm,H-3.55*cm,5.3*cm,0.65*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(MARINE); self.drawCentredString(W-3.85*cm,H-3.22*cm,'N\\u00b0 ${num}')
        self.setFont('Helvetica',8); self.setFillColor(colors.HexColor('#BFC8D6')); self.drawRightString(W-1.2*cm,H-3.9*cm,'Date : ${dateStr}')
    def _draw_header_small(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,1.5*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',10); self.setFillColor(BLANC); self.drawString(1.4*cm,H-1.0*cm,'SINELEC')
        self.setFont('Helvetica',8); self.setFillColor(OR); self.drawRightString(W-1.2*cm,H-1.0*cm,'${typeLabelUpper} N\\u00b0 ${num}')
    def _draw_footer(self):
        self.saveState()
        self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI  \\u2022  128 Rue La Boetie, 75008 Paris  \\u2022  SIRET : 91015824500019  \\u2022  TVA non applicable art. 293B CGI')
        self.setFont('Helvetica-Bold',7); self.setFillColor(OR); self.drawRightString(W-1.2*cm,0.28*cm,'${num}')
        self.restoreState()
        self._draw_tampons()
    def _draw_tampons(self):
        IS_PAYE = ${isPaye ? 'True' : 'False'}
        IS_SIGNE = '${docType}'=='devis' and '${docStatut}' in ('signe','signé')
        rouge = colors.HexColor('#cc0000'); vert=colors.HexColor('#16a34a')
        couleur = rouge if IS_PAYE else (vert if IS_SIGNE else None)
        if not couleur: return
        cx=W-3.8*cm; cy=3.5*cm; r=1.7*cm
        self.saveState(); self.setStrokeColor(couleur); self.setFillColor(couleur)
        self.setFillAlpha(0.85); self.setLineWidth(3.5); self.circle(cx,cy,r,fill=0,stroke=1)
        self.setLineWidth(0.8); self.setFillAlpha(0.4); self.circle(cx,cy,r-0.22*cm,fill=0,stroke=1)
        self.translate(cx,cy); self.rotate(-15)
        self.setFillAlpha(0.92); self.setFillColor(couleur)
        self.setFont('Helvetica-Bold',7); self.drawCentredString(0,1.05*cm,'${nomCourt}')
        label='PAYE' if IS_PAYE else 'SIGNE'
        sz=22 if IS_PAYE else 20
        self.setFillAlpha(0.9); self.setFont('Helvetica-Bold',sz); self.drawCentredString(0,0.18*cm,label)
        self.setFont('Helvetica-Bold',7.5); self.setFillAlpha(0.75); self.drawCentredString(0,-0.52*cm,'${datePaiement}')
        self.setFont('Helvetica',6); self.setFillAlpha(0.45); self.drawCentredString(0,-1.02*cm,'PARIS')
        self.restoreState()
doc=SimpleDocTemplate(sys.argv[2],pagesize=A4,leftMargin=1.2*cm,rightMargin=1.0*cm,topMargin=5.6*cm,bottomMargin=1.6*cm)
story=[]
objet_b=Table([[p('OBJET DES TRAVAUX',7.5,'Helvetica-Bold',OR,sa=4)],[p('${descObjet}',10,'Helvetica-Bold',MARINE)],[p('Conformes NF C 15-100  \\u2022  Garantie decennale ORUS',7.5,color=GRIS_SOFT)]],colWidths=[8.2*cm])
objet_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),0),('LINEABOVE',(0,0),(0,0),2.5,MARINE),('TOPPADDING',(0,0),(0,0),10)]))
client_b=Table([[p('DESTINATAIRE',7,'Helvetica-Bold',OR,sa=3)],[p('${clientEsc}',11,'Helvetica-Bold',MARINE)],[p('${clientRue}',9,color=GRIS_TEXTE)],[p('${clientVille}',9,color=GRIS_TEXTE)]],colWidths=[8.2*cm])
client_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2),('LEFTPADDING',(0,0),(-1,-1),0)]))
hdr_row=Table([[objet_b,client_b]],colWidths=[9.5*cm,8.7*cm])
hdr_row.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
story.append(hdr_row); story.append(Spacer(1,0.5*cm))
th=[p('N\\u00b0',8,'Helvetica-Bold',BLANC,TA_CENTER),p('D\\u00e9signation',8,'Helvetica-Bold',BLANC),p('Qte',8,'Helvetica-Bold',BLANC,TA_CENTER),p('Prix HT',8,'Helvetica-Bold',BLANC,TA_RIGHT),p('Total HT',8,'Helvetica-Bold',BLANC,TA_RIGHT)]
rows=[th]; sect_num=0; item_num=0
for ligne in data:
    if ligne.get('_section'):
        sect_num+=1; item_num=0
        rows.append([p(str(ligne.get('titre',f'Section {sect_num}')),9,'Helvetica-Bold',BLANC,sa=4),'','','','']); continue
    item_num+=1
    sub_num=f'{sect_num}.{item_num}' if sect_num>0 else str(item_num)
    nom=str(ligne.get('designation',''))
    qte=int(ligne.get('qte',1) or 1); pu=float(ligne.get('prixUnit',0) or 0); tot=float(ligne.get('total',pu*qte) or 0)
    is_offert=(pu==0 or tot==0)
    desig_cell=[p(nom,9,'Helvetica-Bold',MARINE)]
    for d in (ligne.get('details') or []):
        if d: desig_cell.append(p(str(d),7.5,'Helvetica',GRIS_SOFT,sb=1,sa=0))
    rows.append([p(sub_num,8,color=GRIS_SOFT,align=TA_CENTER),desig_cell,p(str(qte),9,align=TA_CENTER),p(f'{pu:.0f} \\u20ac' if not is_offert else 'OFFERT',9,align=TA_RIGHT),p('OFFERT' if is_offert else f'{tot:.0f} \\u20ac',9,'Helvetica-Bold',align=TA_RIGHT,color=colors.HexColor('#16a34a') if is_offert else OR_FONCE)])
COL=[1.0*cm,10.8*cm,1.3*cm,2.2*cm,2.9*cm]
t=Table(rows,colWidths=COL,repeatRows=1)
ts=[('BACKGROUND',(0,0),(-1,0),MARINE),('ROWBACKGROUNDS',(0,1),(-1,-1),[CREME,OR_PALE]),('LINEBELOW',(0,0),(-1,0),1.5,OR),('LINEBELOW',(0,-1),(-1,-1),1.5,MARINE),('LEFTPADDING',(0,0),(-1,-1),4),('RIGHTPADDING',(0,0),(-1,-1),4),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('VALIGN',(0,0),(-1,-1),'TOP'),('ALIGN',(2,0),(4,-1),'RIGHT')]
for i,row in enumerate(rows):
    if i>0 and isinstance(row[1],str) and row[1]=='':
        ts+=[('BACKGROUND',(0,i),(-1,i),colors.HexColor('#243660')),('SPAN',(0,i),(-1,i)),('TEXTCOLOR',(0,i),(-1,i),BLANC)]
t.setStyle(TableStyle(ts))
story.append(t)
story.append(Spacer(1,0.4*cm))
net=Table([[p('NET \\u00c0 PAYER',13,'Helvetica-Bold',BLANC),p('%.2f \\u20ac'%totalHT,16,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,-1),2,OR)]))
story.append(net); story.append(Spacer(1,0.25*cm))
story.append(Table([[p('TVA non applicable, art. 293B du CGI',8,color=GRIS_SOFT),p('Paiement : Esp\\u00e8ces  \\u2022  Virement  \\u2022  CB (SumUp)',8,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[9.5*cm,8.7*cm]))
if is_signe:
    story.append(PageBreak())
    hdr_cgv=Table([[p('\u26a1  SINELEC PARIS',11,'Helvetica-Bold',BLANC),p('CONDITIONS G\u00c9N\u00c9RALES DE VENTE',11,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[8.5*cm,9*cm])
    hdr_cgv.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
    story.append(hdr_cgv); story.append(Spacer(1,0.2*cm))
    date_sig=str(meta.get('dateSignature','')) or str(meta.get('datePaiement','')) or dateStr
    story.append(Table([[p('Applicables au devis n\u00b0 '+doc_num+' \u2014 Accept\u00e9es par '+client_nom+' le '+date_sig,7.5,'Helvetica',GRIS_SOFT),p('SIRET 91015824500019 \u2022 TVA non applicable art. 293B CGI',7.5,'Helvetica',GRIS_SOFT,TA_RIGHT)]],colWidths=[9.5*cm,8*cm]))
    story.append(Table([[p('',1)]],colWidths=[18.2*cm],style=[('LINEBELOW',(0,0),(-1,-1),1,OR)]))
    story.append(Spacer(1,0.15*cm))
    GRIS_L=colors.HexColor('#f8fafc')
    cgv_arts=[('Art. 1 \u2014 Devis et acceptation','Le devis est valable 30 jours. Toute commande implique l\u2019acceptation sans r\u00e9serve des pr\u00e9sentes CGV. La signature \u00e9lectronique vaut bon de commande ferme.'),('Art. 2 \u2014 Prix et paiement','TVA non applicable art. 293B CGI. Acompte 40% \u00e0 la signature si devis > 400\u20ac. Solde \u00e0 la fin des travaux. Paiement : esp\u00e8ces, virement, CB SumUp, PayPal.'),('Art. 3 \u2014 R\u00e9alisation des travaux','Travaux conform\u00e9ment \u00e0 la norme NF C 15-100. Le client s\u2019engage \u00e0 fournir un acc\u00e8s s\u00e9curis\u00e9 et informer SINELEC de toute contrainte avant intervention.'),('Art. 4 \u2014 Garanties','Garantie d\u00e9cennale ORUS Assurances (Lyon). Garantie parfait ach\u00e8vement 1 an. Ne couvre pas les d\u00e9gradations dues \u00e0 mauvaise utilisation ou intervention tierce.'),('Art. 5 \u2014 Droit de r\u00e9tractation','Droit de r\u00e9tractation 14 jours (art. L221-18 Code Conso). Ne s\u2019applique pas aux interventions d\u2019urgence expressément sollicit\u00e9es par le client.'),('Art. 6 \u2014 Responsabilit\u00e9','SINELEC ne saurait \u00eatre tenu responsable des dommages indirects. Force majeure : ex\u00e9cution suspendue sans indemnit\u00e9.'),('Art. 7 \u2014 Litiges','Solution amiable privil\u00e9gi\u00e9e. \u00c0 d\u00e9faut, comp\u00e9tence exclusive des tribunaux de Paris.')]
    for titre,texte in cgv_arts:
        r=Table([[p(titre,8,'Helvetica-Bold',MARINE),p(texte,7.5,'Helvetica',GRIS_SOFT)]],colWidths=[4.8*cm,13.4*cm])
        r.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),GRIS_L),('LINEBELOW',(0,0),(-1,-1),0.5,colors.HexColor('#e2e8f0')),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('VALIGN',(0,0),(-1,-1),'TOP')]))
        story.append(r)
    story.append(Spacer(1,0.4*cm))
    VERT_G=colors.HexColor('#16a34a')
    accept=Table([[p('\u2705  CGV lues et accept\u00e9es \u00e9lectroniquement',8,'Helvetica-Bold',VERT_G),p(client_nom+' \u2022 '+date_sig+' \u2022 Paris',8,'Helvetica-Bold',MARINE,TA_RIGHT)]],colWidths=[9*cm,8.5*cm])
    accept.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#f0fdf4')),('BOX',(0,0),(-1,-1),1.5,VERT_G),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
    story.append(accept)
    story.append(Spacer(1,0.3*cm))
    # Signature client
    sig_left_items=[p('Signature du client',8,'Helvetica-Bold',MARINE),p(client_nom,8,color=GRIS_SOFT),p(date_sig+' \u2022 Paris, France',7,color=GRIS_SOFT)]
    sig_img_ok=False
    if sig_data_b64 and len(sig_data_b64)>100:
        try:
            raw_b64=sig_data_b64.split(',',1)[-1] if ',' in sig_data_b64 else sig_data_b64
            img_bytes=base64.b64decode(raw_b64)
            sig_img=Image(io.BytesIO(img_bytes),width=5.5*cm,height=2.2*cm)
            sig_left_items.append(sig_img)
            sig_img_ok=True
        except Exception as e:
            import sys; print('SIG_ERR:'+str(e),file=sys.stderr)
    if not sig_img_ok:
        sig_left_items.append(Table([[p('[ Signature non disponible ]',8,color=GRIS_SOFT)]],colWidths=[8*cm]))
    sig_right_items=[p('Signature SINELEC',8,'Helvetica-Bold',MARINE),p('Diahe',8,color=GRIS_SOFT),p('SINELEC Paris \u26a1',7,color=OR)]
    sig_tbl=Table([[sig_left_items,sig_right_items]],colWidths=[9.2*cm,9*cm])
    sig_tbl.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#f8fafc')),('BOX',(0,0),(-1,-1),1,colors.HexColor('#e2e8f0')),('LINEAFTER',(0,0),(0,-1),1,colors.HexColor('#e2e8f0')),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
    story.append(sig_tbl)
doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw)); print('PDF_OK')
`;
    fs.writeFileSync(pyPath, py, 'utf8');
    try {
      execSync(`python3 "${pyPath}" "${detailsPath}" "${pdfPath}"`, {
        timeout: 40000, stdio: ['pipe','pipe','pipe']
      });
    } catch(pyErr) {
      const pyMsg = pyErr.stderr?.toString() || pyErr.stdout?.toString() || pyErr.message;
      throw new Error('PDF generation failed: ' + pyMsg.substring(0,200));
    }
    if (!fs.existsSync(pdfPath)) throw new Error('PDF non généré');
    const pdfBuffer = fs.readFileSync(pdfPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${num}.pdf"`);
    res.send(pdfBuffer);
    try { fs.unlinkSync(pyPath); } catch(e) {}
    try { fs.unlinkSync(detailsPath); } catch(e) {}
    try { fs.unlinkSync(pdfPath); } catch(e) {}
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════
// API: PDF OBAT
// ═══════════════════════════════════════════════════
app.get('/api/pdf-obat/:reference', async (req, res) => {
  const { reference } = req.params;
  try {
    const { data: f, error } = await supabase.from('factures_obat').select('*').eq('reference', reference).single();
    if (error || !f) return res.status(404).json({ error: 'Document OBAT non trouvé' });
    // Générer un PDF simple pour les factures OBAT
    const detailsPath = path.join('/tmp', `_obat_${reference}.json`);
    const pyPath = path.join('/tmp', `_obat_${reference}.py`);
    const pdfPath = path.join('/tmp', `_obat_${reference}.pdf`);
    const prestations = (f.prestations || []).map(p => ({ designation: p.nom||p.designation||'Prestation', qte: p.quantite||1, prixUnit: p.montant||p.prix||0, total: (p.montant||p.prix||0)*(p.quantite||1), details: [] }));
    fs.writeFileSync(detailsPath, JSON.stringify(prestations));
    const clientEsc = String(f.client||f.client_nom||'').replace(/'/g,' ');
    const dateStr = f.date_facture ? new Date(f.date_facture).toLocaleDateString('fr-FR') : new Date().toLocaleDateString('fr-FR');
    const totalHT = prestations.reduce((s,p)=>s+p.total,0);
    const py = `# -*- coding: utf-8 -*-
import json,sys
from reportlab.lib.pagesizes import A4; from reportlab.lib import colors; from reportlab.lib.units import cm
from reportlab.platypus import *; from reportlab.lib.styles import ParagraphStyle; from reportlab.lib.enums import TA_LEFT,TA_RIGHT
MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C'); BLANC=colors.white
def p(t,sz=9,font='Helvetica',color=MARINE,align=TA_LEFT): return Paragraph(str(t),ParagraphStyle('s',fontName=font,fontSize=sz,textColor=color,alignment=align,spaceAfter=3))
data=json.loads(open(sys.argv[1],encoding='utf-8').read())
doc=SimpleDocTemplate(sys.argv[2],pagesize=A4,leftMargin=2*cm,rightMargin=2*cm,topMargin=2*cm,bottomMargin=2*cm)
story=[p('SINELEC PARIS',14,'Helvetica-Bold',MARINE),p('128 Rue La Boetie, 75008 Paris | SIRET : 91015824500019',9,color=colors.gray),Spacer(1,0.5*cm),p(f'FACTURE N\u00b0 {reference}',14,'Helvetica-Bold',MARINE),p('Date : ${dateStr}',9,color=colors.gray),Spacer(1,0.3*cm),p('Client : ${clientEsc}',11,'Helvetica-Bold',MARINE),Spacer(1,0.5*cm)]
rows=[[ p('Désignation',9,'Helvetica-Bold',BLANC),p('Total HT',9,'Helvetica-Bold',BLANC,TA_RIGHT)]]
for l in data: rows.append([p(str(l.get('designation','')),9),p(f'{l.get("total",0):.0f} \u20ac',9,align=TA_RIGHT)])
t=Table(rows,colWidths=[13*cm,4*cm]); t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),MARINE),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#FBF7EC')]),('LINEBELOW',(0,-1),(-1,-1),1.5,MARINE),('ALIGN',(1,0),(1,-1),'RIGHT'),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
story.append(t); story.append(Spacer(1,0.3*cm))
story.append(Table([[p('NET À PAYER',12,'Helvetica-Bold',BLANC),p(f'{totalHT:.2f} \u20ac',14,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[11*cm,6*cm]))
story[-1].setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8)]))
doc.build(story); print('PDF_OK')
`;
    fs.writeFileSync(pyPath, py, 'utf8');
    execSync(`python3 "${pyPath}" "${detailsPath}" "${pdfPath}"`, { cwd: __dirname, timeout: 30000 });
    if (!fs.existsSync(pdfPath)) throw new Error('PDF non généré');
    const buf = fs.readFileSync(pdfPath);
    const b64 = buf.toString('base64');
    res.json({ success: true, pdf_b64: b64, filename: `Facture_OBAT_${reference}.pdf` });
    try { fs.unlinkSync(pyPath); fs.unlinkSync(detailsPath); fs.unlinkSync(pdfPath); } catch(e) {}
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: PAIEMENT CONFIRMÉ (page web)
// ═══════════════════════════════════════════════════
app.get('/paiement-confirme/:num', async (req, res) => {
  const { num } = req.params;
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Paiement confirmé</title></head><body style="font-family:Arial;text-align:center;padding:60px;background:#f5f5f5;"><div style="background:#fff;border-radius:16px;padding:40px;max-width:400px;margin:0 auto;box-shadow:0 4px 20px rgba(0,0,0,0.1);"><div style="font-size:60px;">✅</div><h2 style="color:#16a34a;">Paiement confirmé !</h2><p style="color:#555;">Merci pour votre règlement.<br>Facture n° <strong>${num}</strong></p><p style="color:#888;font-size:14px;">📞 07 87 38 86 22<br>sinelec.paris@gmail.com</p></div></body></html>`);
});

// ═══════════════════════════════════════════════════
// API: FACTURE ACOMPTE 40%
// ═══════════════════════════════════════════════════
app.post('/api/acompte/:num', async (req, res) => {
  try {
    const { num } = req.params;
    const { data: devis, error } = await supabase.from('historique').select('*').eq('num', num).single();
    if (error || !devis) return res.status(404).json({ error: 'Devis non trouvé' });

    const totalDevis = parseFloat(devis.total_ht || 0);
    const montantAcompte = totalDevis * 0.4;
    const montantSolde = totalDevis * 0.6;

    const compteur = await incrementerCompteur('acompte');
    const annee = new Date().getFullYear();
    const mois = String(new Date().getMonth() + 1).padStart(2, '0');
    const numAcompte = `FA-${annee}${mois}-${String(compteur).padStart(3, '0')}`;

    const prestationsAcompte = (devis.prestations || []).map(p => ({
      nom: p.nom || p.designation,
      prix: (p.prix || 0) * 0.4,
      quantite: p.quantite || 1,
      desc: p.desc || ''
    }));

    // Insérer la facture d'acompte
    await supabase.from('historique').insert({
      num: numAcompte, type: 'facture', client: devis.client,
      email: devis.email, telephone: devis.telephone, adresse: devis.adresse,
      prestations: prestationsAcompte, total_ht: montantAcompte,
      statut: 'envoye', source: 'app', description: `Facture d'acompte 40% — devis ${num}`,
      date_envoi: new Date().toISOString()
    });

    // Générer PDF
    const detailsPath = path.join('/tmp', `_acompte_${numAcompte}.json`);
    const pyPath = path.join('/tmp', `_acompte_${numAcompte}.py`);
    const pdfPath = path.join('/tmp', `_acompte_${numAcompte}.pdf`);
    fs.writeFileSync(detailsPath, JSON.stringify(prestationsAcompte.map(p => ({ designation: p.nom, qte: p.quantite, prixUnit: p.prix, total: p.prix * p.quantite, details: p.desc ? [p.desc] : [] }))));

    const clientEsc = String(devis.client || '').replace(/'/g, ' ');
    const addrParts = (devis.adresse || '').split(',');
    const clientRue = String(addrParts[0] || '').trim().replace(/'/g, ' ');
    const clientVille = addrParts.slice(1).join(',').trim().replace(/'/g, ' ');
    const dateStr = new Date().toLocaleDateString('fr-FR');

    const py = `# -*- coding: utf-8 -*-
import json, base64, io, sys
from reportlab.lib.pagesizes import A4; from reportlab.lib import colors; from reportlab.lib.units import cm
from reportlab.platypus import *; from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT; from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.lib.utils import ImageReader
W,H=A4; MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C')
OR_PALE=colors.HexColor('#FBF7EC'); OR_FONCE=colors.HexColor('#A07830')
BLANC=colors.white; CREME=colors.HexColor('#FDFCF9'); GRIS_TEXTE=colors.HexColor('#3A3A3A'); GRIS_SOFT=colors.HexColor('#777777'); GRIS_LIGNE=colors.HexColor('#E0DDD6'); BLEU=colors.HexColor('#3b82f6')
def p(txt,sz=9,font='Helvetica',color=GRIS_TEXTE,align=TA_LEFT,sb=0,sa=2,leading=None):
    if leading is None: leading=sz*1.35
    return Paragraph(str(txt),ParagraphStyle('s',fontName=font,fontSize=sz,textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa,leading=leading,wordWrap='CJK'))
data=json.loads(open(sys.argv[1],encoding='utf-8').read())
totalHT=sum(l.get('total',0) for l in data)
try:
    logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())
except:
    logo_bytes=None
class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw): pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0; self.saveState(); self._draw_page()
    def showPage(self): self._draw_footer(); pdfcanvas.Canvas.showPage(self); self._pg+=1
    def save(self): self._draw_footer(); pdfcanvas.Canvas.save(self)
    def _draw_page(self):
        self.saveState(); self.setFillColor(CREME); self.rect(0,0,W,H,fill=1,stroke=0)
        self.setFillColor(MARINE); self.rect(0,0,0.7*cm,H,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.7*cm,0,0.08*cm,H,fill=1,stroke=0)
        self._draw_header(); self.restoreState()
    def _draw_header(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-5.4*cm,W-0.78*cm,5.4*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-5.4*cm,W-0.78*cm,0.12*cm,fill=1,stroke=0)
        if logo_bytes:
            self.drawImage(ImageReader(io.BytesIO(logo_bytes)),0.9*cm,H-5.05*cm,width=4.2*cm,height=4.2*cm,preserveAspectRatio=True,mask='auto')
        self.setFont('Helvetica-Bold',15); self.setFillColor(colors.white); self.drawString(5.9*cm,H-1.7*cm,'SINELEC PARIS')
        self.setFont('Helvetica-Bold',9); self.setFillColor(colors.white); self.drawString(5.9*cm,H-2.5*cm,'128 Rue La Boetie, 75008 Paris')
        self.setFont('Helvetica',8.5); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(5.9*cm,H-3.0*cm,'Tel : 07 87 38 86 22'); self.drawString(5.9*cm,H-3.4*cm,'sinelec.paris@gmail.com')
        self.setFont('Helvetica-Bold',30); self.setFillColor(BLANC); self.drawRightString(W-1.2*cm,H-2.2*cm,'FACTURE D\\u2019ACOMPTE')
        self.setFillColor(BLEU); self.roundRect(W-6.5*cm,H-3.55*cm,5.3*cm,0.65*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(BLANC); self.drawCentredString(W-3.85*cm,H-3.22*cm,'N\\u00b0 ${numAcompte}')
        self.setFont('Helvetica',8); self.setFillColor(colors.HexColor('#BFC8D6')); self.drawRightString(W-1.2*cm,H-3.9*cm,'Date : ${dateStr}   |   Acompte 40% du devis ${num}')
    def _draw_footer(self):
        self.saveState(); self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI  \\u2022  128 Rue La Boetie, 75008 Paris  \\u2022  SIRET : 91015824500019  \\u2022  TVA non applicable art. 293B CGI')
        self.restoreState()
doc=SimpleDocTemplate(sys.argv[2],pagesize=A4,leftMargin=1.2*cm,rightMargin=1.0*cm,topMargin=5.6*cm,bottomMargin=1.6*cm)
story=[]
client_b=Table([[p('DESTINATAIRE',7,'Helvetica-Bold',OR,sa=3)],[p('${clientEsc}',11,'Helvetica-Bold',MARINE)],[p('${clientRue}',9)],[p('${clientVille}',9)]],colWidths=[8.2*cm])
client_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2),('LEFTPADDING',(0,0),(-1,-1),0)]))
acompte_info=Table([[p('Facture d\\u2019acompte 40%',9,'Helvetica-Bold',BLEU)],[p('Devis ${num} — Solde : ' + '${montantSolde.toFixed(2)}' + ' \\u20ac (60%) exigible \\u00e0 la fin des travaux',8,color=GRIS_SOFT)]],colWidths=[9.0*cm])
hdr_row=Table([[client_b,acompte_info]],colWidths=[9.5*cm,8.7*cm])
hdr_row.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
story.append(hdr_row); story.append(Spacer(1,0.5*cm))
rows=[[p('N\\u00b0',8,'Helvetica-Bold',BLANC,TA_CENTER),p('D\\u00e9signation',8,'Helvetica-Bold',BLANC),p('Total (40%)',8,'Helvetica-Bold',BLANC,TA_RIGHT)]]
for i,l in enumerate(data): rows.append([p(str(i+1),8,align=TA_CENTER),[p(str(l.get('designation','')),9,'Helvetica-Bold',MARINE)],p(f'{l.get("total",0):.0f} \\u20ac',9,'Helvetica-Bold',align=TA_RIGHT,color=OR_FONCE)])
t=Table(rows,colWidths=[1.0*cm,13.0*cm,4.2*cm],repeatRows=1)
t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),MARINE),('ROWBACKGROUNDS',(0,1),(-1,-1),[CREME,OR_PALE]),('LINEBELOW',(0,0),(-1,0),1.5,OR),('LINEBELOW',(0,-1),(-1,-1),1.5,MARINE),('LEFTPADDING',(0,0),(-1,-1),4),('RIGHTPADDING',(0,0),(-1,-1),4),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('VALIGN',(0,0),(-1,-1),'TOP'),('ALIGN',(2,0),(2,-1),'RIGHT')]))
story.append(t); story.append(Spacer(1,0.4*cm))
net=Table([[p('ACOMPTE \\u00c0 R\\u00c9GLER',13,'Helvetica-Bold',BLANC),p('%.2f \\u20ac'%totalHT,16,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),BLEU),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,-1),2,OR)]))
story.append(net); story.append(Spacer(1,0.25*cm))
story.append(Table([[p('TVA non applicable, art. 293B du CGI',8,color=GRIS_SOFT),p('Paiement : Esp\\u00e8ces  \\u2022  Virement  \\u2022  CB (SumUp)',8,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[9.5*cm,8.7*cm]))
doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw)); print('PDF_OK')doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw)); print('PDF_OK')
`;
    fs.writeFileSync(pyPath, py, 'utf8');
    execSync(`python3 "${pyPath}" "${detailsPath}" "${pdfPath}"`, { cwd: __dirname, timeout: 40000 });
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdf_b64 = pdfBuffer.toString('base64');
    try { fs.unlinkSync(pyPath); fs.unlinkSync(detailsPath); fs.unlinkSync(pdfPath); } catch(e) {}
    res.json({ success: true, num: numAcompte, pdf_b64, montant_acompte: montantAcompte, montant_solde: montantSolde });
  } catch(error) {
    console.error('❌ /api/acompte error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════
// API: AGENDA
// ═══════════════════════════════════════════════════
app.get('/api/agenda', async (req, res) => {
  try {
    const { data, error } = await supabase.from('agenda').select('*').order('date_intervention', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/agenda', async (req, res) => {
  try {
    const body = req.body;
    const { data, error } = await supabase.from('agenda').insert(body).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/agenda/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('agenda').update(req.body).eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/agenda/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('agenda').update(req.body).eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/agenda/:id/statut', async (req, res) => {
  try {
    const { id } = req.params;
    const { statut } = req.body;
    const { error } = await supabase.from('agenda').update({ statut }).eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/agenda/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('agenda').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: CLIENTS
// ═══════════════════════════════════════════════════
app.get('/api/clients', async (req, res) => {
  try {
    const { data, error } = await supabase.from('clients').select('*').order('nom', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clients/creer', async (req, res) => {
  try {
    const { nom, email, telephone, adresse } = req.body;
    // Check if exists
    let existing = null;
    if (email) {
      const { data } = await supabase.from('clients').select('*').eq('email', email).single();
      existing = data;
    }
    if (!existing && telephone) {
      const { data } = await supabase.from('clients').select('*').eq('telephone', telephone).single();
      existing = data;
    }
    if (existing) {
      await supabase.from('clients').update({ nom, email: email||existing.email, telephone: telephone||existing.telephone, adresse: adresse||existing.adresse }).eq('id', existing.id);
      return res.json({ success: true, created: false });
    }
    const { error } = await supabase.from('clients').insert({ nom, email, telephone, adresse, source: 'app', created_at: new Date().toISOString() });
    if (error) throw error;
    res.json({ success: true, created: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: RENTABILITÉ / CHARGES
// ═══════════════════════════════════════════════════
app.get('/api/rentabilite/:mois', authMiddleware, async (req, res) => {
  try {
    const { mois } = req.params; // format: 2026-05
    const [annee, moisNum] = mois.split('-');
    const debut = `${mois}-01`;
    const fin = `${mois}-31`;

    // CA du mois (factures payées)
    const { data: factures } = await supabase.from('historique')
      .select('total_ht, statut')
      .gte('created_at', debut)
      .lte('created_at', fin + 'T23:59:59')
      .eq('type', 'facture');

    const ca_total = (factures || [])
      .filter(f => ['paye','payé','payee','acquitte'].includes((f.statut||'').toLowerCase()))
      .reduce((s, f) => s + parseFloat(f.total_ht || 0), 0);

    // Charges du mois
    const { data: charges } = await supabase.from('charges')
      .select('*')
      .gte('date', debut)
      .lte('date', fin)
      .order('date', { ascending: false });

    const charges_total = (charges || []).reduce((s, c) => s + parseFloat(c.montant || 0), 0);

    // Catégories
    const par_categorie = {};
    (charges || []).forEach(c => {
      const cat = c.categorie || 'autre';
      par_categorie[cat] = (par_categorie[cat] || 0) + parseFloat(c.montant || 0);
    });

    // URSSAF auto (22% CA si non saisie manuellement)
    const urssaf_saisie = par_categorie.urssaf || 0;
    const urssaf_auto = urssaf_saisie > 0 ? 0 : Math.round(ca_total * 0.22);
    const total_charges_avec_urssaf = charges_total + urssaf_auto;

    const benefice_net = ca_total - total_charges_avec_urssaf;
    const taux_marge = ca_total > 0 ? Math.round((benefice_net / ca_total) * 100) : 0;

    res.json({
      mois, ca_total: Math.round(ca_total * 100) / 100,
      charges_total: Math.round(total_charges_avec_urssaf * 100) / 100,
      benefice_net: Math.round(benefice_net * 100) / 100,
      taux_marge, par_categorie, charges: charges || [],
      urssaf_auto, urssaf_saisie
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/charges', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase.from('charges').select('*').order('date', { ascending: false });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/charges', authMiddleware, async (req, res) => {
  try {
    const { categorie, montant, date, note } = req.body;
    const { error } = await supabase.from('charges').insert({
      categorie, montant: parseFloat(montant),
      date: date || new Date().toISOString().split('T')[0], note
    });
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/charges/:id', authMiddleware, async (req, res) => {
  try {
    const { error } = await supabase.from('charges').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: CHAT AI
// ═══════════════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1500,
      system: `Tu es l'assistant SINELEC, expert électricien Paris. Aide à préparer des devis détaillés.`,
      messages: [{ role: 'user', content: message }]
    });
    res.json({ success: true, explication: response.content[0].text });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: IA DESCRIPTION LIBRE
// ═══════════════════════════════════════════════════
app.post('/api/ia/description-libre', authMiddleware, async (req, res) => {
  try {
    const { nom, mots, prix, longueur } = req.body;
    const courte = longueur !== 'long';
    const prompt = `Tu es un expert électricien SINELEC Paris. Rédige une description professionnelle pour cette prestation dans un devis.
Prestation : "${nom || ''}"${mots ? `\nMots-clés : ${mots}` : ''}${prix ? `\nPrix : ${prix}€` : ''}
Format : ${courte ? '2-3 phrases max, ~50-70 mots' : '4-6 phrases, ~120-150 mots'}
Style : Professionnel, technique, détaillé. Mentionne MO + fournitures + raccordement. Conforme NF C 15-100.
IMPORTANT : Réponds UNIQUEMENT avec la description, sans introduction ni guillemets.`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    });
    res.json({ success: true, description: response.content[0].text.trim() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: IA STATUT + CORRECTION
// ═══════════════════════════════════════════════════
app.get('/api/ia/statut', authMiddleware, async (req, res) => {
  try {
    const { data: corrections } = await supabase.from('logs_system')
      .select('*')
      .in('type', ['erreur', 'correction', 'ia_correction'])
      .order('created_at', { ascending: false })
      .limit(10);

    const erreurs = (corrections || []).filter(c => c.type === 'erreur' && !c.corrige);
    const correctionsDisponibles = erreurs.filter(c => c.peut_corriger).map(c => ({
      id: c.id, message: c.message, diagnostic: c.data?.diagnostic,
      peut_corriger: c.peut_corriger, statut: c.corrige ? 'appliqué' : 'en_attente',
      date: c.created_at, severite: c.data?.severite || 'mineur'
    }));

    res.json({
      erreurs_en_cours: erreurs.length,
      corrections: correctionsDisponibles,
      statut: erreurs.length === 0 ? 'ok' : 'erreurs'
    });
  } catch(e) { res.json({ erreurs_en_cours: 0, corrections: [] }); }
});

app.post('/api/ia/appliquer', authMiddleware, async (req, res) => {
  try {
    // Marquer les corrections comme appliquées
    await supabase.from('logs_system').update({ corrige: true }).eq('type', 'erreur').eq('peut_corriger', true);
    await logSystem('ia_correction', 'Corrections appliquées manuellement');
    res.json({ success: true, message: '✅ Corrections appliquées !' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: SCAN TICKET (Claude Vision)
// ═══════════════════════════════════════════════════
app.post('/api/scan-ticket', authMiddleware, async (req, res) => {
  try {
    const { image_b64, media_type } = req.body;
    if (!image_b64) return res.status(400).json({ error: 'Image requise' });

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image_b64 } },
          { type: 'text', text: `Analyse ce ticket de caisse. Réponds UNIQUEMENT en JSON valide:
{"montant": 45.50, "categorie": "carburant", "date": "2026-05-22", "note": "Total TTC"}
Catégories possibles: carburant, materiel, outillage, stationnement, telephone, lsa, urssaf, autre.
Date format: YYYY-MM-DD. Montant: nombre décimal. Note: description courte (15 mots max).` }
        ]
      }]
    });

    const text = response.content[0].text.trim().replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(text);
    res.json({ success: true, ...parsed });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: RAPPORT INTERVENTION
// ═══════════════════════════════════════════════════
app.post('/api/rapport/description', authMiddleware, async (req, res) => {
  try {
    const { chantier, client, adresse } = req.body;
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: `Tu es un électricien expert SINELEC Paris. Rédige une description professionnelle détaillée pour un rapport d'intervention.
Travaux réalisés (résumé court) : "${chantier}"${client ? `\nClient : ${client}` : ''}${adresse ? `\nAdresse : ${adresse}` : ''}
Écris un texte professionnel de 150-200 mots décrivant précisément les travaux, les matériaux utilisés, les normes respectées (NF C 15-100), et les tests effectués. Commence directement par la description.` }]
    });
    res.json({ success: true, description: response.content[0].text.trim() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/rapport', authMiddleware, async (req, res) => {
  try {
    const { client, adresse, chantier, description, email, telephone, photo_avant, photo_apres } = req.body;
    const compteur = await incrementerCompteur('rapport');
    const annee = new Date().getFullYear();
    const mois = String(new Date().getMonth() + 1).padStart(2, '0');
    const num = `RAP-${annee}${mois}-${String(compteur).padStart(3, '0')}`;
    const dateStr = new Date().toLocaleDateString('fr-FR');

    // Enregistrer en BDD
    await supabase.from('rapports').insert({
      num, client, adresse, description: description || chantier,
      email, telephone, date_intervention: new Date().toISOString()
    }).catch(e => console.log('Rapport insert (non bloquant):', e.message));

    // Envoyer email si fourni
    if (email) {
      const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#1B2A4A,#243660);padding:24px;text-align:center;border-radius:12px 12px 0 0;">
          <h2 style="color:#E8B84B;">Rapport d'intervention SINELEC</h2>
        </div>
        <div style="padding:24px;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 12px 12px;">
          <p>Bonjour,</p>
          <p>Veuillez trouver ci-joint le rapport d'intervention n° <strong>${num}</strong> du ${dateStr}.</p>
          <p><strong>Travaux réalisés :</strong></p>
          <p style="white-space:pre-wrap;color:#555;">${description || chantier}</p>
          <p style="font-size:12px;color:#888;margin-top:16px;">📞 07 87 38 86 22 | sinelec.paris@gmail.com</p>
        </div>
      </div>`;
      await envoyerEmail(email, `Rapport d'intervention ${num} - SINELEC Paris`, html);
    }

    res.json({ success: true, num });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: AVIS GOOGLE
// ═══════════════════════════════════════════════════
app.get('/api/avis/compteur', async (req, res) => {
  try {
    const { data } = await supabase.from('compteurs').select('valeur').eq('type', 'avis_google').single();
    res.json({ success: true, nb: data?.valeur || 96 });
  } catch(e) { res.json({ success: true, nb: 96 }); }
});

app.post('/api/avis/compteur', authMiddleware, async (req, res) => {
  try {
    const { nb } = req.body;
    const { data: existing } = await supabase.from('compteurs').select('*').eq('type', 'avis_google').single();
    if (existing) {
      await supabase.from('compteurs').update({ valeur: nb }).eq('type', 'avis_google');
    } else {
      await supabase.from('compteurs').insert({ type: 'avis_google', valeur: nb });
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/avis/generer', authMiddleware, async (req, res) => {
  try {
    const { texte, etoiles, intervention } = req.body;
    const prompt = `Tu es l'assistant de SINELEC, électricien Paris (Diahe).
Génère une réponse professionnelle et chaleureuse à cet avis Google ${etoiles} étoile(s).
AVIS : "${texte}"${intervention ? `\nINTERVENTION : ${intervention}` : ''}
RÈGLES :
- 40 à 70 mots maximum
- Intègre 2-3 mots-clés SEO : électricien Paris, dépannage électrique Paris, NF C 15-100
- ${etoiles >= 4 ? 'Remercie sincèrement, valorise le point positif' : 'Réponds calmement, propose de résoudre'}
- Termine par : Diahe — SINELEC ⚡
- Donne UNIQUEMENT la réponse, sans introduction ni guillemets`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    });
    res.json({ success: true, reponse: response.content[0].text.trim() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: ANALYSE DPE
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
// API: ANALYSE PHOTO → DEVIS AUTO
// ═══════════════════════════════════════════════════
app.post('/api/analyser-photo', authMiddleware, async (req, res) => {
  try {
    const { image_b64, media_type, contexte } = req.body;
    if (!image_b64) return res.status(400).json({ error: 'Image requise' });

    const prompt = `Tu es un expert électricien parisien. Analyse cette photo d'installation électrique et génère une liste de prestations à réaliser.

CONTEXTE : ${contexte || 'Installation électrique résidentielle Paris'}

GRILLE TARIFAIRE SINELEC (prix TTC, TVA non applicable) :
- Disjoncteur standard : 150€ | Différentiel 63A type A : 250€ | Parafoudre : 160€
- Tableau 1 rangée : 1200€ | Tableau 2 rangées : 1700€ | Tableau 3 rangées : 2200€
- Prise standard : 90€ | Prise déplacement : 130€ | Interrupteur : 90€
- Luminaire simple : 115€ | Spot encastré : 75€/u | Point DCL : 100€
- Mise à la terre : 650€ | Liaison équipo SdB : 140€ | DAAF : 85€
- Recherche panne : 120€ | Court-circuit : 125€ | Remise en service : 90€
- Circuit encastré 5m : 300€ | Circuit apparent 5m : 200€
- Déplacement Paris : 50€ (offert si intervention > 200€)
- Mise en conformité NF C 15-100 : 65€/m²

CONSIGNES :
1. Identifie les travaux nécessaires en regardant l'image
2. Pour chaque problème visible, propose la prestation correspondante
3. Sois précis mais ne sur-vends pas
4. Si l'image est floue ou insuffisante, dis-le

Réponds UNIQUEMENT en JSON valide, sans markdown :
{
  "analyse": "Description courte de ce que tu vois (2-3 phrases)",
  "urgence": "haute|normale|faible",
  "prestations": [
    {
      "designation": "Nom de la prestation",
      "detail": "Pourquoi c'est nécessaire (1 phrase)",
      "prix": 150,
      "qte": 1
    }
  ],
  "notes": "Observations importantes ou limites de l'analyse"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: media_type || 'image/jpeg',
              data: image_b64
            }
          },
          { type: 'text', text: prompt }
        ]
      }]
    });

    const raw = response.content[0].text.trim();
    let result;
    try {
      const clean = raw.replace(/^```json?\s*/,'').replace(/\s*```$/,'');
      result = JSON.parse(clean);
    } catch(e) {
      return res.status(500).json({ error: 'Réponse IA invalide', raw: raw.substring(0,200) });
    }

    // Calculer le total
    const total = (result.prestations || []).reduce((s, p) => s + (p.prix * p.qte), 0);
    result.total = total;

    console.log(`📷 Analyse photo: ${(result.prestations||[]).length} prestations, ${total}€`);
    res.json({ success: true, ...result });

  } catch(e) {
    console.error('❌ analyser-photo:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/dpe', async (req, res) => {
  try {
    const { pdf_base64, pdf_type, pdf_text, nom_client, adresse_client } = req.body;
    if (!pdf_base64 && !pdf_text) return res.status(400).json({ error: 'PDF ou texte DPE manquant' });

    const promptBase = `Tu es un expert électricien parisien (SINELEC) qui analyse les DPE (Diagnostics de Performance Énergétique).
Tu te concentres EXCLUSIVEMENT sur les travaux électriques. Ignore : isolation, fenêtres, toiture, chaudière gaz, etc.

Analyse ce DPE et réponds UNIQUEMENT en JSON valide (sans backticks, sans markdown) :
{
  "logement": {
    "surface": 65,
    "classe_dpe": "E",
    "annee_construction": "1975",
    "chauffage": "Convecteurs électriques",
    "eau_chaude": "Chauffe-eau électrique",
    "vmc": "Absente",
    "tableau": "Non conforme"
  },
  "recommandations": [
    {
      "id": "tableau",
      "titre": "Remplacement tableau électrique",
      "description": "Tableau vétuste non conforme NF C 15-100, protections insuffisantes.",
      "priorite": "haute",
      "prestations": [
        {"nom": "Tableau complet 2 rangées", "prix": 1500, "quantite": 1}
      ]
    }
  ],
  "total_general": 2500
}
Priorités possibles : haute, moyenne, basse.
Garde uniquement les travaux électriques pertinents (max 5-6 recommandations).`;

    let messageContent;
    if (pdf_base64) {
      const mediaType = pdf_type || 'application/pdf';
      if (mediaType.startsWith('image/')) {
        messageContent = [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: pdf_base64 } },
          { type: 'text', text: promptBase }
        ];
      } else {
        messageContent = [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf_base64 } },
          { type: 'text', text: promptBase }
        ];
      }
    } else {
      messageContent = `${promptBase}\n\nContenu du DPE :\n---\n${(pdf_text || '').substring(0, 20000)}\n---`;
    }

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: messageContent }]
    });

    const rawText = response.content[0].text.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(rawText);
    result.recommandations = (result.recommandations || []).map(r => ({
      ...r,
      total: (r.prestations || []).reduce((s, p) => s + p.prix * (p.quantite || 1), 0)
    }));
    result.total_general = result.recommandations.reduce((s, r) => s + (r.total || 0), 0);
    res.json({ success: true, ...result });
  } catch(e) {
    console.error('❌ DPE error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// API: SANTÉ SYSTÈME
// ═══════════════════════════════════════════════════
async function verifierSante() {
  const services = {};
  // Brevo email
  try {
    const r = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': BREVO_API_KEY || '' } });
    services.brevo_email = { status: r.ok ? 'ok' : 'error' };
  } catch(e) { services.brevo_email = { status: 'error' }; }
  // Supabase
  try {
    const { error } = await supabase.from('compteurs').select('count').limit(1);
    services.supabase = { status: error ? 'error' : 'ok' };
  } catch(e) { services.supabase = { status: 'error' }; }
  // Claude API
  try {
    services.claude_api = { status: (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim().length > 10) ? 'ok' : 'error' };
  } catch(e) { services.claude_api = { status: 'unknown' }; }
  // Python PDF
  try {
    execSync('python3 -c "from reportlab.lib.pagesizes import A4; print(\'ok\')"', { timeout: 5000 });
    services.pdf_python = { status: 'ok' };
  } catch(e) { services.pdf_python = { status: 'error' }; }
  const allOk = Object.values(services).every(s => s.status === 'ok');
  await supabase.from('logs_system').insert({ type: 'sante', message: 'Health check', data: services, success: allOk }).catch(() => {});
  return { global: allOk ? 'ok' : 'degraded', services };
}

app.get('/api/sante', authMiddleware, async (req, res) => {
  try {
    const result = await verifierSante();
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sante/verifier', authMiddleware, async (req, res) => {
  try {
    const result = await verifierSante();
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: SUMUP LIEN PAIEMENT
// ═══════════════════════════════════════════════════
app.post('/api/sumup/lien/:num', async (req, res) => {
  try {
    const { num } = req.params;
    const { envoi } = req.query;
    const { data: doc } = await supabase.from('historique').select('*').eq('num', num).single();
    if (!doc) return res.status(404).json({ error: 'Document non trouvé' });
    const total = parseFloat(doc.total_ht || 0);
    const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
    const lien = `${appUrl}/paiement-confirme/${num}?montant=${total.toFixed(2)}`;
    if (envoi === 'sms' || envoi === 'les2') {
      if (doc.telephone) {
        const msg = `Bonjour ${extractPrenom(doc.client)}, votre facture SINELEC ${num} de ${total.toFixed(0)}€ est disponible. Réglez en ligne : ${lien} — SINELEC ⚡`;
        await envoyerSMS(doc.telephone, msg);
      }
    }
    if (envoi === 'email' || envoi === 'les2') {
      if (doc.email) {
        const html = `<p>Bonjour, votre facture SINELEC n°${num} d'un montant de ${total.toFixed(2)}€ est disponible.<br><a href="${lien}">Régler en ligne</a></p>`;
        await envoyerEmail(doc.email, `Facture ${num} — Lien de paiement SINELEC`, html);
      }
    }
    res.json({ success: true, lien });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: RELANCES AUTO
// ═══════════════════════════════════════════════════
app.post('/api/relances/lancer', authMiddleware, async (req, res) => {
  try {
    const since = new Date(Date.now() - 48*3600*1000).toISOString();
    const { data: devis } = await supabase.from('historique')
      .select('*').eq('type', 'devis').eq('statut', 'envoye').lte('created_at', since);
    let nb = 0;
    for (const d of (devis || [])) {
      if (d.telephone) {
        await envoyerSMS(d.telephone, `Bonjour ${extractPrenom(d.client)}, votre devis SINELEC n°${d.num} de ${parseFloat(d.total_ht||0).toFixed(0)}€ attend votre validation. 📞 07 87 38 86 22`);
        nb++;
      }
    }
    res.json({ success: true, nb_relances: nb });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/track/click/:num', async (req, res) => {
  const { num } = req.params;
  const redirect = req.query.redirect || `/signer/${num}`;
  try {
    const now = new Date().toISOString();
    await supabase.from('historique').update({ email_ouvert: true, derniere_ouverture: now }).eq('num', num);
    const { data } = await supabase.from('historique').select('premiere_ouverture').eq('num', num).single();
    if (!data?.premiere_ouverture) await supabase.from('historique').update({ premiere_ouverture: now }).eq('num', num);
  } catch(e) {}
  res.redirect(redirect);
});

app.get('/api/track/open/:num', async (req, res) => {
  const { num } = req.params;
  try {
    const now = new Date().toISOString();
    await supabase.from('historique').update({ email_ouvert: true, derniere_ouverture: now }).eq('num', num);
  } catch(e) {}
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.send(gif);
});

// ═══════════════════════════════════════════════════
// API: OTP SIGNATURE
// ═══════════════════════════════════════════════════
app.post('/api/otp-signature', async (req, res) => {
  try {
    const { num } = req.body;
    let { telephone } = req.body;
    if (!telephone) {
      const { data: doc } = await supabase.from('historique').select('telephone').eq('num', num).single();
      telephone = doc?.telephone || '';
    }
    if (!telephone || String(telephone).trim().length < 8) {
      return res.status(400).json({ success: false, error: 'Numéro introuvable. Contactez SINELEC au 07 87 38 86 22.' });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expire_at = new Date(Date.now() + 15*60*1000).toISOString();
    // Stocker en mémoire (pas besoin de colonne Supabase)
    otpSet(num, code);
    console.log('✅ OTP pour', num, '— code:', code);
    const smsResult = await envoyerSMS(telephone, 'Votre code SINELEC : ' + code + '. Valable 15 minutes.');
    if (!smsResult) return res.status(500).json({ success: false, error: "Impossible d'envoyer le SMS. Verifiez votre numero." });
    const telMasq = String(telephone).replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 ** ** $5');
    res.json({ success: true, tel: telMasq });
  } catch(e) { console.error('❌ OTP:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/verifier-otp', async (req, res) => {
  try {
    const { num, code } = req.body;
    const storedCode = otpGet(num);
    const rows = storedCode ? [{ code: storedCode }] : [];
    if (!storedCode) return res.status(404).json({ success: false, error: 'Aucun code envoyé pour ce devis' });
    const entered = String(code).replace(/\D/g, '').trim();
    const stored = String(storedCode).replace(/\D/g, '').trim();
    console.log('OTP check:', num, '| stored:', stored, '| entered:', entered);
    if (!stored || !entered || stored !== entered) return res.status(400).json({ success: false, error: 'Code incorrect' });
    otpDel(num);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// CRON JOBS
// ═══════════════════════════════════════════════════
// Email récap agenda à 7h chaque jour
cron.schedule('0 7 * * *', async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: interventions } = await supabase.from('agenda')
      .select('*')
      .gte('date_intervention', today)
      .lte('date_intervention', today)
      .order('heure', { ascending: true });

    const nb = (interventions || []).length;
    const liste = (interventions || []).map(iv =>
      `• ${iv.heure || '?'} — ${iv.client || 'Client'} — ${iv.adresse || ''} — ${iv.type_intervention || ''}`
    ).join('\n');

    const html = `<h2>📅 Agenda du jour — ${new Date().toLocaleDateString('fr-FR')}</h2>
    <p>${nb} intervention${nb > 1 ? 's' : ''} prévue${nb > 1 ? 's' : ''}</p>
    <pre style="background:#f5f5f5;padding:12px;border-radius:8px;font-family:monospace;">${liste || 'Aucune intervention'}</pre>`;

    await envoyerEmail('sinelec.paris@gmail.com', `⚡ Agenda du ${new Date().toLocaleDateString('fr-FR')} — ${nb} intervention${nb>1?'s':''}`, html);
    console.log(`✅ Récap agenda envoyé: ${nb} interventions`);
  } catch(e) { console.error('Cron agenda:', e.message); }
});


// ══════════════════════════════════════════════════════════════
// RELANCES COMMERCIALES AUTOMATIQUES — J+7, J+14, J+21
// Chaque matin à 9h — 3 tons progressifs
// ══════════════════════════════════════════════════════════════
cron.schedule('0 9 * * *', async () => {
  try {
    const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
    const now = Date.now();

    const { data: devis } = await supabase
      .from('historique')
      .select('*')
      .eq('type', 'devis')
      .in('statut', ['envoye', 'envoyé', 'en attente'])
      .order('created_at', { ascending: true });

    let nb7 = 0, nb14 = 0, nb21 = 0;

    for (const d of (devis || [])) {
      if (!d.telephone) continue;

      const ageJours = Math.floor((now - new Date(d.created_at).getTime()) / (24 * 3600 * 1000));
      const prenom = extractPrenom(d.client || '');
      const montant = parseFloat(d.total_ht || 0).toFixed(0);
      const lien = `${appUrl}/signer/${d.num}`;

      try {
        // ── J+7 : Rappel simple et professionnel ─────────────────
        if (ageJours >= 7 && ageJours < 14 && !d.sms_relance_j7) {
          const msg = `Bonjour ${prenom}, votre devis SINELEC n°${d.num} de ${montant}€ est toujours en attente. Pour planifier votre intervention, signez-le ici : ${lien} — Diahe ⚡`;
          await envoyerSMS(d.telephone, msg);
          await supabase.from('historique').update({ sms_relance_j7: true, sms_relance_j7_date: new Date().toISOString() }).eq('num', d.num);
          console.log(`📨 Relance J+7: ${d.num} → ${d.telephone}`);
          nb7++;
        }

        // ── J+14 : Ton commercial — met en avant la valeur ───────
        else if (ageJours >= 14 && ageJours < 21 && !d.sms_relance_j14) {
          const msg = `Bonjour ${prenom}, votre installation électrique mérite d'être sécurisée ! Notre devis n°${d.num} (${montant}€) inclut garantie décennale + norme NF C 15-100. On peut intervenir rapidement 👉 ${lien} — Diahe, SINELEC Paris ⚡`;
          await envoyerSMS(d.telephone, msg);
          await supabase.from('historique').update({ sms_relance_j14: true, sms_relance_j14_date: new Date().toISOString() }).eq('num', d.num);
          console.log(`📨 Relance J+14: ${d.num} → ${d.telephone}`);
          nb14++;
        }

        // ── J+21 : Négociation — dernière chance ─────────────────
        else if (ageJours >= 21 && !d.sms_relance_j21) {
          const msg = `Bonjour ${prenom}, c'est Diahe de SINELEC. Je voulais savoir si vous avez des questions sur votre devis n°${d.num} (${montant}€). Je suis disponible pour en discuter et m'adapter à votre budget si besoin. 📞 07 87 38 86 22 — SINELEC Paris ⚡`;
          await envoyerSMS(d.telephone, msg);
          await supabase.from('historique').update({ sms_relance_j21: true, sms_relance_j21_date: new Date().toISOString() }).eq('num', d.num);
          console.log(`📨 Relance J+21 (négo): ${d.num} → ${d.telephone}`);
          nb21++;
        }
      } catch(e) { console.error(`Relance ${d.num}:`, e.message); }
    }

    const total = nb7 + nb14 + nb21;
    if (total > 0) console.log(`✅ Relances du jour — J+7: ${nb7} | J+14: ${nb14} | J+21: ${nb21}`);
  } catch(e) { console.error('Cron relances:', e.message); }
});

// Rappel SMS client veille à 18h
cron.schedule('0 18 * * *', async () => {
  try {
    const tomorrow = new Date(Date.now() + 24*3600*1000).toISOString().split('T')[0];
    const { data: interventions } = await supabase.from('agenda')
      .select('*')
      .eq('date_intervention', tomorrow)
      .eq('sms_rappel', true);

    for (const iv of (interventions || [])) {
      if (iv.telephone) {
        const heure = iv.heure ? ` à ${iv.heure}` : '';
        const msg = `Bonjour ${iv.client || ''}, rappel de votre intervention SINELEC demain${heure}. 📞 07 87 38 86 22`;
        await envoyerSMS(iv.telephone, msg);
        await supabase.from('agenda').update({ sms_rappel_envoye: true }).eq('id', iv.id);
      }
    }
  } catch(e) { console.error('Cron rappel:', e.message); }
});

// Santé toutes les heures
cron.schedule('0 * * * *', async () => {
  try { await verifierSante(); } catch(e) {}
});

// ═══════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`⚡ SINELEC OS v2.0 démarré sur le port ${PORT}`);
  console.log(`📊 Supabase: ${process.env.SUPABASE_URL ? '✅' : '❌'}`);
  console.log(`🤖 Claude API: ${process.env.ANTHROPIC_API_KEY ? '✅' : '❌'}`);
  console.log(`📧 Brevo: ${BREVO_API_KEY ? '✅' : '❌'}`);
});
