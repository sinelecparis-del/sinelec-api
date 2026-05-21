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
  const publicRoutes = ['/', '/health', '/api/login', '/signer/', '/paiement-confirme/', '/api/signature', '/api/otp-signature', '/api/auth/check'];
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

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  realtime: { transport: ws }
});
const anthropic = new Anthropic({ apiKey: (process.env.ANTHROPIC_API_KEY || '').trim() });
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SUMUP_API_KEY = process.env.SUMUP_API_KEY;

// ═══════════════════════════════════════════════════
// HEALTHCHECK
// ═══════════════════════════════════════════════════

app.get('/', (req, res) => res.send('OK SINELEC OS v2.0'));
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
    const { type, client, email, telephone, adresse, complement, codePostal, ville, prenom, description, prestations, partenaire, part_diahe, part_partenaire, nom_partenaire, intervention_type, siret_client } = req.body;
    const compteur = await incrementerCompteur(type);
    const annee = new Date().getFullYear();
    const mois = String(new Date().getMonth() + 1).padStart(2, '0');
    const num = type === 'devis' ? `OS-${annee}${mois}-${String(compteur).padStart(3, '0')}` : `${annee}${mois}-${String(compteur).padStart(3, '0')}`;
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
    if (CONFIG.features.email_auto) {
      const typeLabelUpper = type === 'devis' ? 'DEVIS' : 'FACTURE';
      const dateStr = new Date().toLocaleDateString('fr-FR');
      const dateValide = new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString('fr-FR');
      const detailsPath = path.join(__dirname, `_details_${num}.json`);
      const pyPath = path.join(__dirname, `_devis_${num}.py`);
      const pdfPath = path.join(__dirname, `${num}.pdf`);

      // Construire detailsData avec support sections
      let detailsData = [];
      let sectNum = 0; let itemNum = 0;
      for (const p of prestations) {
        if (p._section) {
          sectNum++; itemNum = 0;
          detailsData.push({ _section: true, titre: `${sectNum}. ${p.titre || 'Section ' + sectNum}` });
        } else {
          if (sectNum > 0) itemNum++;
          const subNum = sectNum > 0 ? `${sectNum}.${itemNum}` : null;
          detailsData.push({ designation: p.nom, qte: p.quantite, prixUnit: p.prix, total: p.prix * p.quantite, details: p.desc ? [p.desc] : [], subNum, isOffert: (p.prix === 0 || p.prix * p.quantite === 0) });
        }
      }
      fs.writeFileSync(detailsPath, JSON.stringify(detailsData));

      const clientEsc = String(client || '').replace(/'/g, ' ');
      const clientComplement = String(complement || '').replace(/'/g, ' ').trim();
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
        .trim()
        .replace(/'/g, ' ')
        .replace(/"/g, ' ')
        .replace(/\\/g, ' ')
        .replace(/\n/g, ' ')
        .replace(/\r/g, ' ')
        .substring(0, 120);

      const clientSiret = String(siret_client || '').trim().replace(/'/g, '').replace(/"/g, '').replace(/\\/g, '');

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
from reportlab.platypus.flowables import HRFlowable
W,H=A4
MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C')
OR_PALE=colors.HexColor('#FBF7EC'); OR_FONCE=colors.HexColor('#A07830')
BLANC=colors.white; CREME=colors.HexColor('#FDFCF9')
GRIS_TEXTE=colors.HexColor('#3A3A3A'); GRIS_SOFT=colors.HexColor('#777777')
GRIS_LIGNE=colors.HexColor('#E0DDD6'); GRIS_BG=colors.HexColor('#F5F4F0')
def p(txt,sz=9,font='Helvetica',color=GRIS_TEXTE,align=TA_LEFT,sb=0,sa=2,leading=None):
    if leading is None: leading=sz*1.35
    return Paragraph(str(txt),ParagraphStyle('s',fontName=font,fontSize=sz,textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa,leading=leading,wordWrap='CJK'))
data=json.loads(open(sys.argv[1],encoding='utf-8').read())
totalHT=sum(l.get('total',0) for l in data if not l.get('_section'))
logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())
class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw):
        pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0; self.saveState(); self._draw_page()
    def showPage(self):
        self._draw_footer(); pdfcanvas.Canvas.showPage(self); self._pg+=1
    def save(self):
        pdfcanvas.Canvas.save(self)
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
        self.drawImage(ImageReader(io.BytesIO(logo_bytes)),0.9*cm,H-5.05*cm,width=4.2*cm,height=4.2*cm,preserveAspectRatio=True,mask='auto')
        self.setFont('Helvetica-Bold',15); self.setFillColor(colors.white); self.drawString(5.9*cm,H-1.7*cm,'SINELEC PARIS')
        self.setFont('Helvetica-Bold',9); self.setFillColor(colors.white); self.drawString(5.9*cm,H-2.5*cm,'128 Rue La Boetie, 75008 Paris')
        self.setFont('Helvetica',8.5); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(5.9*cm,H-3.0*cm,'Tel : 07 87 38 86 22'); self.drawString(5.9*cm,H-3.4*cm,'sinelec.paris@gmail.com')
        self.setFillColor(colors.HexColor('#243660')); self.roundRect(5.9*cm,H-4.15*cm,5.5*cm,0.55*cm,0.1*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',8); self.setFillColor(OR); self.drawString(6.1*cm,H-3.88*cm,'SIRET : 91015824500019')
        self.setFont('Helvetica-Bold',40); self.setFillColor(BLANC); self.drawRightString(W-1.2*cm,H-2.2*cm,'${typeLabelUpper}')
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
        self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI  \\u2022  128 Rue La Boetie, 75008 Paris  \\u2022  SIRET : 91015824500019  \\u2022  TVA non applicable art. 293B CGI')
        self.setFont('Helvetica-Bold',7); self.setFillColor(OR); self.drawRightString(W-1.2*cm,0.28*cm,'${num}')
        self.restoreState()
        self._draw_tampons()
    def _draw_tampons(self):
        IS_PAYE = '${type}' == 'facture' and 'envoye' in ('paye','payee','acquitte')
        IS_SIGNE = '${type}' == 'devis' and 'envoye' in ('signe',)
        rouge = colors.HexColor('#cc0000')
        vert  = colors.H