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
  const publicRoutes = ['/', '/health', '/api/login', '/signer/', '/paiement-confirme/', '/api/signature', '/api/otp-signature', '/api/auth/check', '/api/test-pdf', '/api/test'];
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
      const clientRue = adresseParts.length >= 2 && adresseParts[0].match(/^\d+$/) ? adresseParts[0] + ' ' + adresseParts[1] : adresseParts[0] || '';
      const cpMatch = adresseRaw.match(/\b(\d{5})\b/);
      const clientCP = String(codePostal || '').trim() || (cpMatch ? cpMatch[1] : '');
      const villeManuelle = String(ville || '').trim();
      const villeGPS = adresseParts.find(p => p.length > 2 && p.length < 30 && !p.match(/^\d{5}/) && !p.toLowerCase().includes('france')) || '';
      const clientCPVille = [clientCP, villeManuelle || villeGPS].filter(Boolean).join(' ');
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
        lbl_sz=40 if len(doc_label)<=7 else (30 if len(doc_label)<=10 else 22)
        self.setFont('Helvetica-Bold',lbl_sz); self.setFillColor(BLANC); self.drawRightString(W-1.2*cm,H-2.2*cm,doc_label)
        self.setStrokeColor(OR); self.setLineWidth(1.5); self.line(13*cm,H-2.65*cm,W-1.2*cm,H-2.65*cm)
        self.setFillColor(OR); self.roundRect(W-6.5*cm,H-3.55*cm,5.3*cm,0.65*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(MARINE); self.drawCentredString(W-3.85*cm,H-3.22*cm,'N\u00b0 '+doc_num)
        self.setFont('Helvetica',8); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawRightString(W-1.2*cm,H-3.9*cm,'Date : '+doc_date+'   |   Valable : '+doc_valide)
    def _draw_header_small(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,1.5*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',10); self.setFillColor(BLANC); self.drawString(1.4*cm,H-1.0*cm,'SINELEC')
        self.setFont('Helvetica',8); self.setFillColor(OR); self.drawRightString(W-1.2*cm,H-1.0*cm,doc_label+' N\u00b0 '+doc_num)
    def _draw_footer(self):
        self.saveState()
        if is_paye and self._pg==0:
            self.saveState()
            p_clip=self.beginPath()
            p_clip.rect(0.78*cm,1.6*cm,W-1.78*cm,H-5.6*cm-1.6*cm)
            self.clipPath(p_clip,stroke=0,fill=0)
            self.translate(W/2,H*0.58); self.rotate(45)
            self.setFont('Helvetica-Bold',80); self.setFillColor(colors.HexColor('#16a34a')); self.setFillAlpha(0.18)
            self.drawCentredString(0,0,'PAY\u00c9'); self.restoreState()
        if (is_paye or is_signe) and self._pg==0: self._draw_tampons()
        self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI  \u2022  128 Rue La Boetie, 75008 Paris  \u2022  SIRET : 91015824500019  \u2022  TVA non applicable art. 293B CGI')
        self.setFont('Helvetica-Bold',7); self.setFillColor(OR); self.drawRightString(W-1.2*cm,0.28*cm,doc_num)
        self.restoreState()
    def _draw_tampons(self):
        vert=colors.HexColor('#16a34a')
        couleur=vert if (is_paye or is_signe) else None
        if not couleur: return
        cx=W-4.2*cm; cy=2.8*cm; r=1.9*cm
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
client_lines=[p('CLIENT',7,'Helvetica-Bold',OR,sa=3),p(client_nom,11,'Helvetica-Bold',MARINE),p(client_rue,9,color=GRIS_TEXTE),p(client_ville,9,color=GRIS_TEXTE)]
if client_tel: client_lines.append(p('Tel : '+client_tel,8.5,color=GRIS_SOFT))
if client_siret: client_lines.append(p('SIRET : '+client_siret,8,color=GRIS_SOFT))
client_b=Table([[c] for c in client_lines],colWidths=[8.2*cm])
client_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),1,OR)]))
hdr_row=Table([[objet_b,client_b]],colWidths=[9.5*cm,8.7*cm])
hdr_row.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
story.append(hdr_row); story.append(Spacer(1,0.5*cm))
th=[p('#',8,'Helvetica-Bold',BLANC,TA_CENTER),p('DESIGNATION',8,'Helvetica-Bold',BLANC),p('QTE',8,'Helvetica-Bold',BLANC,TA_CENTER),p('U.',8,'Helvetica-Bold',BLANC,TA_CENTER),p('PRIX U. HT',8,'Helvetica-Bold',BLANC,TA_RIGHT),p('TOTAL HT',8,'Helvetica-Bold',BLANC,TA_RIGHT)]
rows=[th]; sect_num=0; item_num=0
for ligne in data:
    if ligne.get('_section'):
        sect_num+=1; item_num=0
        rows.append([p(str(ligne.get('titre','Section')),9,'Helvetica-Bold',BLANC,sa=4),'','','','','']); continue
    item_num+=1
    sub_num=str(sect_num)+'.'+str(item_num) if sect_num>0 else str(item_num)
    nom=str(ligne.get('designation',''))
    qte=int(ligne.get('qte',1) or 1); pu=float(ligne.get('prixUnit',0) or 0); tot=float(ligne.get('total',pu*qte) or 0)
    is_offert=(pu==0 or tot==0)
    desig_cell=[p(nom,9,'Helvetica-Bold',MARINE)]
    for d in (ligne.get('details') or []):
        if d: desig_cell.append(p(str(d),7.5,'Helvetica',GRIS_SOFT,sb=1,sa=0))
    rows.append([p(sub_num,8,color=GRIS_SOFT,align=TA_CENTER),desig_cell,p(str(qte),9,align=TA_CENTER),p('u.',8,color=GRIS_SOFT,align=TA_CENTER),p(('%.2f \u20ac'%pu) if not is_offert else 'OFFERT',9,align=TA_RIGHT),(p('OFFERT',9,'Helvetica-Bold',align=TA_RIGHT,color=colors.HexColor('#16a34a')) if is_offert else p('%.2f \u20ac'%tot,9,'Helvetica-Bold',align=TA_RIGHT,color=OR_FONCE))])
COL=[0.8*cm,9.0*cm,1.3*cm,1.0*cm,2.6*cm,3.5*cm]
t=Table(rows,colWidths=COL,repeatRows=1)
ts=[('BACKGROUND',(0,0),(-1,0),MARINE),('ROWBACKGROUNDS',(0,1),(-1,-1),[CREME,OR_PALE]),('LINEBELOW',(0,0),(-1,0),1.5,OR),('LINEBELOW',(0,-1),(-1,-1),1.5,MARINE),('LEFTPADDING',(0,0),(-1,-1),4),('RIGHTPADDING',(0,0),(-1,-1),4),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('VALIGN',(0,0),(-1,-1),'TOP'),('ALIGN',(2,0),(3,-1),'CENTER'),('ALIGN',(4,0),(5,-1),'RIGHT')]
for i,row in enumerate(rows):
    if i>0 and isinstance(row[1],str) and row[1]=='':
        ts+=[('BACKGROUND',(0,i),(-1,i),colors.HexColor('#243660')),('SPAN',(0,i),(-1,i)),('TEXTCOLOR',(0,i),(-1,i),BLANC)]
t.setStyle(TableStyle(ts))
story.append(t); story.append(Spacer(1,0.4*cm))
tot_t=Table([[p('Total HT',10,'Helvetica',GRIS_TEXTE),p('%.2f \u20ac'%totalHT,10,'Helvetica-Bold',MARINE,TA_RIGHT)],[p('TVA Non applicable (art. 293B)',9,'Helvetica',GRIS_SOFT),p('',9)]],colWidths=[14.2*cm,4.0*cm])
tot_t.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,0),0.5,GRIS_LIGNE)]))
story.append(tot_t); story.append(Spacer(1,0.2*cm))
net=Table([[p('NET \u00c0 PAYER',13,'Helvetica-Bold',BLANC),p('%.2f \u20ac'%totalHT,16,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,-1),2,OR)]))
story.append(net)
story.append(Spacer(1,0.3*cm))

if is_paye:
    date_p=str(meta.get('datePaiement',''))or str(meta.get('dateStr',''))
    mode_p=str(meta.get('modePaiement','Règlement reçu'))
    VERT_P=colors.HexColor('#16a34a')
    VERT_BG=colors.HexColor('#f0fdf4')
    story.append(Spacer(1,0.4*cm))
    pr=Table([[p('PAIEMENT RE\u00c7U',9,'Helvetica-Bold',VERT_P,sa=4),''],[p('Date :',8,color=GRIS_SOFT),p(date_p,8,'Helvetica-Bold',MARINE,TA_RIGHT)],[p('Mode :',8,color=GRIS_SOFT),p(mode_p,8,'Helvetica-Bold',MARINE,TA_RIGHT)],[p('Montant encaiss\u00e9 :',9,'Helvetica-Bold',VERT_P),p('%.2f \u20ac'%totalHT,11,'Helvetica-Bold',VERT_P,TA_RIGHT)]],colWidths=[9.1*cm,9.1*cm])
    pr.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),VERT_BG),('BOX',(0,0),(-1,-1),2,VERT_P),('SPAN',(0,0),(1,0)),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('LINEBELOW',(0,0),(-1,0),1,colors.HexColor('#bbf7d0')),('LINEABOVE',(0,3),(-1,3),1,colors.HexColor('#bbf7d0'))]))
    story.append(pr)
if doc_type=='devis' and totalHT>=400:
    acompte=totalHT*0.4; solde=totalHT*0.6
    ac_t=Table([[p('ACOMPTE',11,'Helvetica-Bold',MARINE,TA_CENTER),p('SOLDE',11,'Helvetica-Bold',MARINE,TA_CENTER)],[p('A la signature',8,'Helvetica',GRIS_SOFT,TA_CENTER),p('Fin des travaux',8,'Helvetica',GRIS_SOFT,TA_CENTER)],[p('40%',20,'Helvetica-Bold',OR,TA_CENTER),p('60%',20,'Helvetica-Bold',OR,TA_CENTER)],[p('%.2f \u20ac'%acompte,12,'Helvetica-Bold',MARINE,TA_CENTER),p('%.2f \u20ac'%solde,12,'Helvetica-Bold',MARINE,TA_CENTER)]],colWidths=[9.1*cm,9.1*cm])
    ac_t.setStyle(TableStyle([('BACKGROUND',(0,0),(0,-1),OR_PALE),('BACKGROUND',(1,0),(1,-1),colors.white),('BOX',(0,0),(0,-1),1.5,OR),('LINEBEFORE',(1,0),(1,-1),1,GRIS_LIGNE),('BOX',(1,0),(1,-1),0.5,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
    story.append(ac_t); story.append(Spacer(1,0.3*cm))
story.append(Table([[p('\u2022 Especes  \u2022 Virement bancaire  \u2022 CB / PayPal  \u2022  Validite 30 jours',8,'Helvetica',GRIS_SOFT,TA_CENTER)]],colWidths=[18.2*cm]))
story.append(Spacer(1,0.4*cm))
iban_t=Table([[p('IBAN FR76 1695 8000 0174 2540 5920 931     BIC QNTOFRP1XXX',9,'Helvetica-Bold',MARINE,TA_CENTER)]],colWidths=[18.2*cm])
iban_t.setStyle(TableStyle([('BOX',(0,0),(-1,-1),1.5,OR),('BACKGROUND',(0,0),(-1,-1),OR_PALE),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
story.append(iban_t)
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

      // Email NON envoyé automatiquement — cliquer sur "Envoyer" manuellement
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

    // Récupérer le PDF et le type du document
    let pdf_b64 = pdfB64;
    let docType = 'facture';
    if (!pdf_b64) {
      const { data: doc } = await supabase.from('historique').select('*').eq('num', num).single();
      if (doc) {
        docType = doc.type || 'facture';
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

    const lienSig = `${appUrl}/signer/${num}`;

    // Bouton signature uniquement pour les devis
    const signatureBlock = docType === 'devis' ? `
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
        <p style="font-size:12px;color:#888;margin-top:16px;">📞 07 87 38 86 22 | sinelec.paris@gmail.com</p>
      </div>
    </div>`;

    // Pixel espion
    const htmlWithPixel = htmlEmail + `<img src="${appUrl}/api/track/open/${num}" width="1" height="1" style="display:none">`;

    const attachment = pdf_b64 ? { content: pdf_b64, name: `${num}.pdf` } : null;
    const emailRes = await envoyerEmail(email, sujet || `Document ${num} - SINELEC`, htmlWithPixel, attachment);


    // CC si fourni
    if (cc) { try { await envoyerEmail(cc, sujet || `Document ${num}`, htmlEmail, attachment); } catch(e) {} }

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
    await supabase.from('historique').update({
      statut: 'signe',
      date_signature: now,
      signature_ip: ip || null,
      signature_data: signature || null
    }).eq('num', num);

    // Email de confirmation au client
    const { data: doc } = await supabase.from('historique').select('*').eq('num', num).single();
    if (doc && doc.email) {
      const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;">
        <div style="background:linear-gradient(135deg,#1B2A4A,#243660);padding:20px;text-align:center;border-radius:12px 12px 0 0;">
          <div style="font-size:32px;">✍️</div>
          <h2 style="color:#fff;margin:8px 0 0;">Devis signé — SINELEC</h2>
        </div>
        <div style="padding:24px;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 12px 12px;">
          <p style="font-size:15px;">Bonjour,</p>
          <p>Votre devis <strong>${num}</strong> a bien été signé le ${new Date().toLocaleDateString('fr-FR')}.</p>
          <p>Nous vous contacterons rapidement pour planifier l'intervention.</p>
          <p style="font-size:12px;color:#888;">📞 07 87 38 86 22 | sinelec.paris@gmail.com</p>
        </div>
      </div>`;
      try { await envoyerEmail(doc.email, `Devis ${num} signé — Confirmation SINELEC`, html); } catch(e) {}
      // Email Diahe — devis signé avec PDF en pièce jointe
      const htmlDiahe = `<div style="font-family:Arial,sans-serif;padding:20px;"><h2 style="color:#16a34a;">✅ Devis signé !</h2><p><strong>${doc.client}</strong> a signé le devis <strong>${num}</strong></p><p>Montant : <strong>${(doc.total_ht||0).toFixed(2)} €</strong></p><p>Date : ${new Date().toLocaleString('fr-FR')}</p><p style="color:#888;font-size:12px;">IP : ${ip || 'N/A'}</p></div>`;
      try {
        const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
        const token = process.env.AUTH_TOKEN || '';
        const pdfRes = await fetch(`${appUrl}/api/pdf/${num}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const pdfBuf = await pdfRes.arrayBuffer();
        const pdfB64 = Buffer.from(pdfBuf).toString('base64');
        await envoyerEmail('sinelec.paris@gmail.com', `[SIGNÉ] ${doc.client} — Devis ${num}`, htmlDiahe, { content: pdfB64, name: `${num}_signe.pdf` });
      } catch(e) {
        await envoyerEmail('sinelec.paris@gmail.com', `[SIGNÉ] ${doc.client} — Devis ${num}`, htmlDiahe).catch(()=>{});
      }
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
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signer le devis ${num}</title>
<style>body{font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;background:#f5f5f5;}
.card{background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 20px rgba(0,0,0,0.1);}
h2{color:#1B2A4A;margin-bottom:4px;}
canvas{border:2px dashed #ccc;border-radius:12px;width:100%;height:160px;touch-action:none;cursor:crosshair;background:#fff;}
.btn{width:100%;padding:16px;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;margin-top:10px;}
.btn-sign{background:linear-gradient(135deg,#E8B84B,#C9962A);color:#fff;}
.btn-clear{background:#f0f0f0;color:#666;}
.info{font-size:13px;color:#888;margin:8px 0;}
</style></head>
<body><div class="card">
<div style="text-align:center;margin-bottom:16px;"><div style="font-size:36px;">⚡</div><h2>SINELEC Paris</h2></div>
<h3 style="color:#1B2A4A;">Devis n° ${num}</h3>
<p><strong>${doc.client}</strong></p>
<p style="color:#C9A84C;font-weight:700;">Montant : ${(doc.total_ht||0).toFixed(0)} € HT</p>
<p class="info">En signant, vous acceptez les conditions du devis ci-joint.</p>
<canvas id="sig" width="460" height="160"></canvas>
<button class="btn btn-clear" onclick="clear()">↺ Effacer</button>
<button class="btn btn-sign" onclick="sign()">✍️ Je signe et j'accepte le devis</button>
<div id="msg" style="margin-top:12px;text-align:center;font-weight:700;"></div>
</div>
<script>
const cv=document.getElementById('sig'),ctx=cv.getContext('2d');
let drawing=false;
ctx.strokeStyle='#1B2A4A';ctx.lineWidth=2;ctx.lineCap='round';
const pos=e=>{const r=cv.getBoundingClientRect();const sx=cv.width/r.width;const sy=cv.height/r.height;return e.touches?{x:(e.touches[0].clientX-r.left)*sx,y:(e.touches[0].clientY-r.top)*sy}:{x:(e.clientX-r.left)*sx,y:(e.clientY-r.top)*sy};};
cv.addEventListener('mousedown',e=>{drawing=true;ctx.beginPath();const p=pos(e);ctx.moveTo(p.x,p.y);});
cv.addEventListener('mousemove',e=>{if(!drawing)return;const p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();});
cv.addEventListener('mouseup',()=>drawing=false);
cv.addEventListener('touchstart',e=>{e.preventDefault();drawing=true;ctx.beginPath();const p=pos(e);ctx.moveTo(p.x,p.y);},{passive:false});
cv.addEventListener('touchmove',e=>{e.preventDefault();if(!drawing)return;const p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();},{passive:false});
cv.addEventListener('touchend',()=>drawing=false);
function clear(){ctx.clearRect(0,0,cv.width,cv.height);}
async function sign(){
  const msg=document.getElementById('msg');
  msg.textContent='⏳ Enregistrement...';msg.style.color='#C9A84C';
  const res=await fetch('${appUrl}/api/signature',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({num:'${num}',signature:cv.toDataURL('image/png'),ip:''})});
  const data=await res.json();
  if(data.success){msg.textContent='✅ Signé ! Merci, nous vous recontactons.';msg.style.color='#16a34a';document.querySelector('.btn-sign').disabled=true;}
  else{msg.textContent='❌ Erreur: '+data.error;msg.style.color='#dc2626';}
}
</script></body></html>`);
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
        // SMS avis Google automatique si téléphone disponible
        if (doc && doc.telephone) {
          const prenom = extractPrenom(doc.client);
          const msgAvis = `Bonjour ${prenom}, merci pour votre confiance ! Un avis Google nous aiderait beaucoup : https://g.page/r/CSw-MABnFUAYEAE/review — Diahe, SINELEC ⚡`;
          const msgId = await envoyerSMS(doc.telephone, msgAvis);
          if (msgId) {
            await supabase.from('historique').update({ sms_avis_envoye: true, sms_avis_date: new Date().toISOString(), sms_avis_statut: 'envoye' }).eq('num', num);
            console.log(`📱 SMS avis envoyé: ${num} → ${doc.telephone}`);
          }
        }
      } catch(e) { console.error('Facture acquittée error:', e.message); }
    });

    res.json({ success: true });
  } catch(error) { res.status(500).json({ error: error.message }); }
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
        datePaiement, modePaiement, nomCourt: clientEscDl.toUpperCase().split(' ').slice(0,2).join(' ').substring(0,14)
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
doc_type=str(meta.get('type','devis')).lower()
totalHT=sum(float(l.get('total',0)) for l in data if not l.get('_section'))
try:
    logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())
except:
    logo_bytes=None
IS_PAYE = ${isPaye ? 'True' : 'False'}
IS_SIGNE = '${docType}'=='devis' and '${docStatut}' in ('signe','signé')
class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw): pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0; self.saveState(); self._draw_page()
    def showPage(self): self._draw_footer(); pdfcanvas.Canvas.showPage(self); self._pg+=1
    def save(self): self._draw_footer(); pdfcanvas.Canvas.save(self)
    def _draw_page(self):
        self.saveState(); self.setFillColor(CREME); self.rect(0,0,W,H,fill=1,stroke=0)
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
        self.setFont('Helvetica-Bold',15); self.setFillColor(colors.white); self.drawString(5.9*cm,H-1.7*cm,'SINELEC PARIS')
        self.setFont('Helvetica-Bold',9); self.setFillColor(colors.white); self.drawString(5.9*cm,H-2.5*cm,'128 Rue La Boetie, 75008 Paris')
        self.setFont('Helvetica',8.5); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(5.9*cm,H-3.0*cm,'Tel : 07 87 38 86 22'); self.drawString(5.9*cm,H-3.4*cm,'sinelec.paris@gmail.com')
        self.setFillColor(colors.HexColor('#243660')); self.roundRect(5.9*cm,H-4.15*cm,5.5*cm,0.55*cm,0.1*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',8); self.setFillColor(OR); self.drawString(6.1*cm,H-3.88*cm,'SIRET : 91015824500019')
        lbl_sz=40 if len('${typeLabelUpper}')<=7 else (30 if len('${typeLabelUpper}')<=10 else 22)
        self.setFont('Helvetica-Bold',lbl_sz); self.setFillColor(BLANC); self.drawRightString(W-1.2*cm,H-2.2*cm,'${typeLabelUpper}')
        self.setStrokeColor(OR); self.setLineWidth(1.5); self.line(13*cm,H-2.65*cm,W-1.2*cm,H-2.65*cm)
        self.setFillColor(OR); self.roundRect(W-6.5*cm,H-3.55*cm,5.3*cm,0.65*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(MARINE); self.drawCentredString(W-3.85*cm,H-3.22*cm,'N\\u00b0 ${num}')
        self.setFont('Helvetica',8); self.setFillColor(colors.HexColor('#BFC8D6')); self.drawRightString(W-1.2*cm,H-3.9*cm,'Date : ${dateStr}   |   Valable : ${dateValide}')
    def _draw_header_small(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,1.5*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',10); self.setFillColor(BLANC); self.drawString(1.4*cm,H-1.0*cm,'SINELEC')
        self.setFont('Helvetica',8); self.setFillColor(OR); self.drawRightString(W-1.2*cm,H-1.0*cm,'${typeLabelUpper} N\\u00b0 ${num}')
    def _draw_footer(self):
        self.saveState()
        if IS_PAYE and self._pg==0:
            self.saveState()
            p_clip=self.beginPath()
            p_clip.rect(0.78*cm,1.6*cm,W-1.78*cm,H-5.6*cm-1.6*cm)
            self.clipPath(p_clip,stroke=0,fill=0)
            self.translate(W/2,H*0.58); self.rotate(45)
            self.setFont('Helvetica-Bold',80); self.setFillColor(colors.HexColor('#16a34a')); self.setFillAlpha(0.18)
            self.drawCentredString(0,0,'PAY\u00c9'); self.restoreState()
        if (IS_PAYE or IS_SIGNE) and self._pg==0: self._draw_tampons()
        self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI  \\u2022  128 Rue La Boetie, 75008 Paris  \\u2022  SIRET : 91015824500019  \\u2022  TVA non applicable art. 293B CGI')
        self.setFont('Helvetica-Bold',7); self.setFillColor(OR); self.drawRightString(W-1.2*cm,0.28*cm,'${num}')
        self.restoreState()
    def _draw_tampons(self):
        vert=colors.HexColor('#16a34a')
        couleur = vert if (IS_PAYE or IS_SIGNE) else None
        if not couleur: return
        cx=W-4.2*cm; cy=2.8*cm; r=1.9*cm
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
client_b=Table([[p('CLIENT',7,'Helvetica-Bold',OR,sa=3)],[p('${clientEsc}',11,'Helvetica-Bold',MARINE)],[p('${clientRue}',9,color=GRIS_TEXTE)],[p('${clientVille}',9,color=GRIS_TEXTE)]],colWidths=[8.2*cm])
client_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2),('LEFTPADDING',(0,0),(-1,-1),0)]))
hdr_row=Table([[objet_b,client_b]],colWidths=[9.5*cm,8.7*cm])
hdr_row.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
story.append(hdr_row); story.append(Spacer(1,0.5*cm))
th=[p('#',8,'Helvetica-Bold',BLANC,TA_CENTER),p('DESIGNATION',8,'Helvetica-Bold',BLANC),p('QTE',8,'Helvetica-Bold',BLANC,TA_CENTER),p('U.',8,'Helvetica-Bold',BLANC,TA_CENTER),p('PRIX U. HT',8,'Helvetica-Bold',BLANC,TA_RIGHT),p('TOTAL HT',8,'Helvetica-Bold',BLANC,TA_RIGHT)]
rows=[th]; sect_num=0; item_num=0
for ligne in data:
    if ligne.get('_section'):
        sect_num+=1; item_num=0
        rows.append([p(str(ligne.get('titre',f'Section {sect_num}')),9,'Helvetica-Bold',BLANC,sa=4),'','','','','']); continue
    item_num+=1
    sub_num=f'{sect_num}.{item_num}' if sect_num>0 else str(item_num)
    nom=str(ligne.get('designation',''))
    qte=int(ligne.get('qte',1) or 1); pu=float(ligne.get('prixUnit',0) or 0); tot=float(ligne.get('total',pu*qte) or 0)
    is_offert=(pu==0 or tot==0)
    desig_cell=[p(nom,9,'Helvetica-Bold',MARINE)]
    for d in (ligne.get('details') or []):
        if d: desig_cell.append(p(str(d),7.5,'Helvetica',GRIS_SOFT,sb=1,sa=0))
    rows.append([p(sub_num,8,color=GRIS_SOFT,align=TA_CENTER),desig_cell,p(str(qte),9,align=TA_CENTER),p('u.',8,color=GRIS_SOFT,align=TA_CENTER),p(f'{pu:.2f} \\u20ac' if not is_offert else 'OFFERT',9,align=TA_RIGHT),p('OFFERT' if is_offert else f'{tot:.2f} \\u20ac',9,'Helvetica-Bold',align=TA_RIGHT,color=colors.HexColor('#16a34a') if is_offert else OR_FONCE)])
COL=[0.8*cm,9.0*cm,1.3*cm,1.0*cm,2.6*cm,3.5*cm]
t=Table(rows,colWidths=COL,repeatRows=1)
ts=[('BACKGROUND',(0,0),(-1,0),MARINE),('ROWBACKGROUNDS',(0,1),(-1,-1),[CREME,OR_PALE]),('LINEBELOW',(0,0),(-1,0),1.5,OR),('LINEBELOW',(0,-1),(-1,-1),1.5,MARINE),('LEFTPADDING',(0,0),(-1,-1),4),('RIGHTPADDING',(0,0),(-1,-1),4),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('VALIGN',(0,0),(-1,-1),'TOP'),('ALIGN',(2,0),(3,-1),'CENTER'),('ALIGN',(4,0),(5,-1),'RIGHT')]
for i,row in enumerate(rows):
    if i>0 and isinstance(row[1],str) and row[1]=='':
        ts+=[('BACKGROUND',(0,i),(-1,i),colors.HexColor('#243660')),('SPAN',(0,i),(-1,i)),('TEXTCOLOR',(0,i),(-1,i),BLANC)]
t.setStyle(TableStyle(ts))
story.append(t); story.append(Spacer(1,0.4*cm))
tot_t=Table([[p('Total HT',10,'Helvetica',GRIS_TEXTE),p('%.2f \\u20ac'%totalHT,10,'Helvetica-Bold',MARINE,TA_RIGHT)],[p('TVA Non applicable (art. 293B)',9,'Helvetica',GRIS_SOFT),p('',9)]],colWidths=[14.2*cm,4.0*cm])
tot_t.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,0),0.5,GRIS_LIGNE)]))
story.append(tot_t); story.append(Spacer(1,0.2*cm))
net=Table([[p('NET \\u00c0 PAYER',13,'Helvetica-Bold',BLANC),p('%.2f \\u20ac'%totalHT,16,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,-1),2,OR)]))
story.append(net)
story.append(Spacer(1,0.3*cm))

if IS_PAYE:
    date_p=str(meta.get('datePaiement',''))or str(meta.get('dateStr',''))
    mode_p=str(meta.get('modePaiement','Règlement reçu'))
    VERT_P=colors.HexColor('#16a34a')
    VERT_BG=colors.HexColor('#f0fdf4')
    story.append(Spacer(1,0.4*cm))
    pr=Table([[p('PAIEMENT RE\\u00c7U',9,'Helvetica-Bold',VERT_P,sa=4),''],[p('Date :',8,color=GRIS_SOFT),p(date_p,8,'Helvetica-Bold',MARINE,TA_RIGHT)],[p('Mode :',8,color=GRIS_SOFT),p(mode_p,8,'Helvetica-Bold',MARINE,TA_RIGHT)],[p('Montant encaiss\\u00e9 :',9,'Helvetica-Bold',VERT_P),p('%.2f \\u20ac'%totalHT,11,'Helvetica-Bold',VERT_P,TA_RIGHT)]],colWidths=[9.1*cm,9.1*cm])
    pr.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),VERT_BG),('BOX',(0,0),(-1,-1),2,VERT_P),('SPAN',(0,0),(1,0)),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('LINEBELOW',(0,0),(-1,0),1,colors.HexColor('#bbf7d0')),('LINEABOVE',(0,3),(-1,3),1,colors.HexColor('#bbf7d0'))]))
    story.append(pr)
if doc_type=='devis' and totalHT>=400:
    acompte=totalHT*0.4; solde=totalHT*0.6
    ac_t=Table([[p('ACOMPTE',11,'Helvetica-Bold',MARINE,TA_CENTER),p('SOLDE',11,'Helvetica-Bold',MARINE,TA_CENTER)],[p('A la signature',8,'Helvetica',GRIS_SOFT,TA_CENTER),p('Fin des travaux',8,'Helvetica',GRIS_SOFT,TA_CENTER)],[p('40%',20,'Helvetica-Bold',OR,TA_CENTER),p('60%',20,'Helvetica-Bold',OR,TA_CENTER)],[p('%.2f \\u20ac'%acompte,12,'Helvetica-Bold',MARINE,TA_CENTER),p('%.2f \\u20ac'%solde,12,'Helvetica-Bold',MARINE,TA_CENTER)]],colWidths=[9.1*cm,9.1*cm])
    ac_t.setStyle(TableStyle([('BACKGROUND',(0,0),(0,-1),OR_PALE),('BACKGROUND',(1,0),(1,-1),colors.white),('BOX',(0,0),(0,-1),1.5,OR),('LINEBEFORE',(1,0),(1,-1),1,GRIS_LIGNE),('BOX',(1,0),(1,-1),0.5,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
    story.append(ac_t); story.append(Spacer(1,0.3*cm))
story.append(Table([[p('\\u2022 Especes  \\u2022 Virement bancaire  \\u2022 CB / PayPal  \\u2022  Validite 30 jours',8,'Helvetica',GRIS_SOFT,TA_CENTER)]],colWidths=[18.2*cm]))
story.append(Spacer(1,0.4*cm))
iban_t=Table([[p('IBAN FR76 1695 8000 0174 2540 5920 931     BIC QNTOFRP1XXX',9,'Helvetica-Bold',MARINE,TA_CENTER)]],colWidths=[18.2*cm])
iban_t.setStyle(TableStyle([('BOX',(0,0),(-1,-1),1.5,OR),('BACKGROUND',(0,0),(-1,-1),OR_PALE),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
story.append(iban_t)
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
client_b=Table([[p('CLIENT',7,'Helvetica-Bold',OR,sa=3)],[p('${clientEsc}',11,'Helvetica-Bold',MARINE)],[p('${clientRue}',9)],[p('${clientVille}',9)]],colWidths=[8.2*cm])
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
doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw)); print('PDF_OK')
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

// Envoyer SMS rappel manuel pour une intervention
app.post('/api/agenda/:id/sms', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: iv } = await supabase.from('agenda').select('*').eq('id', id).single();
    if (!iv || !iv.telephone) return res.status(400).json({ error: 'Téléphone manquant' });
    const heure = iv.heure ? ` à ${iv.heure}` : '';
    const msg = `Bonjour ${iv.client || ''}, rappel de votre intervention SINELEC demain${heure}. 📞 07 87 38 86 22`;
    const msgId = await envoyerSMS(iv.telephone, msg);
    if (!msgId) return res.status(500).json({ error: 'Échec envoi SMS' });
    await supabase.from('agenda').update({ sms_rappel_envoye: true }).eq('id', id);
    res.json({ success: true, messageId: msgId });
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
      messages: [{ role: 'user', content: 'Tu es un électricien expert SINELEC Paris. Rédige une description professionnelle pour un rapport intervention.\nTravaux : "' + chantier + '"' + (client ? '\nClient : ' + client : '') + (adresse ? '\nAdresse : ' + adresse : '') + '\nÉcris 150-200 mots professionnels, normes NF C 15-100. Commence directement.' }]    });
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

// ═══════════════════════════════════════════════════
// API: OTP SIGNATURE
// ═══════════════════════════════════════════════════
app.post('/api/otp-signature', async (req, res) => {
  try {
    const { num, telephone } = req.body;
    const code = String(Math.floor(1000 + Math.random() * 9000));
    await supabase.from('historique').update({ otp_code: code, otp_expiry: new Date(Date.now() + 15*60*1000).toISOString() }).eq('num', num);
    await envoyerSMS(telephone, `Votre code SINELEC : ${code}. Valable 15 minutes.`);
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
