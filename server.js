// ═══════════════════════════════════════════════════════════════
// SINELEC OS v2.0 - BACKEND COMPLET
// ═══════════════════════════════════════════════════════════════
// Date: 20 Avril 2026
// Description: API complète + Cron jobs + Veille tarifaire
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');


// Charger config
const CONFIG = require('./config-v2.js');

// ═══════════════════════════════════════════════════════════════
// INITIALISATION
// ═══════════════════════════════════════════════════════════════

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// ═══════════════════════════════════════════════════════════════
// AUTHENTIFICATION — SINELEC OS
// ═══════════════════════════════════════════════════════════════

const crypto = require('crypto');

const APP_PASSWORD = process.env.APP_PASSWORD || 'sinelec2026';
const JWT_SECRET   = process.env.JWT_SECRET   || crypto.randomBytes(32).toString('hex');
const TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 jours

// Générer un token simple HMAC
function genererToken() {
  const payload = JSON.stringify({ ts: Date.now(), exp: Date.now() + TOKEN_EXPIRY });
  const b64 = Buffer.from(payload).toString('base64');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

// Vérifier un token
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

// Middleware auth — protège toutes les routes /api/*
function authMiddleware(req, res, next) {
  // Routes publiques — pas d'auth requise
  const publicRoutes = ['/', '/health', '/api/login', '/signer/', '/paiement-confirme/', '/api/signature', '/api/auth/check'];
  if (publicRoutes.some(r => req.path.startsWith(r))) return next();
  
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  if (!verifierToken(token)) {
    return res.status(401).json({ error: 'Non autorisé — Veuillez vous connecter', code: 'UNAUTHORIZED' });
  }
  next();
}

app.use(authMiddleware);

// Route de connexion
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  
  // Comparaison directe avec trim pour éviter les espaces parasites
  const inputPwd = String(password || '').trim();
  const validPwd = String(APP_PASSWORD || 'sinelec2026').trim();
  
  console.log('🔐 Tentative connexion — longueur input:', inputPwd.length, '/ longueur attendu:', validPwd.length);
  
  if (inputPwd !== validPwd) {
    console.log('🔐 Connexion échouée');
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  
  const token = genererToken();
  console.log('🔐 Connexion réussie');
  res.json({ success: true, token, expiresIn: TOKEN_EXPIRY });
});

// Route de vérification token
app.get('/api/auth/check', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  res.json({ valid: verifierToken(token) });
});



// Clients
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
const SUMUP_CLIENT_ID = process.env.SUMUP_CLIENT_ID;
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════
// HEALTHCHECK
// ═══════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.send('✅ SINELEC OS v2.0 API OK'));
app.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  service: 'SINELEC OS v2.0',
  version: CONFIG.meta.version,
  features: Object.entries(CONFIG.features)
    .filter(([k, v]) => v === true)
    .map(([k]) => k)
}));

// ═══════════════════════════════════════════════════════════════
// HELPER: LOGS SYSTÈME
// ═══════════════════════════════════════════════════════════════

async function logSystem(type, message, data = null, success = true, error = null) {
  try {
    await supabase.from('logs_system').insert({
      type,
      message,
      data,
      success,
      error_details: error ? error.toString() : null
    });
    
    if (CONFIG.dev.debug_mode) {
      console.log(`[${type}] ${message}`, data);
    }
  } catch (err) {
    console.error('Erreur log:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER: ENVOI EMAIL BREVO
// ═══════════════════════════════════════════════════════════════

async function envoyerEmail(to, subject, htmlContent, attachment = null) {
  if (CONFIG.dev.skip_email) {
    console.log('📧 [DEV] Email skippé:', to, subject);
    return { skipped: true };
  }

  console.log('📧 Tentative envoi email à:', to);
  console.log('📧 Sujet:', subject);
  
  const payload = {
    sender: { 
      name: CONFIG.email.sender_name, 
      email: CONFIG.email.sender_email 
    },
    to: [{ email: to }],
    subject,
    htmlContent,
    trackOpens: 0,
    trackClicks: 0,
  };

  if (attachment) {
    payload.attachment = [{
      content: attachment.content,
      name: attachment.name,
    }];
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('❌ Erreur Brevo:', err);
      await logSystem('email', `Échec envoi à ${to}`, { error: err }, false, err);
      throw new Error(`Brevo error: ${err}`);
    }

    const result = await res.json();
    console.log('✅ Email envoyé avec succès !', result);
    await logSystem('email', `Email envoyé à ${to}`, { subject, messageId: result.messageId }, true);
    return result;
  } catch (error) {
    console.error('❌ Erreur lors de l\'envoi email:', error);
    await logSystem('email', `Erreur envoi à ${to}`, { error: error.message }, false, error);
    // Alerte monitoring — en background pour ne pas bloquer
    alerterErreurCritique('brevo_email', error.message, `Destinataire: ${to} | Sujet: ${subject}`).catch(() => {});
    mettreAJourStatut('brevo_email', false, error.message).catch(() => {});
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER: ENVOI SMS BREVO
// ═══════════════════════════════════════════════════════════════

async function envoyerSMS(to, message) {
  if (!to || String(to).length < 8) {
    console.log('📱 SMS ignoré — numéro invalide:', to);
    return;
  }

  let num = String(to).replace(/[\s\-\.]/g, '');
  if (num.startsWith('0')) num = '+33' + num.substring(1);
  if (!num.startsWith('+')) num = '+33' + num;

  console.log('📱 Envoi SMS à:', num);

  try {
    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: 'SINELEC',
        recipient: num,
        content: message,
        type: 'transactional',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('❌ Erreur SMS Brevo:', err);
      return;
    }

    const result = await res.json();
    console.log('✅ SMS envoyé !', result.messageId);
    await logSystem('sms', `SMS envoyé à ${num}`, { messageId: result.messageId }, true);
    return result;
  } catch (error) {
    console.error('❌ Erreur SMS:', error.message);
    await logSystem('sms', `Erreur SMS à ${num}`, { error: error.message }, false, error);
    // Alerte monitoring
    alerterErreurCritique('brevo_sms', error.message, `Destinataire: ${num}`).catch(() => {});
    mettreAJourStatut('brevo_sms', false, error.message).catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER: INCRÉMENTER COMPTEUR
// ═══════════════════════════════════════════════════════════════

async function incrementerCompteur(type) {
  const { data, error } = await supabase
    .from('compteurs')
    .select('valeur')
    .eq('type', type)
    .single();

  if (error || !data) {
    await supabase.from('compteurs').insert({ type, valeur: 1 });
    return 1;
  }

  const nouvelle_valeur = data.valeur + 1;
  await supabase
    .from('compteurs')
    .update({ valeur: nouvelle_valeur })
    .eq('type', type);

  return nouvelle_valeur;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: CHARGER GRILLE TARIFAIRE
// ═══════════════════════════════════════════════════════════════

async function chargerGrilleTarifaire() {
  const { data, error } = await supabase
    .from('grille_tarifaire')
    .select('*')
    .eq('actif', true)
    .order('categorie, nom');

  if (error) {
    console.error('Erreur chargement grille:', error);
    return null;
  }

  // Grouper par catégorie
  const grille = {};
  data.forEach(item => {
    if (!grille[item.categorie]) {
      grille[item.categorie] = [];
    }
    grille[item.categorie].push({
      code: item.code,
      nom: item.nom,
      prix: item.prix_ht,
      unite: item.unite
    });
  });

  return grille;
}

// ═══════════════════════════════════════════════════════════════
// API: GÉNÉRATION DEVIS/FACTURE
// ═══════════════════════════════════════════════════════════════

app.post('/api/generer', async (req, res) => {
  if (!CONFIG.features.devis_factures) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { type, client, email, telephone, adresse, complement, codePostal, ville, prenom, siret, tvaNum, description, prestations } = req.body;

    // Nettoyer le nom (supprimer espaces entre lettres si espacé)
    const clientClean = String(client || '').replace(/\s+/g, ' ').trim();
    const prenomClean = String(prenom || '').replace(/\s+/g, ' ').trim();
    const startTime = Date.now();

    const compteur = await incrementerCompteur(type);
    const annee = new Date().getFullYear();
    const mois = String(new Date().getMonth() + 1).padStart(2, '0');
    const num = type === 'devis'
      ? `OS-${annee}${mois}-${String(compteur).padStart(3, '0')}`
      : `${annee}${mois}-${String(compteur).padStart(3, '0')}`;

    const total_ht = prestations.reduce((sum, p) => sum + (p.prix * p.quantite), 0);

    const { error: dbError } = await supabase.from('historique').insert({
      num, type, client, email, telephone, adresse, prestations,
      total_ht,
      statut: 'envoyé',
      date_envoi: new Date().toISOString(),
      source: 'app',
      temps_generation: Math.round((Date.now() - startTime) / 1000)
    });

    if (dbError) throw dbError;

    if (CONFIG.features.email_auto && email) {
      console.log('📧 Préparation email pour:', email);

      const typeLabel = type === 'devis' ? 'Devis' : 'Facture';
      // Facture = EN ATTENTE DE PAIEMENT par défaut, acquittée après paiement confirmé
      const typeLabelUpper = type === 'devis' ? 'DEVIS' : 'FACTURE';
      const mentionPaiement = type === 'facture' ? 'EN ATTENTE DE PAIEMENT' : '';
      const subject = `${typeLabel} SINELEC ${num}`;
      const htmlEmail = type === 'devis' ? CONFIG.email.template_devis : CONFIG.email.template_facture;
      const dateStr = new Date().toLocaleDateString('fr-FR');
      const dateValide = new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString('fr-FR');

      const detailsPath = path.join(__dirname, `_details_${num}.json`);
      const pyPath = path.join(__dirname, `_devis_${num}.py`);
      const pdfPath = path.join(__dirname, `${num}.pdf`);

      // Générer descriptions pro avec Claude
      // Descriptions pré-définies par prestation (transmises depuis app)
      let detailsData = prestations.map(p => ({
        designation: p.nom,
        qte: p.quantite,
        prixUnit: p.prix,
        total: p.prix * p.quantite,
        details: p.desc ? [p.desc] : []
      }));

      // Générer descriptions pro avec Claude
      try {
        const promptDesc = 'Tu es expert électricien SINELEC Paris. Pour chaque prestation ci-dessous, génère UNE description courte (max 12 mots) qui détaille ce qui est inclus et rassure le client. Réponds UNIQUEMENT en JSON valide: [{"nom": "...", "desc": "..."}]\n\nPrestations:\n' + prestations.map(p => p.nom).join('\n');
        const descResp = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 800,
          messages: [{ role: 'user', content: promptDesc }]
        });
        const descText = descResp.content[0].text;
        const jsonMatch = descText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const descs = JSON.parse(jsonMatch[0]);
          detailsData = detailsData.map((d, i) => ({
            ...d,
            details: descs[i]?.desc ? [descs[i].desc] : []
          }));
        }
      } catch(e) {
        console.error('❌ Descriptions auto erreur:', e.message, e.stack?.split('\n')[1]);
      }

      try {
        const promptDesc = `Tu es expert électricien SINELEC Paris. Pour chaque prestation, génère UNE description courte (max 12 mots) qui justifie le prix et rassure le client. Réponds UNIQUEMENT en JSON: [{"nom": "...", "desc": "..."}]

Prestations:
${prestations.map(p => p.nom).join('\n')}`;
        const descResp = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{ role: 'user', content: promptDesc }]
        });
        const descText = descResp.content[0].text;
        const jsonMatch = descText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const descs = JSON.parse(jsonMatch[0]);
          detailsData = detailsData.map((d, i) => ({
            ...d,
            details: descs[i]?.desc ? [descs[i].desc] : []
          }));
        }
      } catch(e) {
        console.error('❌ Descriptions auto erreur:', e.message, e.stack?.split('\n')[1]);
      }

      fs.writeFileSync(detailsPath, JSON.stringify(detailsData));

      const clientEsc = String(client || '').replace(/'/g, ' ');
    // client contient déjà prénom+nom fusionnés par getClientComplet
    const clientNomComplet = clientEsc;
    const clientComplement = String(complement || '').replace(/'/g, ' ').trim();
    const clientTelRaw = String(telephone || '').trim();
    // Formater si pas déjà formaté (ajouter espaces tous les 2 chiffres)
    const clientTel = clientTelRaw;
      const adresseEsc = String(adresse || '').replace(/'/g, ' ');
      // Nettoyer adresse GPS
      const adresseRaw = String(adresse || '').replace(/'/g, ' ').trim();
      const adresseParts = adresseRaw.split(',').map(s => s.trim()).filter(Boolean);
      // Rue = rejoindre numéro + nom si séparés
      const clientRue = adresseParts.length >= 2 && adresseParts[0].match(/^\d+$/)
        ? adresseParts[0] + ' ' + adresseParts[1]
        : adresseParts[0] || '';
      const cpMatch = adresseRaw.match(/\b(\d{5})\b/);
      const cpFromAdresse = cpMatch ? cpMatch[1] : '';
      const clientCP = String(codePostal || '').trim() || cpFromAdresse;
      const villeManuelle = String(ville || '').trim();
      const villeGPS = adresseParts.find(p =>
        p.length > 2 && p.length < 30 &&
        !p.match(/^\d{5}/) &&
        !p.toLowerCase().includes('france') &&
        !p.toLowerCase().includes('ile-de') &&
        !p.toLowerCase().includes('metropolitaine') &&
        !p.toLowerCase().includes('arrondissement') &&
        !p.toLowerCase().includes('quartier')
      ) || '';
      const clientVille = [clientCP, villeManuelle || villeGPS].filter(Boolean).join(' ');
      const clientCPVille = clientVille;

            const descObjet = String(description || 'Travaux d electricite generale').trim().replace(/'/g, ' ');
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

W, H = A4

# Palette bleu marine + or
MARINE       = colors.HexColor('#1B2A4A')
MARINE_LIGHT = colors.HexColor('#243660')
OR           = colors.HexColor('#C9A84C')
OR_PALE      = colors.HexColor('#FBF7EC')
OR_FONCE     = colors.HexColor('#A07830')
BLANC        = colors.white
CREME        = colors.HexColor('#FDFCF9')
GRIS_TEXTE   = colors.HexColor('#3A3A3A')
GRIS_SOFT    = colors.HexColor('#777777')
GRIS_LIGNE   = colors.HexColor('#E0DDD6')
GRIS_BG      = colors.HexColor('#F5F4F0')

def p(txt, sz=9, font='Helvetica', color=GRIS_TEXTE, align=TA_LEFT, sb=0, sa=2, leading=None):
    if leading is None: leading = sz * 1.35
    return Paragraph(str(txt), ParagraphStyle('s', fontName=font, fontSize=sz,
        textColor=color, alignment=align, spaceBefore=sb, spaceAfter=sa,
        leading=leading, wordWrap='CJK'))

data = json.loads(open(sys.argv[1], encoding='utf-8').read())
totalHT = sum(l['total'] for l in data)
logo_bytes = base64.b64decode(open('/app/logo_b64.txt').read().strip())

class SC(pdfcanvas.Canvas):
    def __init__(self, fn, **kw):
        pdfcanvas.Canvas.__init__(self, fn, **kw)
        self._pg = 0
        self.saveState()
        self._draw_page()
    def showPage(self):
        self._draw_footer()
        pdfcanvas.Canvas.showPage(self)
        self._pg += 1
    def save(self):
        pdfcanvas.Canvas.save(self)

    def _draw_page(self):
        self.saveState()
        # Fond crème
        self.setFillColor(CREME)
        self.rect(0, 0, W, H, fill=1, stroke=0)
        # Bande marine gauche épaisse
        self.setFillColor(MARINE)
        self.rect(0, 0, 0.7*cm, H, fill=1, stroke=0)
        # Liseré or sur la bande marine
        self.setFillColor(OR)
        self.rect(0.7*cm, 0, 0.08*cm, H, fill=1, stroke=0)
        if self._pg == 0:
            self._draw_header()
        else:
            self._draw_header_small()
        self.restoreState()

    def _draw_header(self):
        self.setFillColor(MARINE)
        self.rect(0.78*cm, H-5.4*cm, W-0.78*cm, 5.4*cm, fill=1, stroke=0)
        self.setFillColor(OR)
        self.rect(0.78*cm, H-5.4*cm, W-0.78*cm, 0.12*cm, fill=1, stroke=0)
        # Logo plus grand + monte
        logo_img = io.BytesIO(logo_bytes)
        self.drawImage(ImageReader(logo_img), 0.9*cm, H-5.05*cm,
            width=4.2*cm, height=4.2*cm, preserveAspectRatio=True, mask='auto')
        # Separateur vertical or
        self.setStrokeColor(OR)
        self.setLineWidth(0.8)
        self.line(5.5*cm, H-0.9*cm, 5.5*cm, H-5.2*cm)
        # Nom societe
        self.setFont('Helvetica-Bold', 15)
        self.setFillColor(colors.white)
        self.drawString(5.9*cm, H-1.7*cm, 'SINELEC PARIS')
        self.setStrokeColor(OR)
        self.setLineWidth(1.0)
        self.line(5.9*cm, H-1.95*cm, 11.5*cm, H-1.95*cm)
        # Adresse
        self.setFont('Helvetica-Bold', 9)
        self.setFillColor(colors.white)
        self.drawString(5.9*cm, H-2.5*cm, '128 Rue La Boetie, 75008 Paris')
        # Tel + Email
        self.setFont('Helvetica', 8.5)
        self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(5.9*cm, H-3.0*cm, 'Tel : 07 87 38 86 22')
        self.drawString(5.9*cm, H-3.4*cm, 'sinelec.paris@gmail.com')
        # SIRET encadre
        self.setFillColor(colors.HexColor('#243660'))
        self.roundRect(5.9*cm, H-4.15*cm, 5.5*cm, 0.55*cm, 0.1*cm, fill=1, stroke=0)
        self.setFont('Helvetica-Bold', 8)
        self.setFillColor(OR)
        self.drawString(6.1*cm, H-3.88*cm, 'SIRET : 91015824500019')
        self.setFont('Helvetica', 7.5)
        self.setFillColor(colors.HexColor('#8899BB'))
        self.drawString(5.9*cm, H-4.6*cm, 'TVA non applicable art. 293B CGI')
        # TITRE DEVIS / FACTURE
        self.setFont('Helvetica-Bold', 40)
        self.setFillColor(BLANC)
        self.drawRightString(W-1.2*cm, H-2.2*cm, '${typeLabelUpper}')
        self.setStrokeColor(OR)
        self.setLineWidth(1.5)
        self.line(13*cm, H-2.65*cm, W-1.2*cm, H-2.65*cm)
        self.setFillColor(OR)
        self.roundRect(W-6.5*cm, H-3.55*cm, 5.3*cm, 0.65*cm, 0.15*cm, fill=1, stroke=0)
        self.setFont('Helvetica-Bold', 9)
        self.setFillColor(MARINE)
        self.drawCentredString(W-3.85*cm, H-3.22*cm, 'N\\u00b0 ${num}')
        self.setFont('Helvetica', 8)
        self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawRightString(W-1.2*cm, H-3.9*cm, 'Date : ${dateStr}   |   Valable jusqu\\u2019au : ${dateValide}')

    def _draw_header_small(self):
        self.setFillColor(MARINE)
        self.rect(0.78*cm, H-1.5*cm, W-0.78*cm, 1.5*cm, fill=1, stroke=0)
        self.setFillColor(OR)
        self.rect(0.78*cm, H-1.5*cm, W-0.78*cm, 0.08*cm, fill=1, stroke=0)
        self.setFont('Helvetica-Bold', 10)
        self.setFillColor(BLANC)
        self.drawString(1.4*cm, H-1.0*cm, 'SINELEC')
        self.setFont('Helvetica', 8)
        self.setFillColor(OR)
        self.drawRightString(W-1.2*cm, H-1.0*cm, '${typeLabelUpper} N\\u00b0 ${num}')

    def _draw_footer(self):
        self.saveState()
        self.setFillColor(MARINE)
        self.rect(0, 0, W, 1.0*cm, fill=1, stroke=0)
        self.setFillColor(OR)
        self.rect(0, 1.0*cm, W, 0.08*cm, fill=1, stroke=0)
        self.setFont('Helvetica', 6.5)
        self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2, 0.5*cm,
            'SINELEC EI  \\u2022  128 Rue La Boetie, 75008 Paris  \\u2022  SIRET : 91015824500019  \\u2022  TVA non applicable art. 293B CGI  \\u2022  Garantie decennale ORUS')
        self.setFont('Helvetica-Bold', 7)
        self.setFillColor(OR)
        self.drawRightString(W-1.2*cm, 0.28*cm, '${num}')
        self.restoreState()

doc = SimpleDocTemplate(sys.argv[2], pagesize=A4,
    leftMargin=1.2*cm, rightMargin=1.0*cm,
    topMargin=5.6*cm, bottomMargin=1.6*cm)

story = []

# ── OBJET + CLIENT ────────────────────────────────────────
objet_b = Table([
    [p('OBJET DES TRAVAUX', 7.5, 'Helvetica-Bold', OR, sa=4)],
    [p('${descObjet}', 10, 'Helvetica-Bold', MARINE)],
    [p('Conformes NF C 15-100  \u2022  Garantie decennale ORUS', 7.5, color=GRIS_SOFT)],
], colWidths=[8.2*cm])
objet_b.setStyle(TableStyle([
    ('TOPPADDING', (0,0), (-1,-1), 3),
    ('BOTTOMPADDING', (0,0), (-1,-1), 3),
    ('LEFTPADDING', (0,0), (-1,-1), 0),
    ('LINEABOVE', (0,0), (0,0), 2.5, MARINE),
    ('TOPPADDING', (0,0), (0,0), 10),
]))

client_rows = [
    [p('CLIENT', 7, 'Helvetica-Bold', OR, sa=4)],
    [p('${clientNomComplet}', 10, 'Helvetica-Bold', MARINE)],
]
if '${clientRue}': client_rows.append([p('${clientRue}', 8.5, color=GRIS_TEXTE)])
if '${clientComplement}': client_rows.append([p('${clientComplement}', 8.5, color=GRIS_TEXTE)])
if '${clientCPVille}': client_rows.append([p('${clientCPVille}', 8.5, color=GRIS_TEXTE)])
if '${clientTel}': client_rows.append([p('Tel : ${clientTel}', 8.5, color=GRIS_SOFT)])
client_b = Table(client_rows, colWidths=[9.0*cm])
client_b.setStyle(TableStyle([
    ('TOPPADDING', (0,0), (-1,-1), 3),
    ('BOTTOMPADDING', (0,0), (-1,-1), 3),
    ('LEFTPADDING', (0,0), (-1,-1), 14),
    ('RIGHTPADDING', (0,0), (-1,-1), 14),
    ('BACKGROUND', (0,0), (-1,-1), OR_PALE),
    ('BOX', (0,0), (-1,-1), 1, OR),
    ('LINEBEFORE', (0,0), (0,-1), 4, MARINE),
    ('TOPPADDING', (0,0), (0,0), 10),
    ('BOTTOMPADDING', (0,-1), (-1,-1), 10),
]))

story.append(Table([[objet_b, client_b]], colWidths=[8.7*cm, 9.5*cm],
    style=TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 0),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
    ])))
story.append(Spacer(1, 0.6*cm))

# ── TABLEAU ───────────────────────────────────────────────
cw = [0.7*cm, 9.5*cm, 1.5*cm, 0.9*cm, 2.4*cm, 3.2*cm]
rows = [[
    p('#', 7.5, 'Helvetica-Bold', BLANC, TA_CENTER),
    p('DESIGNATION / DETAIL', 7.5, 'Helvetica-Bold', BLANC),
    p('QTE', 7.5, 'Helvetica-Bold', BLANC, TA_CENTER),
    p('U.', 7.5, 'Helvetica-Bold', BLANC, TA_CENTER),
    p('PRIX U. HT', 7.5, 'Helvetica-Bold', BLANC, TA_RIGHT),
    p('TOTAL HT', 7.5, 'Helvetica-Bold', BLANC, TA_RIGHT),
]]
for i, l in enumerate(data):
    q = int(l['qte']) if l['qte'] == int(l['qte']) else l['qte']
    rows.append([
        p(str(i+1), 9, color=OR, align=TA_CENTER),
        p('<b>' + l['designation'] + '</b>', 9, color=MARINE),
        p(str(q), 9, align=TA_CENTER),
        p('u.', 9, align=TA_CENTER, color=GRIS_SOFT),
        p('%.2f \\u20ac' % l['prixUnit'], 9, align=TA_RIGHT),
        p('<b>%.2f \\u20ac</b>' % l['total'], 9, 'Helvetica-Bold', MARINE, TA_RIGHT),
    ])
    for det in l.get('details', []):
        rows.append(['', p('   - ' + det, 7.5, 'Helvetica-Oblique', color=GRIS_SOFT), '', '', '', ''])

t = Table(rows, colWidths=cw)
ts = [
    ('BACKGROUND', (0,0), (-1,0), MARINE),
    ('LINEBELOW', (0,0), (-1,0), 2.5, OR),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('TOPPADDING', (0,0), (-1,-1), 6),
    ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ('LEFTPADDING', (0,0), (-1,-1), 7),
    ('RIGHTPADDING', (0,0), (-1,-1), 7),
    ('BOX', (0,0), (-1,-1), 0.3, GRIS_LIGNE),
]
row_idx = 1; bg = True
for l in data:
    nb = 1 + len(l.get('details', []))
    c = BLANC if bg else GRIS_BG
    ts.append(('BACKGROUND', (0, row_idx), (-1, row_idx+nb-1), c))
    ts.append(('LINEBELOW', (0, row_idx+nb-1), (-1, row_idx+nb-1), 0.3, GRIS_LIGNE))
    row_idx += nb; bg = not bg
t.setStyle(TableStyle(ts))
story.append(t)
story.append(Spacer(1, 0.15*cm))

# ── TOTAUX ────────────────────────────────────────────────
tt = Table([
    ['', p('Total HT', 9, color=GRIS_SOFT, align=TA_RIGHT),
     p('%.2f \\u20ac' % totalHT, 9, 'Helvetica-Bold', GRIS_TEXTE, TA_RIGHT)],
    ['', p('TVA', 9, color=GRIS_SOFT, align=TA_RIGHT),
     p('Non applicable (art. 293B)', 8, color=GRIS_SOFT, align=TA_RIGHT)],
], colWidths=[9.0*cm, 4.5*cm, 4.7*cm])
tt.setStyle(TableStyle([
    ('LINEABOVE', (1,0), (-1,0), 0.5, GRIS_LIGNE),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('LEFTPADDING', (0,0), (-1,-1), 6),
    ('RIGHTPADDING', (0,0), (-1,-1), 6),
]))
story.append(tt)
story.append(Spacer(1, 0.12*cm))

# ── NET A PAYER ───────────────────────────────────────────
net = Table([[
    p('NET \\u00c0 PAYER', 13, 'Helvetica-Bold', BLANC),
    p('%.2f \\u20ac' % totalHT, 16, 'Helvetica-Bold', OR, TA_RIGHT),
]], colWidths=[9.0*cm, 9.2*cm])
net.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), MARINE),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
    ('LEFTPADDING', (0,0), (-1,-1), 14),
    ('RIGHTPADDING', (0,0), (-1,-1), 14),
    ('LINEBELOW', (0,0), (-1,-1), 3, OR),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
]))
story.append(net)
story.append(Spacer(1, 0.35*cm))

# ── CONDITIONS ────────────────────────────────────────────
story.append(HRFlowable(width='100%', thickness=0.3, color=GRIS_LIGNE, spaceAfter=8))
story.append(p('CONDITIONS', 8, 'Helvetica-Bold', MARINE, sa=6))
cond = Table([
    [p('Acompte 40% a la signature', 9, color=GRIS_TEXTE),
     p('%.2f \\u20ac' % (totalHT*0.4), 9, 'Helvetica-Bold', OR_FONCE, TA_RIGHT)],
    [p('Solde a la fin des travaux', 9, color=GRIS_TEXTE),
     p('%.2f \\u20ac' % (totalHT*0.6), 9, align=TA_RIGHT)],
    [p('Validite 30 jours  \\u2022  Virement bancaire, especes, carte bancaire', 8, color=GRIS_SOFT), ''],
], colWidths=[14.2*cm, 4.0*cm])
cond.setStyle(TableStyle([
    ('LINEBELOW', (0,0), (-1,1), 0.3, GRIS_LIGNE),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('LEFTPADDING', (0,0), (-1,-1), 0),
    ('RIGHTPADDING', (0,0), (-1,-1), 0),
    ('SPAN', (0,2), (1,2)),
]))
story.append(cond)
story.append(Spacer(1, 0.15*cm))

# ── IBAN ──────────────────────────────────────────────────
iban = Table([[
    p('IBAN', 7, 'Helvetica-Bold', GRIS_SOFT),
    p('FR76 1695 8000 0174 2540 5920 931', 9, 'Helvetica-Bold', MARINE),
    p('BIC', 7, 'Helvetica-Bold', GRIS_SOFT, TA_RIGHT),
    p('QNTOFRP1XXX', 9, 'Helvetica-Bold', MARINE, TA_RIGHT),
]], colWidths=[1.5*cm, 9.5*cm, 1.8*cm, 5.4*cm])
iban.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), OR_PALE),
    ('BOX', (0,0), (-1,-1), 0.5, OR),
    ('LINEBEFORE', (0,0), (0,-1), 4, MARINE),
    ('TOPPADDING', (0,0), (-1,-1), 9),
    ('BOTTOMPADDING', (0,0), (-1,-1), 9),
    ('LEFTPADDING', (0,0), (-1,-1), 10),
    ('RIGHTPADDING', (0,0), (-1,-1), 10),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
]))
story.append(iban)

doc.build(story, canvasmaker=lambda fn, **kw: SC(fn, **kw))
print('PDF_OK')
`;

      fs.writeFileSync(pyPath, py, 'utf8');

      try {
        execSync(`python3 ${pyPath} ${detailsPath} ${pdfPath}`, { cwd: __dirname, stdio: 'inherit' });
      } catch(pyErr) {
        console.error('❌ Python error:', pyErr.message);
        alerterErreurCritique('pdf_python', pyErr.message, `Devis: ${num}`).catch(() => {});
        mettreAJourStatut('pdf_python', false, pyErr.message).catch(() => {});
        throw new Error('PDF generation failed');
      }

      const pdfBuffer = fs.readFileSync(pdfPath);
      const pdfB64 = pdfBuffer.toString('base64');
      console.log('📄 PDF size:', pdfB64.length, 'chars');

      // Construire email avec lien signature
      const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
      const lienSig = `${appUrl}/signer/${num}`;
      const htmlFinal = (type === 'devis' ? CONFIG.email.template_devis : CONFIG.email.template_facture)
        .replace(/\{num\}/g, num)
        .replace(/\{lien_signature\}/g, lienSig);

      await envoyerEmail(
        email, subject,
        htmlFinal,
        { content: pdfB64, name: `${num}.pdf` }
      );

      try { fs.unlinkSync(pyPath); } catch(e) {}
      try { fs.unlinkSync(detailsPath); } catch(e) {}
      try { fs.unlinkSync(pdfPath); } catch(e) {}
    }

    await logSystem('generer', `${type} ${num} créé`, { client, total_ht }, true);

    // ── SMS avis Google immédiat à la génération FACTURE ──
    if (type === 'facture' && telephone) {
      try {
        const prenomSms = String(prenom || client || 'client').split(' ')[0].trim();
        const smsAvis = `Bonjour ${prenomSms}, merci pour votre confiance ! Si vous etes satisfait, un avis Google nous aiderait beaucoup : https://g.page/r/CSw-MABnFUAYEAE/review - SINELEC Paris`;
        await envoyerSMS(telephone, smsAvis);
        console.log('📱 SMS avis Google envoyé à:', telephone);
      } catch(smsErr) {
        console.error('⚠️ Erreur SMS avis:', smsErr.message);
      }
    }

    res.json({ success: true, num, total_ht });

  } catch (error) {
    console.error('Erreur génération:', error);
    await logSystem('generer', 'Erreur génération', { error: error.message }, false, error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: CHATBOT CLAUDE (parsing chantier)
// ═══════════════════════════════════════════════════════════════

app.post('/api/chat', async (req, res) => {
  if (!CONFIG.features.chatbot_claude) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { message } = req.body;

    const grille = await chargerGrilleTarifaire();
    if (!grille) throw new Error('Impossible de charger la grille tarifaire');

    // Résumé compact de la grille
    const grilleResume = Object.entries(grille).map(([cat, items]) =>
      `${cat}: ${items.map(i => `${i.nom} (${i.prix}€)`).join(', ')}`
    ).join('\n');

    const prompt = `Tu es l'assistant IA de SINELEC Paris, electricien expert IDF.
Diahe (le patron) te decrit un chantier. Tu dois :
1. Identifier les prestations dans la grille tarifaire
2. Pour les prestations HORS GRILLE utiliser web_search pour trouver le prix marche IDF
3. Retourner un devis complet en JSON

GRILLE TARIFAIRE SINELEC:
${grilleResume}

REGLES:
- Forfait tout compris (MO + fourniture + fixations)
- Prix coherents avec le marche Paris IDF
- Si prestation hors grille chercher sur internet le prix moyen IDF
- TVA non applicable art. 293B

CHANTIER: "${message}"

REPONDS UNIQUEMENT EN JSON:
{
  "prestations": [
    { "nom": "Nom prestation", "quantite": 1, "prix": 90, "desc": "Description courte forfait tout compris" }
  ],
  "total": 0,
  "explication": "Analyse du chantier...",
  "hors_grille": []
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    });

    // Extraire le texte final après les tool_use blocks
    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let result;
    if (jsonMatch) {
      try {
        result = JSON.parse(jsonMatch[0]);
        if (!result.total && result.prestations) {
          result.total = result.prestations.reduce((s, p) => s + (p.prix * p.quantite), 0);
        }
      } catch(e) {
        result = { prestations: [], explication: text, total: 0 };
      }
    } else {
      result = { prestations: [], explication: text, total: 0 };
    }

    await logSystem('chatbot', 'Parsing chantier reussi', { message, nb: result.prestations?.length }, true);
    res.json(result);

  } catch (error) {
    console.error('Erreur chatbot:', error);
    await logSystem('chatbot', 'Erreur parsing', { error: error.message }, false, error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: SIGNATURE CLIENT
// ═══════════════════════════════════════════════════════════════

// ── PAGE SIGNATURE PUBLIQUE (iOS Safari compatible) ──────────
app.get('/signer/:num', async (req, res) => {
  const { num } = req.params;

  // Récupérer le devis
  const { data: devis, error } = await supabase
    .from('historique')
    .select('*')
    .eq('num', num)
    .single();

  if (error || !devis) {
    return res.status(404).send(`<!DOCTYPE html><html><body style="font-family:Arial;text-align:center;padding:40px;">
      <h2>❌ Document introuvable</h2><p>Le devis ${num} n'existe pas ou a expiré.</p></body></html>`);
  }

  if (devis.statut === 'signe' || devis.statut === 'signé') {
    return res.send(`<!DOCTYPE html><html><body style="font-family:Arial;text-align:center;padding:40px;background:#f0fdf4;">
      <div style="max-width:500px;margin:0 auto;background:white;border-radius:20px;padding:40px;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
      <div style="font-size:64px;">✅</div>
      <h2 style="color:#1B2A4A;">Devis déjà signé</h2>
      <p style="color:#555;">Ce devis a déjà été signé. Merci pour votre confiance.</p>
      <p style="color:#C9A84C;font-weight:700;">SINELEC Paris — 07 87 38 86 22</p>
      </div></body></html>`);
  }

  const montant = parseFloat(devis.total_ht || 0).toFixed(2);
  const prestationsHtml = (devis.prestations || []).map((p, i) =>
    `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:10px 8px;color:#1B2A4A;font-weight:600;">${p.nom || p.designation || ''}</td>
      <td style="padding:10px 8px;text-align:center;color:#555;">${p.quantite || p.qte || 1}</td>
      <td style="padding:10px 8px;text-align:right;color:#C9A84C;font-weight:700;">${parseFloat(p.prix || p.prixUnit || 0).toFixed(2)} €</td>
    </tr>`
  ).join('');

  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Signer le devis ${num} — SINELEC</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f5f7fa;color:#1a1a2e;min-height:100vh;}
  .container{max-width:600px;margin:0 auto;padding:16px;}
  .header{background:linear-gradient(135deg,#1B2A4A,#243660);border-radius:20px;padding:24px;text-align:center;margin-bottom:16px;}
  .header h1{color:white;font-size:22px;font-weight:900;}
  .header p{color:rgba(255,255,255,0.7);font-size:13px;margin-top:6px;}
  .card{background:white;border-radius:16px;padding:20px;margin-bottom:14px;box-shadow:0 2px 16px rgba(0,0,0,0.06);}
  .label{font-size:11px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;}
  table{width:100%;border-collapse:collapse;}
  th{background:#f8f9fa;padding:10px 8px;font-size:12px;color:#888;text-align:left;font-weight:600;}
  th:last-child,td:last-child{text-align:right;}
  th:nth-child(2),td:nth-child(2){text-align:center;}
  .total{background:#1B2A4A;border-radius:12px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;margin-top:12px;}
  .total span:first-child{color:white;font-size:14px;font-weight:700;}
  .total span:last-child{color:#C9A84C;font-size:22px;font-weight:900;}
  .cgv-item{display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid #f0f0f0;cursor:pointer;}
  .cgv-item:last-child{border-bottom:none;}
  .cgv-check{width:24px;height:24px;min-width:24px;border:2px solid #ddd;border-radius:6px;display:flex;align-items:center;justify-content:center;transition:all 0.2s;}
  .cgv-check.checked{background:#1B2A4A;border-color:#1B2A4A;}
  .cgv-check.checked::after{content:'✓';color:white;font-size:14px;font-weight:700;}
  .cgv-text{font-size:13px;color:#555;line-height:1.5;}
  .canvas-wrap{border:2px dashed #ddd;border-radius:12px;background:#fafafa;position:relative;overflow:hidden;cursor:crosshair;-webkit-user-select:none;user-select:none;}
  canvas{display:block;width:100%;touch-action:none;-webkit-user-select:none;}
  .canvas-placeholder{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#ccc;font-size:13px;pointer-events:none;text-align:center;}
  .btn-clear{background:none;border:1px solid #ddd;border-radius:8px;padding:8px 16px;font-size:12px;color:#888;cursor:pointer;margin-top:8px;}
  .btn-sign{width:100%;background:linear-gradient(135deg,#1B2A4A,#243660);color:white;border:none;border-radius:16px;padding:18px;font-size:16px;font-weight:800;cursor:pointer;transition:opacity 0.2s;margin-top:8px;}
  .btn-sign:disabled{opacity:0.4;cursor:not-allowed;}
  .btn-sign:not(:disabled):active{opacity:0.8;}
  .success{display:none;text-align:center;padding:40px 20px;}
  .success .icon{font-size:72px;margin-bottom:16px;}
  .success h2{color:#1B2A4A;font-size:22px;font-weight:900;margin-bottom:8px;}
  .success p{color:#555;font-size:14px;line-height:1.6;}
</style>
</head>
<body>
<div class="container">

  <div class="header">
    <h1>⚡ SINELEC Paris</h1>
    <p>Signature électronique — Devis N° ${num}</p>
  </div>

  <div id="main-content">

    <div class="card">
      <div class="label">📋 Récapitulatif</div>
      <p style="font-size:15px;font-weight:700;color:#1B2A4A;margin-bottom:4px;">${devis.client || ''}</p>
      <p style="font-size:12px;color:#888;margin-bottom:16px;">${devis.adresse || ''}</p>
      <table>
        <thead><tr>
          <th>Prestation</th>
          <th>Qté</th>
          <th>Prix HT</th>
        </tr></thead>
        <tbody>${prestationsHtml}</tbody>
      </table>
      <div class="total">
        <span>NET À PAYER</span>
        <span>${montant} €</span>
      </div>
    </div>

    <div class="card">
      <div class="label">✅ En signant, vous acceptez</div>
      <div style="padding:12px 0;">
        <div class="cgv-item" style="cursor:default;pointer-events:none;">
          <div class="cgv-check checked" id="cgv-0" style="background:#1B2A4A;border-color:#1B2A4A;"></div>
          <div class="cgv-text"><strong>Conditions Générales de Vente</strong> de SINELEC Paris, incluant les modalités de paiement et d'intervention.</div>
        </div>
        <div class="cgv-item" style="cursor:default;pointer-events:none;">
          <div class="cgv-check checked" id="cgv-1" style="background:#1B2A4A;border-color:#1B2A4A;"></div>
          <div class="cgv-text"><strong>Montant reconnu : <span style="color:#C9A84C;">${montant} €</span></strong> HT (TVA non applicable, Art. 293B du CGI).</div>
        </div>
        <div class="cgv-item" style="cursor:default;pointer-events:none;">
          <div class="cgv-check checked" id="cgv-2" style="background:#1B2A4A;border-color:#1B2A4A;"></div>
          <div class="cgv-text"><strong>Bon pour accord</strong> — Acompte de <strong style="color:#C9A84C;">${(parseFloat(montant)*0.4).toFixed(2)} €</strong> à la signature.</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="label">✍️ Votre signature</div>
      <div class="canvas-wrap" id="canvas-wrap">
        <canvas id="sig-canvas" height="180"></canvas>
        <div class="canvas-placeholder" id="canvas-placeholder">Signez ici avec votre doigt</div>
      </div>
      <button class="btn-clear" onclick="clearCanvas()">🗑️ Effacer</button>
    </div>

    <button class="btn-sign" id="btn-sign" disabled onclick="soumettre()">
      ✍️ Signer et valider le devis
    </button>

    <p style="font-size:11px;color:#aaa;text-align:center;margin-top:12px;padding-bottom:24px;">
      Signature électronique légalement valide — IP et horodatage enregistrés
    </p>

  </div>

  <div class="success" id="success-block">
    <div class="icon">✅</div>
    <h2>Devis signé !</h2>
    <p>Merci <strong>${devis.client || ''}</strong>, votre bon pour accord a bien été enregistré.<br>Vous allez recevoir une confirmation par email.<br><br>
    <span style="color:#C9A84C;font-weight:700;">SINELEC Paris — 07 87 38 86 22</span></p>
  </div>

</div>
<script>
  const cgvState = [true, true, true]; // Pré-cochées — acceptées à la signature
  let hasDrawn = false;
  let isDrawing = false;
  let canvas, ctx;

  // Init canvas — délai pour iOS Safari
  function initCanvas() {
    canvas = document.getElementById('sig-canvas');
    const wrap = document.getElementById('canvas-wrap');
    
    // Adapter la taille réelle du canvas au container
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    const w = rect.width || wrap.offsetWidth || 320;
    canvas.width = w * dpr;
    canvas.height = 180 * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = '180px';

    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#1B2A4A';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Événements souris
    canvas.addEventListener('mousedown', e => { e.preventDefault(); startDraw(e.offsetX, e.offsetY); });
    canvas.addEventListener('mousemove', e => { e.preventDefault(); if(isDrawing) draw(e.offsetX, e.offsetY); });
    canvas.addEventListener('mouseup', e => { e.preventDefault(); stopDraw(); });
    canvas.addEventListener('mouseleave', stopDraw);

    // Événements tactiles iOS — passive:false obligatoire
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      e.stopPropagation();
      const t = e.touches[0];
      const r = canvas.getBoundingClientRect();
      const dpr2 = window.devicePixelRatio || 1;
      startDraw((t.clientX - r.left), (t.clientY - r.top));
    }, { passive: false });

    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      e.stopPropagation();
      if (!isDrawing) return;
      const t = e.touches[0];
      const r = canvas.getBoundingClientRect();
      draw((t.clientX - r.left), (t.clientY - r.top));
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
      e.preventDefault();
      stopDraw();
    }, { passive: false });
  }

  function startDraw(x, y) {
    isDrawing = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
    document.getElementById('canvas-placeholder').style.display = 'none';
  }

  function draw(x, y) {
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    hasDrawn = true;
    checkBtn();
  }

  function stopDraw() { isDrawing = false; }

  function clearCanvas() {
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    hasDrawn = false;
    document.getElementById('canvas-placeholder').style.display = 'block';
    checkBtn();
  }

  function toggleCGV(i) {
    cgvState[i] = !cgvState[i];
    const el = document.getElementById('cgv-'+i);
    if (cgvState[i]) el.classList.add('checked');
    else el.classList.remove('checked');
    checkBtn();
  }

  function checkBtn() {
    document.getElementById('btn-sign').disabled = !hasDrawn;
  }

  async function soumettre() {
    const btn = document.getElementById('btn-sign');
    btn.disabled = true;
    btn.textContent = '⏳ Envoi en cours...';

    const sigData = canvas.toDataURL('image/png');

    try {
      const res = await fetch('/api/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          num: '${num}',
          signature: sigData,
          cgv_acceptees: true
        })
      });

      const data = await res.json();

      if (data.success) {
        document.getElementById('main-content').style.display = 'none';
        document.getElementById('success-block').style.display = 'block';
      } else {
        btn.disabled = false;
        btn.textContent = '✍️ Signer et valider le devis';
        alert('Erreur : ' + (data.error || 'Veuillez réessayer'));
      }
    } catch(e) {
      btn.disabled = false;
      btn.textContent = '✍️ Signer et valider le devis';
      alert('Erreur réseau. Vérifiez votre connexion et réessayez.');
    }
  }

  // Attendre que le DOM soit prêt + délai pour iOS
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initCanvas, 300));
  } else {
    setTimeout(initCanvas, 300);
  }
</script>
</body>
</html>`);
});

// ── API SIGNATURE — PDF signé légalement ─────────────────
app.post('/api/signature', async (req, res) => {
  if (!CONFIG.features.signature_client) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { num, signature, cgv_acceptees } = req.body;
    const now = new Date();
    const dateSignature = now.toLocaleDateString('fr-FR');
    const heureSignature = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const ipClient = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'N/A';

    // ── 1. Récupérer les infos du devis ───────────────────
    const { data: devisData } = await supabase
      .from('historique')
      .select('*')
      .eq('num', num)
      .single();

    if (!devisData) {
      return res.status(404).json({ error: 'Devis introuvable' });
    }

    const montant = parseFloat(devisData.total_ht || devisData.totalht || 0);
    const acompte = (montant * 0.4).toFixed(2);

    // ── 2. Sauvegarder dans Supabase ──────────────────────
    await supabase.from('signatures').insert({
      num, signature, cgv_acceptees: cgv_acceptees || false,
      date_signature: now.toISOString(), ip_client: ipClient
    });

    await supabase.from('historique').update({
      signature, statut: 'signe',
      date_signature: now.toISOString(),
      cgv_acceptees: cgv_acceptees || false
    }).eq('num', num);

    // ── 3. Générer le PDF signé avec ReportLab ────────────
    let pdfB64 = null;
    try {
      const prestations = devisData.prestations || [];
      const detailsData = prestations.map(p => ({
        designation: p.nom || p.designation || '',
        qte: p.quantite || p.qte || 1,
        prixUnit: parseFloat(p.prix || p.prixUnit || 0),
        total: parseFloat(p.prix || p.prixUnit || 0) * (p.quantite || p.qte || 1),
        details: p.desc ? [p.desc] : (p.details || [])
      }));

      // Sauvegarder la signature image en PNG temporaire
      const sigBase64 = signature.replace(/^data:image\/png;base64,/, '');
      const sigPath = path.join(__dirname, `_sig_${num}.png`);
      fs.writeFileSync(sigPath, Buffer.from(sigBase64, 'base64'));

      const detailsPath = path.join(__dirname, `_sig_details_${num}.json`);
      fs.writeFileSync(detailsPath, JSON.stringify(detailsData));

      const pdfPath = path.join(__dirname, `_sig_${num}.pdf`);
      const pyPath = path.join(__dirname, `_sig_${num}.py`);

      const clientEsc = String(devisData.client || '').replace(/'/g, ' ');
      const adresseEsc = String(devisData.adresse || '').replace(/'/g, ' ');

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

W, H = A4
MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C')
OR_PALE=colors.HexColor('#FBF7EC'); OR_FONCE=colors.HexColor('#A07830')
BLANC=colors.white; CREME=colors.HexColor('#FDFCF9')
GRIS_TEXTE=colors.HexColor('#3A3A3A'); GRIS_SOFT=colors.HexColor('#777777')
GRIS_LIGNE=colors.HexColor('#E0DDD6'); GRIS_BG=colors.HexColor('#F5F4F0')
VERT=colors.HexColor('#16a34a'); VERT_PALE=colors.HexColor('#f0fdf4')

def p(txt,sz=9,font='Helvetica',color=GRIS_TEXTE,align=TA_LEFT,sb=0,sa=2,leading=None):
    if leading is None: leading=sz*1.35
    return Paragraph(str(txt),ParagraphStyle('s',fontName=font,fontSize=sz,
        textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa,leading=leading,wordWrap='CJK'))

data=json.loads(open(sys.argv[1],encoding='utf-8').read())
totalHT=sum(l['total'] for l in data)
logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())

class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw):
        pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0
        self.saveState(); self._draw_page()
    def showPage(self):
        self._draw_footer(); pdfcanvas.Canvas.showPage(self)
        self._pg+=1; self.saveState(); self._draw_page()
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
        self.setFillColor(MARINE); self.rect(0.78*cm,H-5.2*cm,W-0.78*cm,5.2*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-5.2*cm,W-0.78*cm,0.1*cm,fill=1,stroke=0)
        logo_img=io.BytesIO(logo_bytes)
        self.drawImage(ImageReader(logo_img),1.3*cm,H-4.6*cm,width=3.0*cm,height=3.0*cm,preserveAspectRatio=True,mask='auto')
        self.setFont('Helvetica-Bold',9); self.setFillColor(BLANC)
        self.drawString(1.0*cm,H-4.5*cm,'128 Rue La Boetie, 75008 Paris')
        self.setFont('Helvetica',8.5); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(1.0*cm,H-4.75*cm,'Tel : 07 87 38 86 22  |  sinelec.paris@gmail.com')
        self.drawString(1.0*cm,H-5.0*cm,'SIRET : 91015824500019')
        self.setFont('Helvetica-Bold',44); self.setFillColor(BLANC)
        self.drawRightString(W-1.2*cm,H-2.2*cm,'DEVIS SIGNE')
        self.setStrokeColor(OR); self.setLineWidth(1.5)
        self.line(10*cm,H-2.65*cm,W-1.2*cm,H-2.65*cm)
        self.setFillColor(OR); self.roundRect(W-6.5*cm,H-3.55*cm,5.3*cm,0.65*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(MARINE)
        self.drawCentredString(W-3.85*cm,H-3.22*cm,'N\u00b0 ${num}')
        self.setFont('Helvetica',8); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawRightString(W-1.2*cm,H-3.9*cm,'Signe le : ${dateSignature} a ${heureSignature}')
    def _draw_header_small(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,1.5*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',10); self.setFillColor(BLANC)
        self.drawString(1.4*cm,H-1.0*cm,'SINELEC')
        self.setFont('Helvetica',8); self.setFillColor(OR)
        self.drawRightString(W-1.2*cm,H-1.0*cm,'DEVIS SIGNE N\u00b0 ${num}')
    def _draw_footer(self):
        self.saveState()
        self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI  \u2022  128 Rue La Boetie, 75008 Paris  \u2022  SIRET : 91015824500019  \u2022  TVA non applicable art. 293B CGI  \u2022  Garantie decennale ORUS')
        self.setFont('Helvetica-Bold',7); self.setFillColor(OR)
        self.drawRightString(W-1.2*cm,0.28*cm,'${num} — SIGNE')
        self.restoreState()

doc=SimpleDocTemplate(sys.argv[2],pagesize=A4,leftMargin=1.2*cm,rightMargin=1.0*cm,topMargin=5.6*cm,bottomMargin=1.6*cm)
story=[]

# ── OBJET + CLIENT ─────────────────────────────────────────
objet_b=Table([[p('OBJET DES TRAVAUX',7.5,'Helvetica-Bold',OR,sa=4)],[p('Travaux electricite',10,'Helvetica-Bold',MARINE)],[p('Conformes NF C 15-100  \u2022  Garantie decennale ORUS',7.5,color=GRIS_SOFT)]],colWidths=[8.2*cm])
objet_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),0),('LINEABOVE',(0,0),(0,0),2.5,MARINE),('TOPPADDING',(0,0),(0,0),10)]))

client_b=Table([[p('CLIENT',7,'Helvetica-Bold',OR,sa=4)],[p('${clientEsc}',10,'Helvetica-Bold',MARINE)],[p('${adresseEsc}',8.5,color=GRIS_TEXTE)]],colWidths=[9.0*cm])
client_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),1,OR),('LINEBEFORE',(0,0),(0,-1),4,MARINE),('TOPPADDING',(0,0),(0,0),10),('BOTTOMPADDING',(0,-1),(-1,-1),10)]))

story.append(Table([[objet_b,client_b]],colWidths=[8.7*cm,9.5*cm],style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])))
story.append(Spacer(1,0.6*cm))

# ── TABLEAU PRESTATIONS ────────────────────────────────────
cw=[0.7*cm,9.5*cm,1.5*cm,0.9*cm,2.4*cm,3.2*cm]
rows=[[p('#',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('DESIGNATION',7.5,'Helvetica-Bold',BLANC),p('QTE',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('U.',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('PRIX U. HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT),p('TOTAL HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT)]]
for i,l in enumerate(data):
    q=int(l['qte']) if l['qte']==int(l['qte']) else l['qte']
    rows.append([p(str(i+1),9,color=OR,align=TA_CENTER),p('<b>'+l['designation']+'</b>',9,color=MARINE),p(str(q),9,align=TA_CENTER),p('u.',9,align=TA_CENTER,color=GRIS_SOFT),p('%.2f \u20ac'%l['prixUnit'],9,align=TA_RIGHT),p('<b>%.2f \u20ac</b>'%l['total'],9,'Helvetica-Bold',MARINE,TA_RIGHT)])
    for det in l.get('details',[]):
        rows.append(['',p('   - '+det,7.5,'Helvetica-Oblique',color=GRIS_SOFT),'','','',''])
t=Table(rows,colWidths=cw)
ts=[('BACKGROUND',(0,0),(-1,0),MARINE),('LINEBELOW',(0,0),(-1,0),2.5,OR),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('BOX',(0,0),(-1,-1),0.3,GRIS_LIGNE)]
row_idx=1; bg=True
for l in data:
    nb=1+len(l.get('details',[]))
    c=BLANC if bg else GRIS_BG
    ts.append(('BACKGROUND',(0,row_idx),(-1,row_idx+nb-1),c))
    ts.append(('LINEBELOW',(0,row_idx+nb-1),(-1,row_idx+nb-1),0.3,GRIS_LIGNE))
    row_idx+=nb; bg=not bg
t.setStyle(TableStyle(ts)); story.append(t); story.append(Spacer(1,0.15*cm))


# ── TOTAUX ─────────────────────────────────────────────────
tt=Table([['',p('Total HT',9,color=GRIS_SOFT,align=TA_RIGHT),p('%.2f \u20ac'%totalHT,9,'Helvetica-Bold',GRIS_TEXTE,TA_RIGHT)],['',p('TVA',9,color=GRIS_SOFT,align=TA_RIGHT),p('Non applicable (art. 293B)',8,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[9.0*cm,4.5*cm,4.7*cm])
tt.setStyle(TableStyle([('LINEABOVE',(1,0),(-1,0),0.5,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6)]))
story.append(tt); story.append(Spacer(1,0.12*cm))

net=Table([[p('NET \u00c0 PAYER',13,'Helvetica-Bold',BLANC),p('%.2f \u20ac'%totalHT,16,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('LINEBELOW',(0,0),(-1,-1),3,OR),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(net); story.append(Spacer(1,0.5*cm))

# ── SECTION SIGNATURE LÉGALE ───────────────────────────────
story.append(HRFlowable(width='100%',thickness=2,color=MARINE,spaceAfter=12))
story.append(p('SIGNATURE ELECTRONIQUE — BON POUR ACCORD',11,'Helvetica-Bold',MARINE,sa=8))

# CGV acceptées
cgv_rows=[
    [p('\u2611',12,color=VERT),p('CGV acceptees — Conditions Generales de Vente SINELEC Paris',9,color=GRIS_TEXTE)],
    [p('\u2611',12,color=VERT),p('Montant reconnu : %.2f \u20ac HT — TVA non applicable art. 293B CGI' % totalHT,9,color=GRIS_TEXTE)],
    [p('\u2611',12,color=VERT),p('Bon pour accord — Acompte de %.2f \u20ac a la signature' % (totalHT*0.4),9,color=GRIS_TEXTE)],
]
cgv_t=Table(cgv_rows,colWidths=[0.7*cm,17.5*cm])
cgv_t.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),0),('BACKGROUND',(0,0),(-1,-1),VERT_PALE),('BOX',(0,0),(-1,-1),1,colors.HexColor('#86efac')),('TOPPADDING',(0,0),(-1,0),10),('BOTTOMPADDING',(0,-1),(-1,-1),10)]))
story.append(cgv_t); story.append(Spacer(1,0.3*cm))

# Infos légales horodatage
horodatage=Table([[
    p('Date',7,'Helvetica-Bold',GRIS_SOFT),
    p('${dateSignature} a ${heureSignature}',9,'Helvetica-Bold',MARINE),
    p('Adresse IP',7,'Helvetica-Bold',GRIS_SOFT,TA_RIGHT),
    p('${ipClient}',9,'Helvetica-Bold',MARINE,TA_RIGHT),
]],colWidths=[1.8*cm,8.2*cm,3.0*cm,5.2*cm])
horodatage.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),0.5,OR),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(horodatage); story.append(Spacer(1,0.3*cm))

# Image signature
import os
sig_path=sys.argv[3]
if os.path.exists(sig_path):
    sig_table=Table([[
        Table([[p('Signature du client',8,'Helvetica-Bold',GRIS_SOFT,sa=8)],[Image(sig_path,width=8*cm,height=2.5*cm)]],colWidths=[9.0*cm],style=TableStyle([('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LEFTPADDING',(0,0),(-1,-1),12),('BACKGROUND',(0,0),(-1,-1),BLANC),('BOX',(0,0),(-1,-1),1,GRIS_LIGNE)])),
        Table([[p('Cachet SINELEC',8,'Helvetica-Bold',GRIS_SOFT,sa=8)],[p('Mr SINERA DIAHE',12,'Helvetica-Bold',MARINE,TA_CENTER)],[p('Gerant SINELEC EI',8,color=GRIS_SOFT,align=TA_CENTER)]],colWidths=[9.0*cm],style=TableStyle([('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LEFTPADDING',(0,0),(-1,-1),12),('BACKGROUND',(0,0),(-1,-1),BLANC),('BOX',(0,0),(-1,-1),1,GRIS_LIGNE),('TOPPADDING',(0,1),(0,1),20),('BOTTOMPADDING',(0,-1),(-1,-1),20)])),
    ]],colWidths=[9.5*cm,9.5*cm])
    sig_table.setStyle(TableStyle([('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0),('INNERGRID',(0,0),(-1,-1),0,BLANC)]))
    story.append(sig_table)

story.append(Spacer(1,0.2*cm))
story.append(p('Document genere automatiquement par SINELEC OS — Signature electronique avec valeur probante (horodatage + IP enregistres)',7,color=GRIS_SOFT))

# ── CONDITIONS GENERALES DE VENTE ─────────────────────────
story.append(PageBreak())
story.append(p('CONDITIONS GENERALES DE VENTE — SINELEC',16,'Helvetica-Bold',MARINE,sa=6))
story.append(p('Version en vigueur au 1er janvier 2026',9,color=GRIS_SOFT,sa=16))
story.append(HRFlowable(width='100%',thickness=2,color=OR,spaceAfter=16))

cgv_articles = [
    ('Art. 1 — Objet et champ d application', 'Les presentes CGV regissent l ensemble des relations contractuelles entre SINELEC, auto-entrepreneur represente par Mr SINERA DIAHE, SIRET 91015824500019, 128 Rue La Boetie 75008 Paris, et tout Client ayant recours a ses services. Elles s appliquent a toutes les prestations d electricite, installation, depannage, mise aux normes et maintenance. Toute commande implique l acceptation pleine des presentes CGV.'),
    ('Art. 2 — Devis, commande et acceptation', 'Tout devis est valable 30 jours. Son acceptation avec mention "Bon pour accord" et signature vaut commande ferme. Toute modification du perimetre fera l objet d un avenant signe avant execution.'),
    ('Art. 3 — Prix, facturation et penalites de retard', 'Prix en euros HT. TVA non applicable (art. 293B CGI). Acompte de 40% exige a la signature pour tout devis superieur a 400 euros. Solde a la fin des travaux. En cas de retard de paiement : penalites au taux de 3x le taux legal + indemnite forfaitaire de 40 euros (decret 2012-1115).'),
    ('Art. 4 — Droit de retractation', 'Tout client particulier (contrat hors etablissement) dispose de 14 jours calendaires pour se retracter (art. L.221-18 Code Consommation). Ce droit ne s applique pas si les travaux ont commence avec l accord expres du Client avant expiration du delai.'),
    ('Art. 5 — Execution des travaux et obligations', 'SINELEC s engage a respecter la norme NF C 15-100. Le Client assure un acces libre, informe des contraintes techniques, degage les zones de travail. Tout imprévu majeur fait l objet d un avenant avant reprise.'),
    ('Art. 6 — Garanties', 'Garantie decennale ORUS (114 Bd Marius Vivier Merle, 69003 Lyon) : 10 ans sur la solidite des ouvrages. Garantie biennale : 2 ans sur les equipements. Garantie de parfait achevement : 1 an. Non applicables en cas de mauvaise utilisation, modification par tiers ou force majeure.'),
    ('Art. 7 — Reception des travaux', 'Reception contradictoire a l achevement. Tout defaut apparent doit etre signale par ecrit sous 48h a sinelec.paris@gmail.com. Passe ce delai, les travaux sont reputes acceptes sans reserve.'),
    ('Art. 8 — Responsabilite et limitation', 'Responsabilite de SINELEC limitee au montant HT de la prestation concernee. SINELEC non responsable des dommages indirects (pertes d exploitation, pertes de revenus, etc.).'),
    ('Art. 9 — Reserve de propriete', 'Les materiaux restent propriete de SINELEC jusqu au paiement integral. En cas de non-paiement, SINELEC peut reprendre les materiaux aux frais du Client.'),
    ('Art. 10 — Signature electronique et valeur juridique', 'Conformement aux art. 1366 et 1367 du Code Civil, la signature electronique a la meme valeur qu une signature manuscrite. Date, heure, adresse IP et metadonnees conservees en serveur securise constituent une preuve opposable.'),
    ('Art. 11 — Protection des donnees (RGPD)', 'Donnees collectees uniquement pour la gestion commerciale et la facturation. Non cedees a des tiers. Droit d acces, rectification, suppression via sinelec.paris@gmail.com. Conservation 5 ans.'),
    ('Art. 12 — Force majeure', 'Aucune partie responsable en cas de force majeure (art. 1218 Code Civil). Notification sous 48h. Si persistance au-dela de 30 jours, resiliation sans indemnite sauf paiement des prestations effectuees.'),
    ('Art. 13 — Sous-traitance', 'SINELEC peut sous-traiter a des professionnels qualifies en restant seul responsable vis-a-vis du Client. Le Client sera informe de tout recours a la sous-traitance.'),
    ('Art. 14 — Mediation et litiges', 'Resolution amiable prioritaire (reponse sous 15 jours ouvrables). En cas d echec : mediation via Medicys, 73 bd de Clichy, 75009 Paris — www.medicys.fr. A defaut : competence exclusive du Tribunal de Commerce de Paris.'),
    ('Art. 15 — Dispositions diverses', 'Clauses independantes. CGV soumises au droit francais. Modifiables a tout moment ; version applicable = celle en vigueur a la date d acceptation du devis.'),
]

for titre, contenu in cgv_articles:
    story.append(p(titre, 9, 'Helvetica-Bold', MARINE, sb=8, sa=3))
    story.append(p(contenu, 8, color=GRIS_TEXTE, sa=2, leading=11))

story.append(Spacer(1,0.4*cm))
story.append(HRFlowable(width='100%',thickness=0.5,color=GRIS_LIGNE,spaceAfter=8))
pied = Table([[
    p('SINELEC EI',8,'Helvetica-Bold',MARINE),
    p('128 Rue La Boetie, 75008 Paris',8,color=GRIS_TEXTE,align=TA_CENTER),
    p('SIRET : 91015824500019',8,color=GRIS_TEXTE,align=TA_RIGHT),
]],colWidths=[6.0*cm,9.0*cm,6.0*cm])
pied.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
story.append(pied)

doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw))
print('PDF_SIGNE_OK')
`;

      fs.writeFileSync(pyPath, py, 'utf8');

      execSync(`python3 ${pyPath} ${detailsPath} ${pdfPath} ${sigPath}`, {
        cwd: __dirname,
        stdio: 'inherit'
      });

      const pdfBuffer = fs.readFileSync(pdfPath);
      pdfB64 = pdfBuffer.toString('base64');
      console.log('📄 PDF signé généré:', pdfB64.length, 'chars');

      // Nettoyage fichiers temp
      [pyPath, detailsPath, pdfPath, sigPath].forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });

    } catch(pdfErr) {
      console.error('⚠️ Erreur génération PDF signé:', pdfErr.message);
      // On continue sans PDF si erreur
    }

    // ── 4. Email de confirmation avec PDF signé ────────────
    const htmlConfirm = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f0f2f5;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#1B2A4A,#243660);border-radius:16px;padding:24px;text-align:center;margin-bottom:16px;">
    <div style="font-size:24px;font-weight:900;color:white;">⚡ SINELEC Paris</div>
    <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px;">Devis signé — Bon pour accord</div>
  </div>
  <div style="background:white;border-radius:16px;padding:28px;margin-bottom:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="font-size:56px;text-align:center;margin-bottom:16px;">✅</div>
    <h2 style="color:#1B2A4A;text-align:center;margin-bottom:20px;">Devis signé avec succès</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:12px 0;color:#888;font-size:13px;">Référence</td>
        <td style="padding:12px 0;font-weight:700;color:#1B2A4A;text-align:right;">${num}</td>
      </tr>
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:12px 0;color:#888;font-size:13px;">Client</td>
        <td style="padding:12px 0;font-weight:700;color:#1B2A4A;text-align:right;">${devisData.client || ''}</td>
      </tr>
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:12px 0;color:#888;font-size:13px;">Date de signature</td>
        <td style="padding:12px 0;font-weight:700;color:#1B2A4A;text-align:right;">${dateSignature} à ${heureSignature}</td>
      </tr>
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:12px 0;color:#888;font-size:13px;">Montant HT</td>
        <td style="padding:12px 0;font-size:18px;font-weight:900;color:#C9A84C;text-align:right;">${montant.toFixed(2)} €</td>
      </tr>
      <tr>
        <td style="padding:12px 0;color:#888;font-size:13px;">Acompte à régler (40%)</td>
        <td style="padding:12px 0;font-weight:700;color:#C9A84C;text-align:right;">${acompte} €</td>
      </tr>
    </table>
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px;margin-top:20px;">
      <div style="color:#16a34a;font-size:13px;font-weight:700;">✅ CGV acceptées — Bon pour accord — Signature enregistrée</div>
      <div style="color:#555;font-size:12px;margin-top:4px;">Le PDF signé est joint à cet email.</div>
    </div>
    <div style="background:#fef9ec;border:1px solid #fcd34d;border-radius:10px;padding:14px;margin-top:12px;">
      <div style="color:#92400e;font-size:13px;font-weight:700;">💰 Virement IBAN : FR76 1695 8000 0174 2540 5920 931</div>
      <div style="color:#92400e;font-size:12px;margin-top:4px;">Référence virement : ${num} — Acompte : ${acompte} €</div>
    </div>
  </div>
  <div style="text-align:center;color:#aaa;font-size:12px;">SINELEC EI — 128 Rue La Boétie, 75008 Paris — 07 87 38 86 22</div>
</div></body></html>`;

    const pdfAttachment = pdfB64 ? { content: pdfB64, name: `Devis-Signe-${num}.pdf` } : null;

    // Email au CLIENT
    if (devisData.email) {
      try {
        await envoyerEmail(
          devisData.email,
          `✅ Votre devis SINELEC ${num} signé — PDF en pièce jointe`,
          htmlConfirm,
          pdfAttachment
        );
        console.log('✅ Email client envoyé avec PDF signé');
      } catch(e) {
        console.error('⚠️ Email client:', e.message);
      }
    }

    // Email à SINELEC avec PDF signé
    try {
      await envoyerEmail(
        'sinelec.paris@gmail.com',
        `🔔 SIGNÉ — ${num} — ${devisData.client || ''} — ${montant.toFixed(0)}€`,
        htmlConfirm,
        pdfAttachment
      );
      console.log('✅ Email SINELEC envoyé avec PDF signé');
    } catch(e) {
      console.error('⚠️ Email SINELEC:', e.message);
    }

    await logSystem('signature', `Devis ${num} signé — PDF envoyé`, { num, ip: ipClient }, true);
    res.json({ success: true });

  } catch (error) {
    console.error('Erreur signature:', error);
    await logSystem('signature', 'Erreur signature', { error: error.message }, false, error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: HISTORIQUE
// ═══════════════════════════════════════════════════════════════

app.get('/api/historique', async (req, res) => {
  if (!CONFIG.features.historique) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { type } = req.query;
    
    let query = supabase.from('historique').select('*').order('created_at', { ascending: false });
    
    if (type && type !== 'tous') {
      query = query.eq('type', type);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('Erreur historique:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: SUPPRIMER DEVIS/FACTURE
// ═══════════════════════════════════════════════════════════════
app.delete('/api/historique/:num', async (req, res) => {
  try {
    const { num } = req.params;
    const { error } = await supabase.from('historique').delete().eq('num', num);
    if (error) throw error;
    await logSystem('delete', `${num} supprimé`, { num }, true);
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur suppression:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── PATCH statut d'un document ──────────────────────────────
app.patch('/api/historique/:num/statut', async (req, res) => {
  try {
    const { num } = req.params;
    const { statut } = req.body;
    await supabase.from('historique').update({ statut }).eq('num', num);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// API: CLIENTS (agrégés)
// ═══════════════════════════════════════════════════════════════

app.get('/api/clients', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .order('ca_total', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Erreur clients:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: RAPPORT INTERVENTION
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// API: ANALYSE DPE → RECOMMANDATIONS ÉLECTRIQUES
// ═══════════════════════════════════════════════════════════════

app.post('/api/dpe', async (req, res) => {
  try {
    const { pdf_text, image_base64, image_type, images_base64, nom_client, adresse_client } = req.body;
    if (!pdf_text && !image_base64 && !(images_base64 && images_base64.length)) {
      return res.status(400).json({ error: 'Fichier manquant (PDF ou photo)' });
    }


    const promptBase = `Tu es un expert électricien certifié parisien avec 20 ans d'expérience. Tu analyses des DPE pour établir des devis électriques PRÉCIS et PROFESSIONNELS.

MISSION : Analyser ce DPE et identifier UNIQUEMENT les travaux électriques nécessaires. Ignore absolument tout ce qui n'est pas électrique : isolation, fenêtres, toiture, chaudière gaz, VMC non électrique, etc.

MÉTHODE D'ANALYSE - Procède étape par étape :

ÉTAPE 1 — LIS ATTENTIVEMENT tout le document pour identifier :
- La surface exacte en m²
- La classe énergie actuelle (A à G) et les étiquettes énergie/GES
- L'année de construction du bâtiment
- Le système de chauffage : est-il électrique ? (convecteurs, radiateurs à inertie, plancher chauffant électrique, pompe à chaleur électrique) ou non électrique (gaz, fioul) ?
- Le système d'eau chaude sanitaire : électrique ? (chauffe-eau électrique, ballon thermodynamique) ou non électrique ?
- La présence ou absence de VMC et son type
- L'état du tableau électrique mentionné ou visible
- La présence de DAAF (détecteur de fumée)
- Tout équipement électrique mentionné (climatisation, volets roulants motorisés, etc.)

ÉTAPE 2 — POUR CHAQUE ÉLÉMENT ÉLECTRIQUE IDENTIFIÉ, évalue :
- L'état actuel (vétuste, conforme, absent, à remplacer)
- La quantité précise si mentionnée (nombre de radiateurs, surface, etc.)
- La priorité réelle pour le confort et la sécurité du client
- L'impact sur la classe énergie après travaux

ÉTAPE 3 — GÉNÈRE LES RECOMMANDATIONS avec les prix SINELEC EXACTS suivants (n'invente AUCUN autre prix) :

CHAUFFAGE ÉLECTRIQUE :
- Remplacement convecteur → radiateur inertie : 450€/unité (inclut dépose ancien + fourniture + pose + raccordement)
- Installation convecteur mural neuf : 200€/unité
- Installation radiateur à inertie neuf : 350€/unité
- Sèche-serviettes électrique : 280€/unité
- Thermostat programmable : 140€/unité
- Thermostat connecté / fil pilote : 180€/unité
- Dépose ancien radiateur : 60€/unité

EAU CHAUDE SANITAIRE :
- Chauffe-eau électrique 100L : 450€ (fourniture + pose + raccordement)
- Chauffe-eau électrique 200L : 580€ (fourniture + pose + raccordement)
- Ballon thermodynamique : 850€ (fourniture + pose + raccordement)
- Ligne dédiée chauffe-eau 20A : 220€

VMC :
- VMC simple flux autoréglable : 450€ (fourniture + pose + mise en service)
- VMC simple flux hygroréglable type A : 600€
- VMC simple flux hygroréglable type B : 700€

TABLEAU ÉLECTRIQUE & CONFORMITÉ :
- Tableau complet 1 rangée (6-13 modules) : 650€
- Tableau complet 2 rangées (14-26 modules) : 1050€
- Mise en conformité NF C15-100 : 65€/m² (circuits, protections, mise à la terre)
- Diagnostic électrique obligatoire : 150€
- Mise à la terre complète : 650€
- Liaison équipotentielle principale : 160€
- Liaison équipotentielle salle de bain : 140€
- DAAF certifié NF : 85€/unité
- Détecteur CO monoxyde : 95€/unité

ÉTAPE 4 — RÉDIGE des descriptions PROFESSIONNELLES et PRÉCISES pour chaque recommandation, comme si tu les expliquais au client en face à face. Sois concret sur les bénéfices.

Réponds UNIQUEMENT en JSON valide, sans texte avant ni après, sans markdown, sans backticks. Respecte exactement ce format :
{
  "logement": {
    "surface": 65,
    "classe": "F",
    "annee_construction": 1975,
    "chauffage_electrique": "4 convecteurs électriques vétustes",
    "eau_chaude_electrique": "chauffe-eau 200L de 2008",
    "vmc": "absente",
    "tableau": "non conforme - tableau années 80",
    "daaf": "absent"
  },
  "resume": "Appartement 65m² classé F construit en 1975. Chauffage électrique par 4 convecteurs vétustes très énergivores. Pas de VMC, risque d'humidité. Chauffe-eau électrique de 2008 à remplacer. Tableau électrique non conforme aux normes actuelles.",
  "recommandations": [
    {
      "id": "chauffage",
      "titre": "Remplacement des convecteurs par radiateurs à inertie",
      "description": "Vos 4 convecteurs électriques actuels datent de la construction et consomment beaucoup trop. Le remplacement par des radiateurs à inertie avec thermostat connecté et fil pilote permettra de réduire votre consommation électrique de chauffage de 25 à 40%, tout en améliorant le confort thermique. Chaque radiateur sera raccordé sur un circuit dédié avec protection différentielle.",
      "priorite": "haute",
      "prestations": [
        { "nom": "Remplacement convecteur vers inertie", "prix": 450, "quantite": 4 },
        { "nom": "Thermostat connecté / fil pilote", "prix": 180, "quantite": 1 }
      ]
    }
  ]
}`;

    let messageContent;
    if (images_base64 && images_base64.length > 1) {
      messageContent = [
        ...images_base64.slice(0, 10).map(img => ({
          type: 'image',
          source: { type: 'base64', media_type: img.type || 'image/jpeg', data: img.base64 }
        })),
        { type: 'text', text: promptBase + `\n\nAnalyse ces ${images_base64.length} photos ensemble pour une analyse complète et précise du DPE et de l'installation électrique.` }
      ];
    } else if (image_base64 || (images_base64 && images_base64[0])) {
      const img = image_base64 ? { base64: image_base64, type: image_type } : images_base64[0];
      messageContent = [
        { type: 'image', source: { type: 'base64', media_type: img.type || 'image/jpeg', data: img.base64 } },
        { type: 'text', text: promptBase }
      ];
    } else {
      messageContent = promptBase + '\n\nVoici le contenu du DPE :\n---\n' + pdf_text.substring(0, 20000) + '\n---\n\nAnalyse ce DPE en 4 étapes et génère le JSON.';
    }


    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: messageContent }]
    });

    const rawText = response.content[0].text.trim();
    const clean = rawText.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    result.recommandations = (result.recommandations || []).map(r => ({
      ...r,
      total: (r.prestations || []).reduce((s, p) => s + p.prix * (p.quantite || 1), 0)
    }));
    result.total_general = result.recommandations.reduce((s, r) => s + r.total, 0);

    res.json({ success: true, ...result });
  } catch(e) {
    console.error('Erreur DPE:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/rapport', async (req, res) => {
  if (!CONFIG.features.rapports_intervention) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { client, adresse, chantier, photo_avant, photo_apres, signature } = req.body;

    // Générer numéro rapport
    const compteur = await incrementerCompteur('rapport');
    const num = `R-${new Date().getFullYear()}-${String(compteur).padStart(3, '0')}`;

    // Claude génère description travaux
    const prompt = `Rédige une description professionnelle des travaux pour ce rapport d'intervention:
Chantier: ${chantier}
Client: ${client}
Adresse: ${adresse}

Décris les travaux réalisés de manière claire et professionnelle (2-3 phrases max).`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    });

    const travaux = response.content[0].text;

    // Sauvegarder
    await supabase.from('rapports').insert({
      num,
      client,
      adresse,
      travaux,
      photo_avant,
      photo_apres,
      signature
    });

    await logSystem('rapport', `Rapport ${num} créé`, { client }, true);

    res.json({ success: true, num, travaux });
  } catch (error) {
    console.error('Erreur rapport:', error);
    await logSystem('rapport', 'Erreur création', { error: error.message }, false, error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: AGENDA
// ═══════════════════════════════════════════════════════════════

app.get('/api/agenda', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('agenda')
      .select('*')
      .order('date_intervention', { ascending: true })
      .order('heure', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/agenda', async (req, res) => {
  try {
    const { prenom, nom, client, telephone, adresse, date_intervention, heure, type_intervention, notes, sms_rappel } = req.body;
    const { data, error } = await supabase.from('agenda').insert({
      prenom, nom,
      client: client || `${prenom} ${nom}`,
      telephone, adresse, date_intervention, heure,
      type_intervention, notes,
      sms_rappel: sms_rappel !== false,
      statut: 'planifié',
      sms_veille_envoye: false,
      sms_matin_envoye: false
    }).select().single();
    if (error) throw error;
    await logSystem('agenda', `Intervention planifiée: ${client} le ${date_intervention}`, { date_intervention, heure }, true);
    res.json({ success: true, id: data.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/agenda/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { prenom, nom, client, telephone, adresse, date_intervention, heure, type_intervention, notes, sms_rappel } = req.body;
    const { error } = await supabase.from('agenda').update({
      prenom, nom,
      client: client || `${prenom} ${nom}`,
      telephone, adresse, date_intervention, heure,
      type_intervention, notes,
      sms_rappel: sms_rappel !== false,
      sms_veille_envoye: false,
      sms_matin_envoye: false
    }).eq('id', id);
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
    const { error } = await supabase.from('agenda').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── CRON: SMS RAPPEL VEILLE à 18h ────────────────────────────
cron.schedule('0 18 * * *', async () => {
  console.log('📱 Cron SMS rappel veille 18h...');
  try {
    const demain = new Date(); demain.setDate(demain.getDate() + 1);
    const demainStr = demain.toISOString().split('T')[0];

    const { data: interventions } = await supabase
      .from('agenda')
      .select('*')
      .eq('date_intervention', demainStr)
      .eq('sms_rappel', true)
      .eq('sms_veille_envoye', false)
      .neq('statut', 'annulé');

    for (const iv of (interventions || [])) {
      if (!iv.telephone) continue;
      const prenom = iv.prenom || (iv.client||'').split(' ')[0];
      const dateLabel = demain.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
      const msg = `Bonjour ${prenom} ! Rappel : votre intervention SINELEC est prévue demain ${dateLabel} à ${iv.heure} au ${iv.adresse}. Pour toute question : 07 87 38 86 22 ⚡`;
      await envoyerSMS(iv.telephone, msg);
      await supabase.from('agenda').update({ sms_veille_envoye: true }).eq('id', iv.id);
      console.log(`✅ SMS veille envoyé à ${iv.client}`);
    }
  } catch(e) { console.error('Erreur SMS veille:', e.message); }
});

// ─── CRON: SMS RAPPEL MATIN à 8h45 ────────────────────────────
cron.schedule('45 8 * * *', async () => {
  console.log('📱 Cron SMS rappel matin 8h45...');
  try {
    const aujourdhui = new Date().toISOString().split('T')[0];

    const { data: interventions } = await supabase
      .from('agenda')
      .select('*')
      .eq('date_intervention', aujourdhui)
      .eq('sms_rappel', true)
      .eq('sms_matin_envoye', false)
      .neq('statut', 'annulé');

    for (const iv of (interventions || [])) {
      if (!iv.telephone) continue;
      const prenom = iv.prenom || (iv.client||'').split(' ')[0];
      const msg = `Bonjour ${prenom} ! 😊 Votre intervention SINELEC est bien confirmée aujourd'hui à ${iv.heure}. Nous serons là à l'heure ! En cas de besoin : 07 87 38 86 22 — Bonne journée ⚡`;
      await envoyerSMS(iv.telephone, msg);
      await supabase.from('agenda').update({ sms_matin_envoye: true }).eq('id', iv.id);
      console.log(`✅ SMS matin envoyé à ${iv.client}`);
    }
  } catch(e) { console.error('Erreur SMS matin:', e.message); }
});

// ─── CRON: RÉCAP MATIN DIAHE à 7h00 ──────────────────────────
cron.schedule('0 7 * * *', async () => {
  console.log('☀️ Cron récap matin 7h...');
  try {
    const aujourdhui = new Date().toISOString().split('T')[0];
    const dateLabel = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

    const { data: interventions } = await supabase
      .from('agenda').select('*')
      .eq('date_intervention', aujourdhui)
      .neq('statut', 'annulé')
      .order('heure', { ascending: true });

    const liste = interventions || [];
    if (liste.length === 0) {
      console.log('☀️ Aucune intervention aujourd\'hui');
      return;
    }

    // Calcul CA potentiel (si lié à des devis)
    const { data: devisJour } = await supabase
      .from('historique').select('total_ht')
      .eq('type', 'devis')
      .gte('created_at', aujourdhui + 'T00:00:00')
      .lte('created_at', aujourdhui + 'T23:59:59');
    const caPotentiel = (devisJour||[]).reduce((s,d) => s + parseFloat(d.total_ht||0), 0);

    // ── Email détaillé uniquement (gratuit) ──
    const rowsHtml = liste.map(iv => `
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:12px 8px;font-weight:700;color:#C9A84C;font-size:14px;">${iv.heure}</td>
        <td style="padding:12px 8px;font-weight:600;color:#1B2A4A;">${iv.client}</td>
        <td style="padding:12px 8px;color:#555;font-size:13px;">${iv.adresse||'—'}</td>
        <td style="padding:12px 8px;"><span style="background:#1B2A4A22;color:#1B2A4A;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">${iv.type_intervention}</span></td>
        <td style="padding:12px 8px;font-size:12px;color:#888;">${iv.notes||'—'}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f0f2f5;margin:0;padding:20px;">
<div style="max-width:680px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#1B2A4A,#243660);border-radius:16px;padding:24px;margin-bottom:16px;text-align:center;">
    <div style="font-size:28px;margin-bottom:6px;">☀️</div>
    <div style="font-size:22px;font-weight:900;color:white;">Bonjour Diahe !</div>
    <div style="color:rgba(255,255,255,0.7);font-size:14px;margin-top:4px;">${dateLabel}</div>
  </div>
  <div style="background:white;border-radius:16px;padding:24px;margin-bottom:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="display:flex;gap:16px;margin-bottom:20px;">
      <div style="flex:1;background:#f8f9fa;border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:900;color:#C9A84C;">${liste.length}</div>
        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Interventions</div>
      </div>
      <div style="flex:1;background:#f8f9fa;border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:900;color:#C9A84C;">${liste[0]?.heure||'—'}</div>
        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Première RDV</div>
      </div>
      <div style="flex:1;background:#f8f9fa;border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:900;color:#C9A84C;">${Math.round(caPotentiel)} €</div>
        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">CA potentiel</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f8f9fa;">
        <th style="padding:10px 8px;text-align:left;font-size:11px;color:#888;font-weight:700;text-transform:uppercase;">Heure</th>
        <th style="padding:10px 8px;text-align:left;font-size:11px;color:#888;font-weight:700;text-transform:uppercase;">Client</th>
        <th style="padding:10px 8px;text-align:left;font-size:11px;color:#888;font-weight:700;text-transform:uppercase;">Adresse</th>
        <th style="padding:10px 8px;text-align:left;font-size:11px;color:#888;font-weight:700;text-transform:uppercase;">Type</th>
        <th style="padding:10px 8px;text-align:left;font-size:11px;color:#888;font-weight:700;text-transform:uppercase;">Notes</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>
  <div style="text-align:center;color:#aaa;font-size:12px;">SINELEC Paris — Récap auto chaque matin 7h</div>
</div></body></html>`;

    await envoyerEmail('sinelec.paris@gmail.com', `☀️ ${liste.length} intervention${liste.length>1?'s':''} aujourd'hui — SINELEC`, html);
    console.log('✅ Récap matin envoyé');
  } catch(e) { console.error('Erreur récap matin:', e.message); }
});

// ─── CRON: BILAN JOURNÉE à 19h00 ──────────────────────────────
cron.schedule('0 19 * * *', async () => {
  console.log('🌙 Cron bilan journée 19h...');
  try {
    const aujourdhui = new Date().toISOString().split('T')[0];
    const dateLabel = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });

    // Interventions du jour
    const { data: interventions } = await supabase
      .from('agenda').select('*')
      .eq('date_intervention', aujourdhui)
      .order('heure', { ascending: true });

    // Factures du jour
    const { data: factures } = await supabase
      .from('historique').select('*')
      .eq('type', 'facture')
      .gte('created_at', aujourdhui + 'T00:00:00')
      .lte('created_at', aujourdhui + 'T23:59:59');

    // Devis du jour
    const { data: devis } = await supabase
      .from('historique').select('*')
      .eq('type', 'devis')
      .gte('created_at', aujourdhui + 'T00:00:00')
      .lte('created_at', aujourdhui + 'T23:59:59');

    const caJour = (factures||[]).reduce((s,f) => s + parseFloat(f.total_ht||0), 0);
    const devisAttente = (devis||[]).filter(d => d.statut==='envoyé');
    const caAttente = devisAttente.reduce((s,d) => s + parseFloat(d.total_ht||0), 0);
    const terminees = (interventions||[]).filter(iv => iv.statut==='terminé').length;
    const total = (interventions||[]).length;

    if (total === 0 && caJour === 0) { console.log('🌙 Journée vide'); return; }

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f0f2f5;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#1B2A4A,#243660);border-radius:16px;padding:24px;margin-bottom:16px;text-align:center;">
    <div style="font-size:28px;margin-bottom:6px;">🌙</div>
    <div style="font-size:20px;font-weight:900;color:white;">Bilan de journée</div>
    <div style="color:rgba(255,255,255,0.7);font-size:14px;margin-top:4px;">${dateLabel}</div>
  </div>
  <div style="background:white;border-radius:16px;padding:24px;margin-bottom:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px;">
      <div style="background:#f8f9fa;border-radius:12px;padding:14px;text-align:center;">
        <div style="font-size:26px;font-weight:900;color:#10b981;">${Math.round(caJour)} €</div>
        <div style="font-size:11px;color:#888;margin-top:3px;">CA encaissé</div>
      </div>
      <div style="background:#f8f9fa;border-radius:12px;padding:14px;text-align:center;">
        <div style="font-size:26px;font-weight:900;color:#C9A84C;">${terminees}/${total}</div>
        <div style="font-size:11px;color:#888;margin-top:3px;">Interventions</div>
      </div>
      <div style="background:#f8f9fa;border-radius:12px;padding:14px;text-align:center;">
        <div style="font-size:26px;font-weight:900;color:#f59e0b;">${Math.round(caAttente)} €</div>
        <div style="font-size:11px;color:#888;margin-top:3px;">Devis en attente</div>
      </div>
    </div>

    ${(factures||[]).length > 0 ? `
    <div style="margin-bottom:16px;">
      <div style="font-size:12px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">💰 Factures émises</div>
      ${(factures||[]).map(f => `
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0f0f0;">
        <span style="color:#333;font-size:13px;">${f.client||'—'}</span>
        <span style="font-weight:700;color:#C9A84C;">${Math.round(parseFloat(f.total_ht||0))} €</span>
      </div>`).join('')}
    </div>` : ''}

    ${devisAttente.length > 0 ? `
    <div style="background:#fef9ec;border:1px solid #fcd34d;border-radius:10px;padding:14px;">
      <div style="font-size:12px;font-weight:800;color:#92400e;margin-bottom:8px;">⏳ ${devisAttente.length} devis à relancer</div>
      ${devisAttente.map(d => `<div style="font-size:12px;color:#555;padding:3px 0;">${d.client} — ${Math.round(parseFloat(d.total_ht||0))} €</div>`).join('')}
    </div>` : ''}

  </div>
  <div style="text-align:center;color:#aaa;font-size:12px;">SINELEC Paris — Bilan auto chaque soir 19h</div>
</div></body></html>`;

    await envoyerEmail('sinelec.paris@gmail.com',
      `🌙 Bilan ${dateLabel} — CA : ${Math.round(caJour)} € — ${terminees}/${total} interventions`,
      html);
    console.log('✅ Bilan journée envoyé');
  } catch(e) { console.error('Erreur bilan journée:', e.message); }
});

// ─── API: LISTE MATÉRIEL PAR TYPE ──────────────────────────────
const MATERIEL_PAR_TYPE = {
  'Dépannage': [
    'Multimètre numérique', 'Pince ampèremétrique', 'Testeur de prise',
    'Tournevis isolés jeu complet', 'Pince à dénuder', 'Wago lot 50',
    'Disjoncteurs 10/16/20A (2 de chaque)', 'Câble 1.5mm² + 2.5mm² (5m)',
    'Ruban isolant', 'Lampe frontale', 'Boîtes de dérivation (x3)',
  ],
  'Tableau': [
    'Coffret 1 rangée (si remplacement)', 'Disjoncteurs assortis 10/16/20/32A',
    'Différentiel 30mA type A 63A (x2)', 'Peigne horizontal 13 modules',
    'Câble 2.5mm² rigide (10m)', 'Tournevis isolés', 'Multimètre',
    'Étiquettes tableau', 'Schéma vierge', 'Vis + chevilles assortiment',
  ],
  'VMC': [
    'Caisson VMC (si remplacement)', 'Gaine flexible (3m)',
    'Bouches extraction (x2)', 'Câble 1.5mm² souple (5m)',
    'Perceuse + forets béton', 'Scie cloche', 'Wago',
    'Gaine ICTA 20mm (3m)', 'Tournevis', 'Enduit rebouchage',
  ],
  'Installation': [
    'Câble 2.5mm² (20m)', 'Câble 1.5mm² (10m)', 'Goulotte 40x16 (3ml)',
    'Prises 2P+T (x6)', 'Interrupteurs (x4)', 'Boîtes encastrement (x6)',
    'Perceuse + forets', 'Niveau laser', 'Multimètre',
    'Wago lot 100', 'Tournevis isolés', 'Disjoncteurs assortis',
  ],
  'Devis': [
    'Bloc-notes + stylo', 'Mètre ruban 5m', 'Lampe frontale',
    'Multimètre (test rapide)', 'Téléphone chargé (photos)',
    'Catalogue tarifs SINELEC',
  ],
  'Mise en conformité': [
    'Multimètre + pince', 'Testeur de terre', 'Câble terre 16mm² (2m)',
    'DAAF (x2)', 'Rapport de conformité vierge', 'Disjoncteurs assortis',
    'Wago', 'Tournevis isolés', 'Testerélectrique',
  ],
  'Autre': [
    'Multimètre', 'Tournevis isolés jeu complet', 'Câbles assortis',
    'Wago', 'Lampe frontale', 'Téléphone chargé',
  ],
};

app.get('/api/agenda/materiel/:type', (req, res) => {
  const type = decodeURIComponent(req.params.type);
  const liste = MATERIEL_PAR_TYPE[type] || MATERIEL_PAR_TYPE['Autre'];
  res.json({ type, materiel: liste });
});

// API: Tester récap matin manuellement
app.post('/api/agenda/test-recap', async (req, res) => {
  try {
    // Déclencher le récap manuellement (même logique que le cron)
    const aujourdhui = new Date().toISOString().split('T')[0];
    const { data } = await supabase.from('agenda').select('*').eq('date_intervention', aujourdhui);
    res.json({ success: true, interventions: (data||[]).length, message: 'Récap déclenché' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ═══════════════════════════════════════════════════════════════

app.get('/api/grille', async (req, res) => {
  try {
    // Format plat [{code, nom, prix_ht}] pour chargement dynamique frontend
    const { data, error } = await supabase
      .from('grille_tarifaire')
      .select('code, nom, prix_ht')
      .eq('actif', true);
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Erreur /api/grille:', error);
    res.status(500).json({ error: error.message });
  }
});

// Route groupée — utilisée en interne (chatbot, devis auto)
app.get('/api/grille/grouped', async (req, res) => {
  try {
    const grille = await chargerGrilleTarifaire();
    res.json(grille || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// API: TÉLÉCHARGER PDF PAR NUMÉRO
// ═══════════════════════════════════════════════════════════════
app.get('/api/pdf/:num', async (req, res) => {
  try {
    const { num } = req.params;

    // Récupérer le devis depuis Supabase
    const { data, error } = await supabase
      .from('historique')
      .select('*')
      .eq('num', num)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Document non trouvé' });
    }

    const { type, client, adresse, prestations, total_ht } = data;
    // Détecter le type depuis le numéro si absent (OS-xxx = devis, sinon facture)
    const docType = type || (num.startsWith('OS-') ? 'devis' : 'facture');
    const docStatut = data.statut || '';
    
    // Mention acquittée si facture payée
    let typeLabelUpper;
    if (docType === 'devis') {
      typeLabelUpper = 'DEVIS';
    } else if (docStatut === 'paye' || docStatut === 'payé' || docStatut === 'acquitté') {
      typeLabelUpper = 'FACTURE ACQUITTEE';
    } else {
      typeLabelUpper = 'FACTURE';
    }
    
    const dateStr = new Date(data.date_envoi || data.created_at).toLocaleDateString('fr-FR');
    const dateValide = new Date(new Date(data.date_envoi || data.created_at).getTime() + 30*24*60*60*1000).toLocaleDateString('fr-FR');

    const detailsPath = path.join(__dirname, `_dl_details_${num}.json`);
    const pyPath = path.join(__dirname, `_dl_devis_${num}.py`);
    const pdfPath = path.join(__dirname, `_dl_${num}.pdf`);

    const detailsData = (prestations || []).map(p => ({
      designation: p.nom || p.designation,
      qte: p.quantite || p.qte || 1,
      prixUnit: p.prix || p.prixUnit || 0,
      total: (p.prix || p.prixUnit || 0) * (p.quantite || p.qte || 1),
      details: p.desc ? [p.desc] : (Array.isArray(p.details) ? p.details : [])
    }));

    fs.writeFileSync(detailsPath, JSON.stringify(detailsData));

    const clientEsc = String(client || '').replace(/'/g, ' ');
    const clientNomComplet = clientEsc;
    // Récupérer les champs depuis data (peuvent être absents)
    const complement = data.complement || '';
    const telephone = data.telephone || '';
    const clientComplement = String(complement || '').replace(/'/g, ' ').trim();
    const clientTel = String(telephone || '').trim();
    const adresseEsc = String(adresse || '').replace(/'/g, ' ');
    const clientParts = (adresse || '').split(',');
    const clientRue = String(clientParts[0] || '').trim().replace(/'/g, ' ');
    const clientVille = clientParts.slice(1).join(',').trim().replace(/'/g, ' ');

    // Utiliser le même script Python que pour la génération
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

W, H = A4
MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C')
OR_PALE=colors.HexColor('#FBF7EC'); OR_FONCE=colors.HexColor('#A07830')
BLANC=colors.white; CREME=colors.HexColor('#FDFCF9')
GRIS_TEXTE=colors.HexColor('#3A3A3A'); GRIS_SOFT=colors.HexColor('#777777')
GRIS_LIGNE=colors.HexColor('#E0DDD6'); GRIS_BG=colors.HexColor('#F5F4F0')

def p(txt,sz=9,font='Helvetica',color=GRIS_TEXTE,align=TA_LEFT,sb=0,sa=2,leading=None):
    if leading is None: leading=sz*1.35
    return Paragraph(str(txt),ParagraphStyle('s',fontName=font,fontSize=sz,
        textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa,leading=leading,wordWrap='CJK'))

data=json.loads(open(sys.argv[1],encoding='utf-8').read())
totalHT=sum(l['total'] for l in data)
logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())

class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw):
        pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0
        self.saveState(); self._draw_page()
    def showPage(self):
        self._draw_footer(); pdfcanvas.Canvas.showPage(self)
        self._pg+=1; self.saveState(); self._draw_page()
    def save(self):
        self._draw_footer(); pdfcanvas.Canvas.save(self)
    def _draw_page(self):
        self.saveState()
        self.setFillColor(CREME); self.rect(0,0,W,H,fill=1,stroke=0)
        self.setFillColor(MARINE); self.rect(0,0,0.7*cm,H,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.7*cm,0,0.08*cm,H,fill=1,stroke=0)
        if self._pg==0: self._draw_header()
        self.restoreState()
    def _draw_header(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-5.2*cm,W-0.78*cm,5.2*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-5.2*cm,W-0.78*cm,0.1*cm,fill=1,stroke=0)
        logo_img=io.BytesIO(logo_bytes)
        self.drawImage(ImageReader(logo_img),1.3*cm,H-4.6*cm,width=3.0*cm,height=3.0*cm,preserveAspectRatio=True,mask='auto')
        self.setFont('Helvetica',7.5); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(1.3*cm,H-4.85*cm,'128 Rue La Boetie, 75008 Paris')
        self.drawString(1.3*cm,H-5.1*cm,'07 87 38 86 22  |  sinelec.paris@gmail.com  |  SIRET : 91015824500019')
        self.setFont('Helvetica-Bold',44); self.setFillColor(BLANC)
        self.drawRightString(W-1.2*cm,H-2.2*cm,'${typeLabelUpper}')
        self.setStrokeColor(OR); self.setLineWidth(1.5)
        self.line(10*cm,H-2.65*cm,W-1.2*cm,H-2.65*cm)
        self.setFillColor(OR); self.roundRect(W-6.5*cm,H-3.55*cm,5.3*cm,0.65*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(MARINE)
        self.drawCentredString(W-3.85*cm,H-3.22*cm,'N ${num}')
        self.setFont('Helvetica',8); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawRightString(W-1.2*cm,H-3.9*cm,'Date : ${dateStr}   |   Valable jusqu\u2019au : ${dateValide}')
    def _draw_footer(self):
        self.saveState()
        self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI \u2022 128 Rue La Boetie, 75008 Paris \u2022 SIRET : 91015824500019 \u2022 TVA non applicable art. 293B CGI \u2022 Garantie decennale ORUS')
        self.setFont('Helvetica-Bold',7); self.setFillColor(OR)
        self.drawRightString(W-1.2*cm,0.28*cm,'${num}')
        self.restoreState()

doc=SimpleDocTemplate(sys.argv[2],pagesize=A4,leftMargin=1.2*cm,rightMargin=1.0*cm,topMargin=5.6*cm,bottomMargin=1.6*cm)
story=[]

client_b=Table([[p('CLIENT',7,'Helvetica-Bold',OR,sa=4)],[p('${clientEsc}',10,'Helvetica-Bold',MARINE)],[p('${clientRue}',8.5,color=GRIS_TEXTE)],[p('${clientVille}',8.5,color=GRIS_TEXTE)]],colWidths=[18.2*cm])
client_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),1,OR),('LINEBEFORE',(0,0),(0,-1),4,MARINE),('TOPPADDING',(0,0),(0,0),10),('BOTTOMPADDING',(0,-1),(-1,-1),10)]))
story.append(client_b); story.append(Spacer(1,0.5*cm))

cw=[0.7*cm,9.5*cm,1.5*cm,0.9*cm,2.4*cm,3.2*cm]
rows=[[p('#',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('DESIGNATION',7.5,'Helvetica-Bold',BLANC),p('QTE',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('U.',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('PRIX U. HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT),p('TOTAL HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT)]]
for i,l in enumerate(data):
    q=int(l['qte']) if l['qte']==int(l['qte']) else l['qte']
    rows.append([p(str(i+1),9,color=OR,align=TA_CENTER),p('<b>'+l['designation']+'</b>',9,color=MARINE),p(str(q),9,align=TA_CENTER),p('u.',9,align=TA_CENTER,color=GRIS_SOFT),p('%.2f \u20ac'%l['prixUnit'],9,align=TA_RIGHT),p('<b>%.2f \u20ac</b>'%l['total'],9,'Helvetica-Bold',MARINE,TA_RIGHT)])
t=Table(rows,colWidths=cw)
ts=[('BACKGROUND',(0,0),(-1,0),MARINE),('LINEBELOW',(0,0),(-1,0),2.5,OR),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('BOX',(0,0),(-1,-1),0.3,GRIS_LIGNE)]
for i in range(len(data)):
    bg=BLANC if i%2==0 else GRIS_BG
    ts.append(('BACKGROUND',(0,i+1),(-1,i+1),bg))
    ts.append(('LINEBELOW',(0,i+1),(-1,i+1),0.3,GRIS_LIGNE))
t.setStyle(TableStyle(ts)); story.append(t); story.append(Spacer(1,0.15*cm))

tt=Table([['',p('Total HT',9,color=GRIS_SOFT,align=TA_RIGHT),p('%.2f \u20ac'%totalHT,9,'Helvetica-Bold',GRIS_TEXTE,TA_RIGHT)],['',p('TVA',9,color=GRIS_SOFT,align=TA_RIGHT),p('Non applicable (art. 293B)',8,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[9.0*cm,4.5*cm,4.7*cm])
tt.setStyle(TableStyle([('LINEABOVE',(1,0),(-1,0),0.5,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6)]))
story.append(tt); story.append(Spacer(1,0.12*cm))

net=Table([[p('NET A PAYER',12,'Helvetica-Bold',BLANC),p('%.2f \u20ac'%totalHT,16,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('LINEBELOW',(0,0),(-1,-1),3,OR),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(net); story.append(Spacer(1,0.3*cm))

iban=Table([[p('IBAN',7,'Helvetica-Bold',GRIS_SOFT),p('FR76 1695 8000 0174 2540 5920 931',9,'Helvetica-Bold',MARINE),p('BIC',7,'Helvetica-Bold',GRIS_SOFT,TA_RIGHT),p('QNTOFRP1XXX',9,'Helvetica-Bold',MARINE,TA_RIGHT)]],colWidths=[1.5*cm,9.5*cm,1.8*cm,5.4*cm])
iban.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),0.5,OR),('LINEBEFORE',(0,0),(0,-1),4,MARINE),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(iban)

doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw))
print('PDF_OK')
`;

    fs.writeFileSync(pyPath, py, 'utf8');

    try {
      execSync(`python3 ${pyPath} ${detailsPath} ${pdfPath}`, { cwd: __dirname, stdio: 'inherit' });
    } catch(pyErr) {
      throw new Error('PDF generation failed');
    }

    const pdfBuffer = fs.readFileSync(pdfPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${num}.pdf"`);
    res.send(pdfBuffer);

    try { fs.unlinkSync(pyPath); } catch(e) {}
    try { fs.unlinkSync(detailsPath); } catch(e) {}
    try { fs.unlinkSync(pdfPath); } catch(e) {}

  } catch (error) {
    console.error('Erreur PDF download:', error);
    res.status(500).json({ error: error.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// API: GÉNÉRER LIEN DE PAIEMENT SUMUP
// ═══════════════════════════════════════════════════════════════
app.post('/api/sumup/lien/:num', async (req, res) => {
  try {
    const { num } = req.params;

    // Récupérer la facture
    const { data, error } = await supabase
      .from('historique')
      .select('*')
      .eq('num', num)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Document non trouvé' });
    }

    const montant = parseFloat(data.total_ht || 0);
    if (montant <= 0) {
      return res.status(400).json({ error: 'Montant invalide' });
    }

    console.log(`💳 Génération lien SumUp pour ${num} — ${montant}€`);

    // ── Hosted Checkout SumUp (méthode officielle) ───────
    const checkoutRef = `SINELEC-${num}-${Date.now()}`;
    const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';

    const checkoutRes = await fetch('https://api.sumup.com/v0.1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUMUP_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        checkout_reference: checkoutRef,
        amount: montant,
        currency: 'EUR',
        description: `SINELEC Paris - Facture ${num} - ${data.client || ''}`,
        pay_to_email: process.env.SUMUP_EMAIL || 'sinelec.paris@gmail.com',
        redirect_url: `${appUrl}/paiement-confirme/${num}`,
        hosted_checkout: { enabled: true }
      }),
    });

    if (!checkoutRes.ok) {
      const err = await checkoutRes.text();
      console.error('❌ Erreur SumUp:', err);
      return res.status(500).json({ error: 'Erreur SumUp: ' + err });
    }

    const checkout = await checkoutRes.json();
    console.log('💳 SumUp checkout créé:', checkout.id);

    // hosted_checkout_url = URL de paiement directe retournée par SumUp
    const lienPaiement = checkout.hosted_checkout_url ||
      checkout.checkout_url ||
      `https://pay.sumup.com/b2c/checkout/${checkout.id}`;

    console.log(`✅ Lien SumUp créé: ${lienPaiement}`);

    // Sauvegarder le lien dans Supabase
    await supabase.from('historique')
      .update({ lien_paiement: lienPaiement, checkout_id: checkout.id })
      .eq('num', num);

    await logSystem('sumup', `Lien paiement créé pour ${num}`, { lien: lienPaiement, montant }, true);

    const prenomClient = (data.client || 'client').split(' ')[0];
    const modeEnvoi = req.query.envoi || 'les2'; // sms | email | les2

    // ── Email avec bouton paiement ────────────────────────
    if ((modeEnvoi === 'email' || modeEnvoi === 'les2') && data.email) {
      try {
        const htmlPaiement = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f0f2f5;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#1B2A4A,#243660);border-radius:16px;padding:24px;text-align:center;margin-bottom:16px;">
    <div style="font-size:24px;font-weight:900;color:white;">⚡ SINELEC Paris</div>
    <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px;">Lien de paiement sécurisé</div>
  </div>
  <div style="background:white;border-radius:16px;padding:28px;margin-bottom:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <h2 style="color:#1B2A4A;margin-bottom:8px;">Bonjour ${prenomClient},</h2>
    <p style="color:#555;font-size:14px;margin-bottom:20px;">Votre facture SINELEC <strong>${num}</strong> d'un montant de <strong style="color:#C9A84C;">${montant.toFixed(2)} €</strong> est prête au paiement.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${lienPaiement}" style="display:inline-block;background:linear-gradient(135deg,#C9A84C,#A07830);color:white;text-decoration:none;padding:18px 40px;border-radius:14px;font-size:16px;font-weight:800;letter-spacing:0.5px;">
        💳 Payer ${montant.toFixed(2)} € maintenant
      </a>
    </div>
    <p style="color:#aaa;font-size:12px;text-align:center;">Paiement sécurisé via SumUp — Lien valable 30 minutes</p>
    <div style="background:#f8f9fa;border-radius:10px;padding:14px;margin-top:20px;">
      <div style="color:#888;font-size:12px;">Si le bouton ne fonctionne pas, copiez ce lien :</div>
      <div style="color:#1B2A4A;font-size:11px;word-break:break-all;margin-top:6px;">${lienPaiement}</div>
    </div>
  </div>
  <div style="text-align:center;color:#aaa;font-size:12px;">SINELEC Paris — 07 87 38 86 22 — sinelec.paris@gmail.com</div>
</div></body></html>`;

        await envoyerEmail(
          data.email,
          `💳 Paiement SINELEC ${num} — ${montant.toFixed(2)} €`,
          htmlPaiement
        );
        console.log('✅ Email paiement envoyé à:', data.email);
      } catch(e) {
        console.error('⚠️ Email paiement:', e.message);
      }
    }

    // ── SMS court et chaleureux ───────────────────────────
    if ((modeEnvoi === 'sms' || modeEnvoi === 'les2') && data.telephone) {
      try {
        const smsCourt = `Bonjour ${prenomClient} 😊 Merci pour votre confiance ! Voici votre lien de paiement securise - ${montant.toFixed(0)}EUR : ${lienPaiement} A bientot ! SINELEC Paris ⚡`;
        await envoyerSMS(data.telephone, smsCourt);
        console.log('✅ SMS paiement envoyé à:', data.telephone);
      } catch(e) {
        console.error('⚠️ SMS paiement:', e.message);
      }
    }

    res.json({ 
      success: true, 
      lien: lienPaiement,
      checkout_id: checkout.id,
      montant,
      num
    });

  } catch (error) {
    console.error('Erreur SumUp:', error);
    await logSystem('sumup', 'Erreur lien paiement', { error: error.message }, false, error);
    alerterErreurCritique('sumup', error.message, `Facture: ${req.params?.num}`).catch(() => {});
    mettreAJourStatut('sumup', false, error.message).catch(() => {});
    res.status(500).json({ error: error.message });
  }
});

// Page confirmation paiement — marquer la facture acquittée + envoyer PDF acquitté
app.get('/paiement-confirme/:num', async (req, res) => {
  const { num } = req.params;
  
  try {
    // 1. Marquer comme payée dans Supabase
    await supabase.from('historique')
      .update({ statut: 'paye', date_paiement: new Date().toISOString() })
      .eq('num', num);
    console.log('✅ Facture marquée payée:', num);

    // 2. Récupérer les données de la facture
    const { data: factureData } = await supabase
      .from('historique')
      .select('*')
      .eq('num', num)
      .single();

    // 3. Générer et envoyer le PDF acquitté en background
    if (factureData?.email) {
      setImmediate(async () => {
        try {
          const montant = parseFloat(factureData.total_ht || 0);
          const dateStr = new Date().toLocaleDateString('fr-FR');
          const clientEsc = String(factureData.client || '').replace(/'/g, ' ');
          const adresseEsc = String(factureData.adresse || '').replace(/'/g, ' ');
          const prenomClient = (factureData.client || 'client').split(' ')[0];

          const detailsData = (factureData.prestations || []).map(p => ({
            designation: p.nom || p.designation || '',
            qte: p.quantite || p.qte || 1,
            prixUnit: parseFloat(p.prix || p.prixUnit || 0),
            total: parseFloat(p.prix || p.prixUnit || 0) * (p.quantite || p.qte || 1),
            details: p.desc ? [p.desc] : []
          }));

          const detailsPath = path.join(__dirname, `_acq_details_${num}.json`);
          const pyPath = path.join(__dirname, `_acq_${num}.py`);
          const pdfPath = path.join(__dirname, `_acq_${num}.pdf`);

          fs.writeFileSync(detailsPath, JSON.stringify(detailsData));

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

W, H = A4
MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C')
OR_PALE=colors.HexColor('#FBF7EC'); BLANC=colors.white; CREME=colors.HexColor('#FDFCF9')
GRIS_TEXTE=colors.HexColor('#3A3A3A'); GRIS_SOFT=colors.HexColor('#777777')
GRIS_LIGNE=colors.HexColor('#E0DDD6'); GRIS_BG=colors.HexColor('#F5F4F0')
VERT=colors.HexColor('#16a34a'); VERT_PALE=colors.HexColor('#f0fdf4')

def p(txt,sz=9,font='Helvetica',color=GRIS_TEXTE,align=TA_LEFT,sb=0,sa=2,leading=None):
    if leading is None: leading=sz*1.35
    return Paragraph(str(txt),ParagraphStyle('s',fontName=font,fontSize=sz,
        textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa,leading=leading,wordWrap='CJK'))

data=json.loads(open(sys.argv[1],encoding='utf-8').read())
totalHT=sum(l['total'] for l in data)
logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())

class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw):
        pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0
        self.saveState(); self._draw_page()
    def showPage(self):
        self._draw_footer(); pdfcanvas.Canvas.showPage(self)
        self._pg+=1; self.saveState(); self._draw_page()
    def save(self):
        self._draw_footer(); pdfcanvas.Canvas.save(self)
    def _draw_page(self):
        self.saveState()
        self.setFillColor(CREME); self.rect(0,0,W,H,fill=1,stroke=0)
        self.setFillColor(MARINE); self.rect(0,0,0.7*cm,H,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.7*cm,0,0.08*cm,H,fill=1,stroke=0)
        self._draw_header()
        self.restoreState()
    def _draw_header(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-5.2*cm,W-0.78*cm,5.2*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-5.2*cm,W-0.78*cm,0.1*cm,fill=1,stroke=0)
        logo_img=io.BytesIO(logo_bytes)
        self.drawImage(ImageReader(logo_img),1.3*cm,H-4.6*cm,width=3.0*cm,height=3.0*cm,preserveAspectRatio=True,mask='auto')
        self.setFont('Helvetica-Bold',9); self.setFillColor(colors.white)
        self.drawString(1.0*cm,H-4.5*cm,'128 Rue La Boetie, 75008 Paris')
        self.setFont('Helvetica',8.5); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(1.0*cm,H-4.75*cm,'Tel : 07 87 38 86 22  |  sinelec.paris@gmail.com')
        self.drawString(1.0*cm,H-5.0*cm,'SIRET : 91015824500019')
        # FACTURE ACQUITTEE en vert
        self.setFont('Helvetica-Bold',32); self.setFillColor(VERT)
        self.drawRightString(W-1.2*cm,H-1.8*cm,'FACTURE ACQUITTEE')
        self.setStrokeColor(VERT); self.setLineWidth(1.5)
        self.line(10*cm,H-2.2*cm,W-1.2*cm,H-2.2*cm)
        # Badge numero
        self.setFillColor(OR); self.roundRect(W-6.5*cm,H-3.1*cm,5.3*cm,0.65*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(MARINE)
        self.drawCentredString(W-3.85*cm,H-2.77*cm,'N\u00b0 ${num}')
        self.setFont('Helvetica',8); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawRightString(W-1.2*cm,H-3.5*cm,'Date de paiement : ${dateStr}')
        # Badge PAYEE
        self.setFillColor(VERT); self.roundRect(W-7.0*cm,H-4.3*cm,5.8*cm,0.7*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',10); self.setFillColor(colors.white)
        self.drawCentredString(W-4.1*cm,H-3.95*cm,'PAIEMENT RECU - MERCI !')
    def _draw_footer(self):
        self.saveState()
        self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(VERT); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI  \u2022  128 Rue La Boetie, 75008 Paris  \u2022  SIRET : 91015824500019  \u2022  TVA non applicable art. 293B CGI')
        self.setFont('Helvetica-Bold',7); self.setFillColor(VERT)
        self.drawRightString(W-1.2*cm,0.28*cm,'${num} - ACQUITTEE')
        self.restoreState()

doc=SimpleDocTemplate(sys.argv[2],pagesize=A4,leftMargin=1.2*cm,rightMargin=1.0*cm,topMargin=5.6*cm,bottomMargin=1.6*cm)
story=[]

# Client
client_b=Table([[p('CLIENT',7,'Helvetica-Bold',OR,sa=4)],[p('${clientEsc}',10,'Helvetica-Bold',MARINE)],[p('${adresseEsc}',8.5,color=GRIS_TEXTE)]],colWidths=[18.2*cm])
client_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),1,OR),('LINEBEFORE',(0,0),(0,-1),4,MARINE),('TOPPADDING',(0,0),(0,0),10),('BOTTOMPADDING',(0,-1),(-1,-1),10)]))
story.append(client_b); story.append(Spacer(1,0.5*cm))

# Tableau prestations
cw=[0.7*cm,9.5*cm,1.5*cm,0.9*cm,2.4*cm,3.2*cm]
rows=[[p('#',7.5,'Helvetica-Bold',colors.white,TA_CENTER),p('DESIGNATION',7.5,'Helvetica-Bold',colors.white),p('QTE',7.5,'Helvetica-Bold',colors.white,TA_CENTER),p('U.',7.5,'Helvetica-Bold',colors.white,TA_CENTER),p('PRIX U. HT',7.5,'Helvetica-Bold',colors.white,TA_RIGHT),p('TOTAL HT',7.5,'Helvetica-Bold',colors.white,TA_RIGHT)]]
for i,l in enumerate(data):
    q=int(l['qte']) if l['qte']==int(l['qte']) else l['qte']
    rows.append([p(str(i+1),9,color=OR,align=TA_CENTER),p('<b>'+l['designation']+'</b>',9,color=MARINE),p(str(q),9,align=TA_CENTER),p('u.',9,align=TA_CENTER,color=GRIS_SOFT),p('%.2f \u20ac'%l['prixUnit'],9,align=TA_RIGHT),p('<b>%.2f \u20ac</b>'%l['total'],9,'Helvetica-Bold',MARINE,TA_RIGHT)])
    for det in l.get('details',[]):
        rows.append(['',p('   - '+det,7.5,'Helvetica-Oblique',color=GRIS_SOFT),'','','',''])
t=Table(rows,colWidths=cw)
ts=[('BACKGROUND',(0,0),(-1,0),MARINE),('LINEBELOW',(0,0),(-1,0),2.5,OR),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('BOX',(0,0),(-1,-1),0.3,GRIS_LIGNE)]
row_idx=1; bg=True
for l in data:
    nb=1+len(l.get('details',[])); c=colors.white if bg else GRIS_BG
    ts.extend([('BACKGROUND',(0,row_idx),(-1,row_idx+nb-1),c),('LINEBELOW',(0,row_idx+nb-1),(-1,row_idx+nb-1),0.3,GRIS_LIGNE)])
    row_idx+=nb; bg=not bg
t.setStyle(TableStyle(ts)); story.append(t); story.append(Spacer(1,0.15*cm))

# Totaux
tt=Table([['',p('Total HT',9,color=GRIS_SOFT,align=TA_RIGHT),p('%.2f \u20ac'%totalHT,9,'Helvetica-Bold',GRIS_TEXTE,TA_RIGHT)],['',p('TVA',9,color=GRIS_SOFT,align=TA_RIGHT),p('Non applicable (art. 293B)',8,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[9.0*cm,4.5*cm,4.7*cm])
tt.setStyle(TableStyle([('LINEABOVE',(1,0),(-1,0),0.5,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6)]))
story.append(tt); story.append(Spacer(1,0.12*cm))

# Net à payer — ACQUITTE en vert
net=Table([[p('MONTANT ACQUITTE',13,'Helvetica-Bold',colors.white),p('%.2f \u20ac'%totalHT,16,'Helvetica-Bold',VERT,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('LINEBELOW',(0,0),(-1,-1),3,VERT),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(net); story.append(Spacer(1,0.3*cm))

# Confirmation paiement
confirm=Table([[p('Paiement recu le ${dateStr}',10,'Helvetica-Bold',VERT),p('Merci pour votre confiance !',9,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[10*cm,7.8*cm])
confirm.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),VERT_PALE),('BOX',(0,0),(-1,-1),1.5,VERT),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(confirm)

doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw))
print('PDF_ACQUITTE_OK')
`;

          fs.writeFileSync(pyPath, py, 'utf8');
          const { execSync } = require('child_process');
          execSync(`python3 ${pyPath} ${detailsPath} ${pdfPath}`, { cwd: __dirname });
          
          const pdfB64 = fs.readFileSync(pdfPath).toString('base64');

          // Email client avec PDF acquitté
          const htmlAcq = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f0f2f5;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#1B2A4A,#243660);border-radius:16px;padding:24px;text-align:center;margin-bottom:16px;">
    <div style="font-size:24px;font-weight:900;color:white;">⚡ SINELEC Paris</div>
    <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px;">Facture acquittée</div>
  </div>
  <div style="background:white;border-radius:16px;padding:28px;margin-bottom:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="font-size:56px;text-align:center;margin-bottom:16px;">✅</div>
    <h2 style="color:#16a34a;text-align:center;margin-bottom:20px;">Paiement reçu — Merci !</h2>
    <p style="color:#555;font-size:14px;margin-bottom:20px;">Bonjour <strong>${prenomClient}</strong>, nous avons bien reçu votre règlement. Votre facture acquittée est jointe à cet email.</p>
    <table style="width:100%;border-collapse:collapse;">
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:12px 0;color:#888;font-size:13px;">Référence</td>
        <td style="padding:12px 0;font-weight:700;color:#1B2A4A;text-align:right;">${num}</td>
      </tr>
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:12px 0;color:#888;font-size:13px;">Montant réglé</td>
        <td style="padding:12px 0;font-size:20px;font-weight:900;color:#16a34a;text-align:right;">${montant.toFixed(2)} €</td>
      </tr>
      <tr>
        <td style="padding:12px 0;color:#888;font-size:13px;">Date</td>
        <td style="padding:12px 0;font-weight:700;color:#1B2A4A;text-align:right;">${dateStr}</td>
      </tr>
    </table>
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px;margin-top:20px;text-align:center;">
      <div style="color:#16a34a;font-size:14px;font-weight:700;">Facture acquittée en pièce jointe</div>
    </div>
  </div>
  <div style="text-align:center;color:#aaa;font-size:12px;">SINELEC Paris — 07 87 38 86 22 — sinelec.paris@gmail.com</div>
</div></body></html>`;

          await envoyerEmail(
            factureData.email,
            `✅ Facture SINELEC ${num} — Paiement reçu`,
            htmlAcq,
            { content: pdfB64, name: `Facture-Acquittee-${num}.pdf` }
          );

          // Email SINELEC
          await envoyerEmail(
            'sinelec.paris@gmail.com',
            `💰 PAIEMENT RECU — ${num} — ${factureData.client || ''} — ${montant.toFixed(0)}€`,
            htmlAcq,
            { content: pdfB64, name: `Facture-Acquittee-${num}.pdf` }
          );

          // Nettoyage
          [pyPath, detailsPath, pdfPath].forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
          console.log('✅ Facture acquittée envoyée:', num);

        } catch(e) {
          console.error('⚠️ Erreur génération facture acquittée:', e.message);
        }
      });
    }
  } catch(e) {
    console.error('⚠️ Erreur confirmation paiement:', e.message);
  }
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paiement confirmé - SINELEC</title>
</head>
<body style="font-family:Arial,sans-serif;background:#f0f2f5;margin:0;padding:20px;text-align:center;">
<div style="max-width:500px;margin:40px auto;background:white;border-radius:20px;padding:40px;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
  <div style="font-size:64px;margin-bottom:16px;">✅</div>
  <h2 style="color:#1B2A4A;margin-bottom:12px;">Paiement confirmé !</h2>
  <p style="color:#555;margin-bottom:8px;">Merci pour votre règlement.</p>
  <p style="color:#555;">Référence : <strong style="color:#C9A84C;">${num}</strong></p>
  <p style="color:#aaa;font-size:13px;margin-top:20px;">SINELEC Paris — 07 87 38 86 22</p>
</div>
</body>
</html>`);
});

// ═══════════════════════════════════════════════════════════════
// CRON: VEILLE TARIFAIRE AUTOMATIQUE
// ═══════════════════════════════════════════════════════════════

async function veilTarifaire() {
  if (!CONFIG.features.veille_tarifaire || !CONFIG.veille.enabled) {
    console.log('⏭️ Veille tarifaire désactivée');
    return;
  }

  console.log('🔍 Démarrage veille tarifaire...');
  
  try {
    // Charger toutes les prestations
    const { data: prestations, error } = await supabase
      .from('grille_tarifaire')
      .select('*')
      .eq('actif', true)
      .eq('ajustement_auto', true);

    if (error) throw error;

    const ajustements = [];

    for (const prestation of prestations) {
      try {
        // Claude analyse le marché pour cette prestation
        const prompt = `Analyse le marché Île-de-France pour cette prestation électrique:

PRESTATION: ${prestation.nom}
PRIX ACTUEL SINELEC: ${prestation.prix_ht}€ HT

SOURCES À CONSULTER:
${CONFIG.veille.sources.join(', ')}

RÉPONDS EN JSON:
{
  "prix_min": 80,
  "prix_max": 120,
  "prix_moyen": 95,
  "recommandation": 90,
  "sources": ["source1.fr", "source2.fr"],
  "explication": "Le marché IDF se situe entre..."
}

Recommande un prix COMPÉTITIF (stratégie: ${CONFIG.veille.strategie}).`;

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
          tools: [{ type: 'web_search_20250305', name: 'web_search' }]
        });

        const text = response.content.find(c => c.type === 'text')?.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        
        if (!jsonMatch) continue;

        const analyse = JSON.parse(jsonMatch[0]);
        
        // Calculer ajustement
        const ecart_pct = ((analyse.recommandation - prestation.prix_ht) / prestation.prix_ht) * 100;
        
        // Appliquer seuil validation
        const auto_apply = Math.abs(ecart_pct) < CONFIG.veille.seuil_validation;

        if (auto_apply && CONFIG.veille.ajustement_auto) {
          // Mettre à jour automatiquement
          await supabase.from('grille_tarifaire')
            .update({
              prix_ht: analyse.recommandation,
              marche_min: analyse.prix_min,
              marche_max: analyse.prix_max,
              marche_moyen: analyse.prix_moyen,
              derniere_analyse: new Date().toISOString(),
              sources_analyse: analyse.sources
            })
            .eq('code', prestation.code);

          // Historique
          await supabase.from('historique_prix').insert({
            prestation_code: prestation.code,
            prix_ht: analyse.recommandation,
            marche_min: analyse.prix_min,
            marche_max: analyse.prix_max,
            raison_changement: 'Analyse marché automatique',
            changed_by: 'system'
          });

          ajustements.push({
            prestation: prestation.nom,
            ancien: prestation.prix_ht,
            nouveau: analyse.recommandation,
            ecart_pct: ecart_pct.toFixed(1),
            auto: true
          });
        } else {
          ajustements.push({
            prestation: prestation.nom,
            ancien: prestation.prix_ht,
            recommandation: analyse.recommandation,
            ecart_pct: ecart_pct.toFixed(1),
            auto: false,
            raison: 'Nécessite validation (écart > ' + CONFIG.veille.seuil_validation + '%)'
          });
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (err) {
        console.error(`Erreur analyse ${prestation.nom}:`, err);
      }
    }

    // Email rapport si activé
    if (CONFIG.veille.email_rapport && ajustements.length > 0) {
      const html = `
        <h2>📊 Rapport Veille Tarifaire</h2>
        <p>Date: ${new Date().toLocaleDateString('fr-FR')}</p>
        <h3>Ajustements effectués automatiquement:</h3>
        <ul>
          ${ajustements.filter(a => a.auto).map(a => 
            `<li><strong>${a.prestation}</strong>: ${a.ancien}€ → ${a.nouveau}€ (${a.ecart_pct > 0 ? '+' : ''}${a.ecart_pct}%)</li>`
          ).join('')}
        </ul>
        <h3>Ajustements nécessitant validation:</h3>
        <ul>
          ${ajustements.filter(a => !a.auto).map(a => 
            `<li><strong>${a.prestation}</strong>: ${a.ancien}€ → ${a.recommandation}€ (${a.ecart_pct > 0 ? '+' : ''}${a.ecart_pct}%) - ${a.raison}</li>`
          ).join('')}
        </ul>
      `;

      await envoyerEmail(
        CONFIG.veille.destinataire,
        '📊 Rapport Veille Tarifaire SINELEC',
        html
      );
    }

    await logSystem('veille', 'Veille tarifaire terminée', { nb_ajustements: ajustements.length }, true);
    console.log('✅ Veille tarifaire terminée:', ajustements.length, 'ajustements');

  } catch (error) {
    console.error('❌ Erreur veille tarifaire:', error);
    await logSystem('veille', 'Erreur veille', { error: error.message }, false, error);
  }
}

// Cron veille tarifaire (selon config)
if (CONFIG.veille.enabled) {
  const cronExpression = CONFIG.veille.frequence === 'quotidien'
    ? `0 ${CONFIG.veille.heure.split(':')[0]} * * *`
    : `0 ${CONFIG.veille.heure.split(':')[0]} * * ${CONFIG.veille.jour_semaine}`;

  cron.schedule(cronExpression, veilTarifaire);
  console.log(`📅 Veille tarifaire programmée: ${CONFIG.veille.frequence} à ${CONFIG.veille.heure}`);
}

// ═══════════════════════════════════════════════════════════════
// CRON: RELANCES AUTOMATIQUES
// ═══════════════════════════════════════════════════════════════

async function relancesAuto() {
  if (!CONFIG.features.relances_auto || !CONFIG.relances.enabled) {
    console.log('⏭️ Relances auto désactivées');
    return;
  }

  console.log('📧 Démarrage relances automatiques...');

  try {
    // Chercher devis non signés
    const { data: devis, error } = await supabase
      .from('historique')
      .select('*')
      .eq('type', 'devis')
      .eq('statut', 'envoyé')
      .lt('nb_relances', CONFIG.relances.nb_relances_max);

    if (error) throw error;

    const maintenant = new Date();
    let nb_relances = 0;

    for (const d of devis) {
      const date_envoi = new Date(d.date_envoi);
      const date_derniere_relance = d.date_derniere_relance ? new Date(d.date_derniere_relance) : null;
      
      const heures_depuis_envoi = (maintenant - date_envoi) / (1000 * 60 * 60);
      const heures_depuis_relance = date_derniere_relance 
        ? (maintenant - date_derniere_relance) / (1000 * 60 * 60)
        : Infinity;

      let doit_relancer = false;

      if (d.nb_relances === 0 && heures_depuis_envoi >= CONFIG.relances.delai_premiere_relance) {
        doit_relancer = true;
      } else if (d.nb_relances === 1 && heures_depuis_relance >= CONFIG.relances.delai_deuxieme_relance) {
        doit_relancer = true;
      }

      if (doit_relancer && d.email) {
        const template = d.nb_relances === 0 ? CONFIG.relances.template_1 : CONFIG.relances.template_2;
        const message = template.replace('{num}', d.num);

        await envoyerEmail(
          d.email,
          `Relance - Devis SINELEC ${d.num}`,
          `<p>${message}</p>`
        );

        await supabase.from('historique')
          .update({
            nb_relances: d.nb_relances + 1,
            date_derniere_relance: maintenant.toISOString(),
            statut: 'relancé'
          })
          .eq('num', d.num);

        nb_relances++;
      }
    }

    await logSystem('relances', 'Relances terminées', { nb_relances }, true);
    console.log(`✅ ${nb_relances} relance(s) envoyée(s)`);

  } catch (error) {
    console.error('❌ Erreur relances:', error);
    await logSystem('relances', 'Erreur relances', { error: error.message }, false, error);
  }
}

// Cron relances (quotidien)
if (CONFIG.relances.enabled) {
  cron.schedule('0 10 * * *', relancesAuto); // Tous les jours à 10h
  console.log('📅 Relances auto programmées: quotidien à 10h');
}

// ═══════════════════════════════════════════════════════════════
// ENDPOINT MANUEL: LANCER VEILLE MAINTENANT
// ═══════════════════════════════════════════════════════════════

app.post('/api/veille/lancer', async (req, res) => {
  if (!CONFIG.features.veille_tarifaire) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    await veilTarifaire();
    res.json({ success: true, message: 'Veille tarifaire lancée' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINT MANUEL: LANCER RELANCES MAINTENANT
// ═══════════════════════════════════════════════════════════════

app.post('/api/relances/lancer', async (req, res) => {
  if (!CONFIG.features.relances_auto) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    await relancesAuto();
    res.json({ success: true, message: 'Relances lancées' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// CRON: RAPPORT HEBDOMADAIRE — Lundi 8h
// ═══════════════════════════════════════════════════════════════

async function rapportHebdomadaire() {
  console.log('📊 Génération rapport hebdomadaire...');
  try {
    const maintenant = new Date();
    const lundiDernier = new Date(maintenant);
    lundiDernier.setDate(maintenant.getDate() - 7);

    // Récupérer toutes les données de la semaine
    const { data: docs } = await supabase
      .from('historique')
      .select('*')
      .gte('created_at', lundiDernier.toISOString())
      .order('created_at', { ascending: false });

    const factures = (docs || []).filter(d => d.type === 'facture');
    const devis = (docs || []).filter(d => d.type === 'devis');
    const devisSemaine = (docs || []).filter(d => d.type === 'devis');

    // Calculs
    const caSemaine = factures.reduce((s, f) => s + parseFloat(f.total_ht || 0), 0);
    const devisEnAttente = devis.filter(d => d.statut === 'envoyé' || d.statut === 'envoye');
    const caEnAttente = devisEnAttente.reduce((s, d) => s + parseFloat(d.total_ht || 0), 0);
    const devisSignes = devis.filter(d => d.statut === 'signe' || d.statut === 'signé');
    const txConversion = devis.length > 0 ? Math.round((devisSignes.length / devis.length) * 100) : 0;

    // Récupérer devis non signés depuis plus de 48h (toutes périodes)
    const { data: tousDevis } = await supabase
      .from('historique')
      .select('*')
      .eq('type', 'devis')
      .in('statut', ['envoyé', 'envoye']);

    const devisARelancer = (tousDevis || []).filter(d => {
      const age = (maintenant - new Date(d.created_at)) / 3600000;
      return age > 48;
    });

    const semaine = `${lundiDernier.toLocaleDateString('fr-FR')} → ${maintenant.toLocaleDateString('fr-FR')}`;

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f0f2f5;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;">

  <!-- HEADER -->
  <div style="background:linear-gradient(135deg,#1B2A4A,#243660);border-radius:16px;padding:24px;text-align:center;margin-bottom:16px;">
    <div style="font-size:24px;font-weight:900;color:white;">⚡ SINELEC Paris</div>
    <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px;">📊 Rapport hebdomadaire — ${semaine}</div>
  </div>

  <!-- CA SEMAINE -->
  <div style="background:white;border-radius:16px;padding:20px;margin-bottom:12px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="font-size:12px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">💰 Chiffre d'affaires</div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0;">
      <span style="color:#555;font-size:14px;">CA facturé cette semaine</span>
      <span style="font-size:20px;font-weight:900;color:#C9A84C;">${caSemaine.toFixed(2)} €</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0;">
      <span style="color:#555;font-size:14px;">Factures émises</span>
      <span style="font-weight:700;color:#1B2A4A;">${factures.length}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;">
      <span style="color:#555;font-size:14px;">Panier moyen</span>
      <span style="font-weight:700;color:#1B2A4A;">${factures.length > 0 ? (caSemaine / factures.length).toFixed(0) : 0} €</span>
    </div>
  </div>

  <!-- DEVIS -->
  <div style="background:white;border-radius:16px;padding:20px;margin-bottom:12px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="font-size:12px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">📋 Devis</div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0;">
      <span style="color:#555;font-size:14px;">Devis envoyés cette semaine</span>
      <span style="font-weight:700;color:#1B2A4A;">${devisSemaine.length}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0;">
      <span style="color:#555;font-size:14px;">CA en attente de signature</span>
      <span style="font-size:18px;font-weight:900;color:#f59e0b;">${caEnAttente.toFixed(2)} €</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0;">
      <span style="color:#555;font-size:14px;">Taux de conversion</span>
      <span style="font-weight:700;color:${txConversion >= 50 ? '#10b981' : '#ef4444'};">${txConversion}%</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;">
      <span style="color:#ef4444;font-size:14px;font-weight:700;">⚠️ Devis à relancer (+48h)</span>
      <span style="font-weight:900;color:#ef4444;">${devisARelancer.length}</span>
    </div>
  </div>

  ${devisARelancer.length > 0 ? `
  <!-- DEVIS A RELANCER -->
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:16px;padding:20px;margin-bottom:12px;">
    <div style="font-size:12px;font-weight:800;color:#ef4444;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">🔔 À relancer maintenant</div>
    ${devisARelancer.slice(0, 5).map(d => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #fee2e2;">
      <div>
        <div style="font-weight:700;font-size:13px;color:#1B2A4A;">${d.client || 'Client'}</div>
        <div style="font-size:11px;color:#888;">${d.num} — ${new Date(d.created_at).toLocaleDateString('fr-FR')}</div>
      </div>
      <span style="font-weight:700;color:#C9A84C;">${parseFloat(d.total_ht || 0).toFixed(0)} €</span>
    </div>`).join('')}
  </div>` : ''}

  <!-- CTA -->
  <div style="text-align:center;margin:20px 0;">
    <a href="https://sinelec-api-production.up.railway.app/app.html" 
       style="display:inline-block;background:linear-gradient(135deg,#1B2A4A,#243660);color:white;text-decoration:none;padding:14px 28px;border-radius:12px;font-size:14px;font-weight:800;">
      📱 Ouvrir SINELEC OS
    </a>
  </div>

  <!-- FOOTER -->
  <div style="text-align:center;color:#aaa;font-size:12px;padding:12px;">
    SINELEC Paris — Rapport automatique chaque lundi 8h
  </div>

</div>
</body>
</html>`;

    await envoyerEmail(
      'sinelec.paris@gmail.com',
      `📊 Rapport semaine SINELEC — CA: ${caSemaine.toFixed(0)}€ — ${devisARelancer.length} devis à relancer`,
      html
    );

    console.log('✅ Rapport hebdomadaire envoyé !');
    await logSystem('rapport_hebdo', 'Rapport envoyé', { caSemaine, nbFactures: factures.length }, true);

  } catch (error) {
    console.error('❌ Erreur rapport hebdo:', error);
    await logSystem('rapport_hebdo', 'Erreur rapport', { error: error.message }, false, error);
  }
}

// Cron lundi 8h
cron.schedule('0 8 * * 1', rapportHebdomadaire);
console.log('📅 Rapport hebdomadaire programmé: lundi 8h00');


// ═══════════════════════════════════════════════════════════════
// ENDPOINT: TESTER RAPPORT HEBDO MAINTENANT
// ═══════════════════════════════════════════════════════════════
app.post('/api/rapport-hebdo/tester', async (req, res) => {
  try {
    await rapportHebdomadaire();
    res.json({ success: true, message: 'Rapport envoyé à sinelec.paris@gmail.com' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// MONITORING SYSTÈME — SINELEC OS
// ═══════════════════════════════════════════════════════════════

// Cache état des services en mémoire
const serviceStatus = {
  brevo_email: { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  brevo_sms:   { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  sumup:       { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  supabase:    { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  claude_api:  { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  pdf_python:  { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
};

// Mettre à jour le cache + Supabase
async function mettreAJourStatut(service, ok, erreur = null) {
  const s = serviceStatus[service];
  if (!s) return;
  s.status = ok ? 'ok' : 'error';
  s.lastCheck = new Date().toISOString();
  s.lastError = ok ? null : String(erreur || 'Erreur inconnue');
  s.checks++;
  if (ok) s.uptime++;

  try {
    await supabase.from('monitoring').upsert({
      service,
      status: s.status,
      last_check: s.lastCheck,
      last_error: s.lastError,
      uptime_pct: s.checks > 0 ? Math.round((s.uptime / s.checks) * 100) : 0
    }, { onConflict: 'service' });
  } catch(e) {
    // Silencieux — le monitoring ne doit pas faire planter l'app
  }
}

// Alerte email critique — NON BLOQUANT
async function alerterErreurCritique(service, erreur, contexte = '') {
  const icons = {
    brevo_email: '📧', brevo_sms: '📱', sumup: '💳',
    supabase: '🗄️', claude_api: '🤖', pdf_python: '📄'
  };
  const labels = {
    brevo_email: 'Brevo Email', brevo_sms: 'Brevo SMS', sumup: 'SumUp Paiement',
    supabase: 'Base de données Supabase', claude_api: 'Claude API', pdf_python: 'Génération PDF'
  };

  console.error(`🚨 ALERTE CRITIQUE [${service}]:`, erreur, contexte);

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#fff5f5;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);border-radius:16px;padding:24px;text-align:center;margin-bottom:16px;">
    <div style="font-size:32px;margin-bottom:8px;">🚨</div>
    <div style="font-size:20px;font-weight:900;color:white;">ALERTE SINELEC OS</div>
    <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px;">Erreur critique détectée</div>
  </div>
  <div style="background:white;border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,0.1);">
    <table style="width:100%;border-collapse:collapse;">
      <tr style="border-bottom:1px solid #fee2e2;">
        <td style="padding:12px 0;color:#888;font-size:13px;">Service</td>
        <td style="padding:12px 0;font-weight:700;color:#dc2626;text-align:right;">${icons[service] || '⚠️'} ${labels[service] || service}</td>
      </tr>
      <tr style="border-bottom:1px solid #fee2e2;">
        <td style="padding:12px 0;color:#888;font-size:13px;">Heure</td>
        <td style="padding:12px 0;font-weight:700;color:#1B2A4A;text-align:right;">${new Date().toLocaleString('fr-FR')}</td>
      </tr>
      <tr style="border-bottom:1px solid #fee2e2;">
        <td style="padding:12px 0;color:#888;font-size:13px;">Erreur</td>
        <td style="padding:12px 0;font-weight:700;color:#dc2626;text-align:right;font-size:12px;">${String(erreur).substring(0, 200)}</td>
      </tr>
      ${contexte ? `<tr>
        <td style="padding:12px 0;color:#888;font-size:13px;">Contexte</td>
        <td style="padding:12px 0;color:#555;text-align:right;font-size:12px;">${contexte}</td>
      </tr>` : ''}
    </table>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin-top:16px;">
      <div style="color:#dc2626;font-size:13px;font-weight:700;">⚡ Action requise</div>
      <div style="color:#555;font-size:12px;margin-top:4px;">Connectez-vous à SINELEC OS et vérifiez l'onglet Santé Système.</div>
    </div>
    <div style="text-align:center;margin-top:20px;">
      <a href="${process.env.APP_URL || 'https://sinelec-api-production.up.railway.app'}/app.html" 
         style="display:inline-block;background:linear-gradient(135deg,#1B2A4A,#243660);color:white;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:13px;font-weight:700;">
        🔍 Voir SINELEC OS
      </a>
    </div>
  </div>
  <div style="text-align:center;color:#aaa;font-size:11px;margin-top:12px;">
    SINELEC OS Monitoring — Alerte automatique
  </div>
</div></body></html>`;

  try {
    // Envoyer l'alerte directement via fetch (pas via envoyerEmail pour éviter boucle infinie)
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'SINELEC OS Monitoring', email: 'sinelec.paris@gmail.com' },
        to: [{ email: 'sinelec.paris@gmail.com' }],
        subject: `🚨 ALERTE SINELEC OS — ${labels[service] || service} en erreur`,
        htmlContent: html,
        trackOpens: 0, trackClicks: 0,
      }),
    });
  } catch(e) {
    console.error('⚠️ Impossible d\'envoyer l\'alerte monitoring:', e.message);
  }

  // Logger dans Supabase
  await mettreAJourStatut(service, false, erreur);
}

// ══════════════════════════════════════════════════════════════
// HEALTH CHECK — Test réel de chaque service
// ══════════════════════════════════════════════════════════════

async function verifierSante() {
  console.log('🏥 Health check démarré...');
  const erreurs = [];

  // 1. Supabase — test lecture simple
  try {
    const { error } = await supabase.from('compteurs').select('valeur').limit(1);
    if (error) throw error;
    await mettreAJourStatut('supabase', true);
    console.log('✅ Supabase OK');
  } catch(e) {
    await alerterErreurCritique('supabase', e.message, 'Health check');
    erreurs.push('supabase');
  }

  // 2. Brevo Email — vérifier le solde
  try {
    const res = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': BREVO_API_KEY, 'accept': 'application/json' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    // Vérifier si le plan est actif
    if (!data.email || !data.email.blockedContactsUrl) {
      // Compte valide même sans cette propriété
    }
    await mettreAJourStatut('brevo_email', true);
    console.log('✅ Brevo Email OK');
  } catch(e) {
    await alerterErreurCritique('brevo_email', e.message, 'Health check');
    erreurs.push('brevo_email');
  }

  // 3. Brevo SMS — vérifier crédit
  try {
    const res = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': BREVO_API_KEY, 'accept': 'application/json' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    // Vérifier crédit SMS
    const creditSMS = data.plan?.find(p => p.type === 'sms')?.credits || 0;
    if (creditSMS < 10) {
      // Alerte crédit bas mais pas une erreur bloquante
      await alerterErreurCritique('brevo_sms', 
        `Crédit SMS bas: ${creditSMS} SMS restants`, 
        'Rechargez vos crédits sur brevo.com');
    } else {
      await mettreAJourStatut('brevo_sms', true);
    }
    console.log(`✅ Brevo SMS OK — ${creditSMS} crédits`);
  } catch(e) {
    await alerterErreurCritique('brevo_sms', e.message, 'Health check');
    erreurs.push('brevo_sms');
  }

  // 4. SumUp — vérifier l'auth
  try {
    if (SUMUP_API_KEY) {
      const res = await fetch('https://api.sumup.com/v0.1/me', {
        headers: { 'Authorization': `Bearer ${SUMUP_API_KEY}` }
      });
      if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
      await mettreAJourStatut('sumup', true);
      console.log('✅ SumUp OK');
    }
  } catch(e) {
    await alerterErreurCritique('sumup', e.message, 'Health check');
    erreurs.push('sumup');
  }

  // 5. Claude API — vérifier la clé via endpoint account
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('Clé API manquante');
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    });
    if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
    await mettreAJourStatut('claude_api', true);
    console.log('✅ Claude API OK');
  } catch(e) {
    await alerterErreurCritique('claude_api', e.message, 'Health check');
    erreurs.push('claude_api');
  }

  // 6. PDF Python — vérifier que python3 + reportlab sont dispo
  try {
    const { execSync } = require('child_process');
    execSync('python3 -c "import reportlab; print(\'ok\')"', { timeout: 5000 });
    await mettreAJourStatut('pdf_python', true);
    console.log('✅ PDF Python OK');
  } catch(e) {
    await alerterErreurCritique('pdf_python', e.message, 'Health check');
    erreurs.push('pdf_python');
  }

  const bilan = erreurs.length === 0 
    ? '✅ Tous les services OK' 
    : `⚠️ ${erreurs.length} service(s) en erreur: ${erreurs.join(', ')}`;
  
  console.log('🏥 Health check terminé —', bilan);
  await logSystem('health_check', bilan, { erreurs }, erreurs.length === 0);
  
  return { ok: erreurs.length === 0, erreurs, status: serviceStatus };
}

// Cron health check toutes les heures
cron.schedule('0 * * * *', verifierSante);
console.log('📅 Health check programmé: toutes les heures');

// Lancer un premier check au démarrage (après 2min) — non bloquant
setTimeout(() => {
  verifierSante().catch(e => console.error('⚠️ Health check démarrage:', e.message));
}, 120000); // 2 minutes

// ══════════════════════════════════════════════════════════════
// API: ÉTAT SANTÉ SYSTÈME
// ══════════════════════════════════════════════════════════════

app.get('/api/sante', async (req, res) => {
  try {
    // Récupérer depuis Supabase pour avoir l'historique
    const { data } = await supabase.from('monitoring').select('*');
    
    // Fusionner avec le cache mémoire
    const result = {};
    for (const [service, status] of Object.entries(serviceStatus)) {
      const dbRecord = (data || []).find(r => r.service === service);
      result[service] = {
        ...status,
        uptime_pct: dbRecord?.uptime_pct || (status.checks > 0 ? Math.round((status.uptime / status.checks) * 100) : null)
      };
    }
    
    const allOk = Object.values(result).every(s => s.status === 'ok' || s.status === 'unknown');
    res.json({ 
      global: allOk ? 'ok' : 'degraded',
      lastCheck: new Date().toISOString(),
      services: result 
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// API: Lancer health check manuellement
app.post('/api/sante/verifier', async (req, res) => {
  try {
    const result = await verifierSante();
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DÉMARRAGE SERVEUR
// ═══════════════════════════════════════════════════════════════

const server = app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ⚡ SINELEC OS v' + CONFIG.meta.version + ' - Serveur démarré !');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📍 URL: http://localhost:' + PORT);
  console.log('  🔧 Mode: ' + (CONFIG.dev.debug_mode ? 'DEBUG' : 'PRODUCTION'));
  console.log('');
  console.log('  ✅ Features actives:');
  Object.entries(CONFIG.features)
    .filter(([k, v]) => v === true)
    .forEach(([k]) => console.log('     • ' + k));
  console.log('');
  console.log('  🤖 Crons programmés:');
  if (CONFIG.veille.enabled) {
    console.log('     • Veille tarifaire: ' + CONFIG.veille.frequence + ' à ' + CONFIG.veille.heure);
  }
  if (CONFIG.relances.enabled) {
    console.log('     • Relances auto: quotidien à 10h');
  }
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
});

// Timeout 5 minutes pour les analyses DPE longues (Claude Opus + multi-images)
server.timeout = 300000;
server.keepAliveTimeout = 300000;
